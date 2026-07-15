//! PUCT Monte-Carlo tree search using the NN value + policy priors (E2-3 / T1-6).
//!
//! Complements the alpha-beta search in `search.rs`: alpha-beta is the value-only
//! path, MCTS consumes the policy head (priors) exported by v002+ models. When a
//! value-only model (empty policy) is used, priors fall back to uniform, so MCTS
//! still runs — just without policy guidance.
//!
//! Chesskers wrinkle: a checkers multi-hop keeps the same side to move
//! (`totalTurns` is not incremented), so backup/Q flip sign by comparing actual
//! `to_move` teams, not by tree depth.

use crate::apply::apply_move;
use crate::board::Board;
use crate::evaluator::{EvalError, Evaluator};
use crate::repetition::is_terminal_board;
use crate::search::{expand_moves, random_opening, SearchError};
use crate::state::{Move, Team};
use std::time::Instant;

const DEFAULT_C_PUCT: f32 = 1.5;

#[derive(Debug, Clone)]
pub struct MctsConfig {
    pub simulations: u32,
    pub c_puct: f32,
    /// Use the model's policy head as PUCT priors. When false (or the model has
    /// no policy head), priors are uniform.
    pub policy_priors: bool,
}

impl Default for MctsConfig {
    fn default() -> Self {
        Self {
            simulations: 200,
            c_puct: DEFAULT_C_PUCT,
            policy_priors: true,
        }
    }
}

struct Edge {
    mv: Move,
    prior: f32,
    child: Option<usize>,
}

struct Node {
    board: Board,
    to_move: Team,
    winner: Option<Team>,
    visits: u32,
    value_sum: f32, // accumulated leaf value from this node's side-to-move POV
    expanded: bool,
    edges: Vec<Edge>,
}

impl Node {
    fn new(board: Board) -> Self {
        let to_move = board.current_team();
        let winner = board.winning_team;
        Self {
            board,
            to_move,
            winner,
            visits: 0,
            value_sum: 0.0,
            expanded: false,
            edges: Vec::new(),
        }
    }

    fn mean_value(&self) -> f32 {
        if self.visits == 0 {
            0.0
        } else {
            self.value_sum / self.visits as f32
        }
    }
}

/// Terminal value from `to_move`'s perspective (mirrors search::terminal_score).
fn terminal_value(winner: Team, to_move: Team) -> f32 {
    if winner == to_move {
        1.0
    } else {
        -1.0
    }
}

fn build_edges<E: Evaluator>(
    board: &Board,
    evaluator: &mut E,
    use_policy: bool,
) -> Result<(f32, Vec<Edge>), EvalError> {
    let eval = evaluator.evaluate(board)?;
    let edges = if eval.policy.is_empty() || !use_policy {
        let moves = expand_moves(board);
        let prior = if moves.is_empty() {
            0.0
        } else {
            1.0 / moves.len() as f32
        };
        moves
            .into_iter()
            .map(|mv| Edge {
                mv,
                prior,
                child: None,
            })
            .collect()
    } else {
        eval.policy
            .into_iter()
            .map(|(mv, prior)| Edge {
                mv,
                prior,
                child: None,
            })
            .collect()
    };
    Ok((eval.value, edges))
}

fn select_edge(arena: &[Node], node_idx: usize, c_puct: f32) -> Option<usize> {
    let node = &arena[node_idx];
    let parent_visits = (node.visits.max(1)) as f32;
    let sqrt_parent = parent_visits.sqrt();
    let mut best = None;
    let mut best_score = f32::NEG_INFINITY;
    for (i, edge) in node.edges.iter().enumerate() {
        let (child_visits, q) = match edge.child {
            Some(c) => {
                let child = &arena[c];
                let mean = child.mean_value();
                // Express child value from this node's POV (hop chains may keep side).
                let q = if child.to_move == node.to_move { mean } else { -mean };
                (child.visits as f32, q)
            }
            None => (0.0, 0.0),
        };
        let u = c_puct * edge.prior * sqrt_parent / (1.0 + child_visits);
        let score = q + u;
        if score > best_score {
            best_score = score;
            best = Some(i);
        }
    }
    best
}

fn backup(arena: &mut [Node], path: &[usize], leaf_value: f32, leaf_team: Team) {
    for &idx in path {
        let node = &mut arena[idx];
        node.visits += 1;
        let signed = if node.to_move == leaf_team {
            leaf_value
        } else {
            -leaf_value
        };
        node.value_sum += signed;
    }
}

fn simulate<E: Evaluator>(
    arena: &mut Vec<Node>,
    root: usize,
    evaluator: &mut E,
    c_puct: f32,
    use_policy: bool,
) -> Result<(), SearchError> {
    let mut path = Vec::new();
    let mut idx = root;
    loop {
        path.push(idx);

        if arena[idx].board.is_draw {
            let team = arena[idx].to_move;
            backup(arena, &path, 0.0, team);
            return Ok(());
        }

        if let Some(winner) = arena[idx].winner {
            let team = arena[idx].to_move;
            backup(arena, &path, terminal_value(winner, team), team);
            return Ok(());
        }

        if !arena[idx].expanded {
            let (value, edges) =
                build_edges(&arena[idx].board, evaluator, use_policy).map_err(SearchError::Eval)?;
            arena[idx].edges = edges;
            arena[idx].expanded = true;
            let team = arena[idx].to_move;
            backup(arena, &path, value, team);
            return Ok(());
        }

        // Expanded but no legal continuation (non-terminal dead end): reuse its mean.
        if arena[idx].edges.is_empty() {
            let team = arena[idx].to_move;
            let mean = arena[idx].mean_value();
            backup(arena, &path, mean, team);
            return Ok(());
        }

        let Some(edge_i) = select_edge(arena, idx, c_puct) else {
            let team = arena[idx].to_move;
            let mean = arena[idx].mean_value();
            backup(arena, &path, mean, team);
            return Ok(());
        };

        let child_idx = match arena[idx].edges[edge_i].child {
            Some(c) => c,
            None => {
                let parent_board = arena[idx].board.clone();
                let mv = arena[idx].edges[edge_i].mv.clone();
                let result = apply_move(&parent_board, &mv);
                debug_assert!(result.ok, "MCTS expanded an illegal move: {mv:?}");
                arena.push(Node::new(result.board));
                let c = arena.len() - 1;
                arena[idx].edges[edge_i].child = Some(c);
                c
            }
        };
        idx = child_idx;
    }
}

/// Run MCTS from `board` and return the most-visited root move.
pub fn search_best_move_mcts<E: Evaluator>(
    board: &Board,
    evaluator: &mut E,
    config: &MctsConfig,
    deadline: Option<Instant>,
) -> Result<Move, SearchError> {
    if is_terminal_board(board) {
        return Err(SearchError::NoLegalMoves);
    }

    // Instant-win shortcut (parity with alpha-beta search_best_move).
    let side = board.current_team();
    for mv in expand_moves(board) {
        let result = apply_move(board, &mv);
        if result.ok && result.pending_promotion.is_none() && result.board.winning_team == Some(side) {
            return Ok(mv);
        }
    }

    let mut arena: Vec<Node> = vec![Node::new(board.clone())];
    for _ in 0..config.simulations {
        if deadline.is_some_and(|dl| Instant::now() >= dl) {
            break;
        }
        simulate(&mut arena, 0, evaluator, config.c_puct, config.policy_priors)?;
    }

    let root = &arena[0];
    if root.edges.is_empty() {
        return Err(SearchError::NoLegalMoves);
    }

    // Most-visited move; tie-break by prior for determinism.
    let mut best: Option<&Edge> = None;
    let mut best_visits = 0i64;
    let mut best_prior = f32::NEG_INFINITY;
    for edge in &root.edges {
        let visits = edge.child.map_or(0, |c| arena[c].visits) as i64;
        if visits > best_visits || (visits == best_visits && edge.prior > best_prior) {
            best_visits = visits;
            best_prior = edge.prior;
            best = Some(edge);
        }
    }
    best.map(|e| e.mv.clone()).ok_or(SearchError::NoLegalMoves)
}

/// Play one MCTS-vs-MCTS game at equal sim budgets. This is the T1-6 fixed
/// evaluation setup: it isolates the policy head, since a value-only model
/// (v001) falls back to uniform priors while v002 uses its trained priors.
/// Returns the winner, or `None` for a move-capped/stalemated draw (§11).
#[allow(clippy::too_many_arguments)]
pub fn play_mcts_vs_mcts<W: Evaluator, B: Evaluator>(
    start: Board,
    white_eval: &mut W,
    white_cfg: &MctsConfig,
    black_eval: &mut B,
    black_cfg: &MctsConfig,
    opening_plies: u32,
    seed: u64,
    max_moves: u32,
) -> Result<Option<Team>, String> {
    let mut board = random_opening(start, opening_plies, seed)?;
    let mut moves_played = 0;

    while !is_terminal_board(&board) {
        if moves_played >= max_moves {
            return Ok(None);
        }
        if board.all_legal_moves().is_empty() {
            return Ok(None);
        }
        let mv = if board.current_team() == Team::White {
            search_best_move_mcts(&board, white_eval, white_cfg, None).map_err(|e| e.to_string())?
        } else {
            search_best_move_mcts(&board, black_eval, black_cfg, None).map_err(|e| e.to_string())?
        };
        let result = apply_move(&board, &mv);
        if !result.ok {
            return Err(format!("illegal move: {mv:?}"));
        }
        board = result.board;
        moves_played += 1;
    }

    Ok(board.winning_team)
}

/// Win-rate gate for Stage B+ promotions (arch §9).
pub const PROMOTION_WIN_THRESHOLD: f64 = 0.55;

/// Parameters for the fixed MCTS-vs-MCTS promotion suite (arch §9 Stage B).
#[derive(Debug, Clone)]
pub struct PromotionSuiteConfig {
    pub challenger_mcts: MctsConfig,
    pub baseline_mcts: MctsConfig,
    /// Seeds `0..seed_count`, each played as challenger white and black.
    pub seed_count: u32,
    pub opening_plies: u32,
    pub max_moves: u32,
}

impl PromotionSuiteConfig {
    /// Gate suite: equal sim budgets and policy-prior settings on both sides.
    pub fn gate(simulations: u32) -> Self {
        let mcts = MctsConfig {
            simulations,
            ..Default::default()
        };
        Self {
            challenger_mcts: mcts.clone(),
            baseline_mcts: mcts,
            seed_count: 15,
            opening_plies: 6,
            max_moves: 120,
        }
    }
}

impl Default for PromotionSuiteConfig {
    fn default() -> Self {
        Self::gate(100)
    }
}

/// Per-seat W/L/D for the challenger when sitting that color.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SideRecord {
    pub wins: u32,
    pub losses: u32,
    pub draws: u32,
}

impl SideRecord {
    fn record(&mut self, winner: Option<Team>, challenger_team: Team) {
        match winner {
            Some(w) if w == challenger_team => self.wins += 1,
            Some(_) => self.losses += 1,
            None => self.draws += 1,
        }
    }

    pub fn games(&self) -> u32 {
        self.wins + self.losses + self.draws
    }
}

/// Full promotion-suite tallies (arch §9 scoring + per-model / per-color splits).
#[derive(Debug, Clone, Default, PartialEq)]
pub struct PromotionSuiteStats {
    /// Challenger score fraction: (wins + 0.5·draws) / games.
    pub win_rate: f64,
    pub games: u32,
    pub challenger_wins: u32,
    pub baseline_wins: u32,
    pub draws: u32,
    /// Games where `Team::White` won (either model).
    pub white_wins: u32,
    /// Games where `Team::Black` won (either model).
    pub black_wins: u32,
    pub challenger_as_white: SideRecord,
    pub challenger_as_black: SideRecord,
}

/// Color-balanced MCTS suite: challenger vs baseline at equal sim budgets.
/// Models are loaded from `models_dir/{stem}.onnx`.
pub fn promotion_suite(
    models_dir: &std::path::Path,
    challenger: &str,
    baseline: &str,
    start: &Board,
    config: &PromotionSuiteConfig,
) -> Result<PromotionSuiteStats, String> {
    use crate::evaluator::OnnxEvaluator;

    let mut stats = PromotionSuiteStats::default();
    let mut score = 0.0f64;
    for seed in 0..config.seed_count {
        for chal_white in [true, false] {
            let mut chal_eval = OnnxEvaluator::from_file(models_dir.join(format!("{challenger}.onnx")))
                .map_err(|e| e.to_string())?;
            let mut base_eval = OnnxEvaluator::from_file(models_dir.join(format!("{baseline}.onnx")))
                .map_err(|e| e.to_string())?;
            let winner = if chal_white {
                play_mcts_vs_mcts(
                    start.clone(),
                    &mut chal_eval,
                    &config.challenger_mcts,
                    &mut base_eval,
                    &config.baseline_mcts,
                    config.opening_plies,
                    seed as u64 + 9000,
                    config.max_moves,
                )?
            } else {
                play_mcts_vs_mcts(
                    start.clone(),
                    &mut base_eval,
                    &config.baseline_mcts,
                    &mut chal_eval,
                    &config.challenger_mcts,
                    config.opening_plies,
                    seed as u64 + 9000,
                    config.max_moves,
                )?
            };
            let chal_team = if chal_white { Team::White } else { Team::Black };
            if chal_white {
                stats.challenger_as_white.record(winner, chal_team);
            } else {
                stats.challenger_as_black.record(winner, chal_team);
            }
            match winner {
                Some(Team::White) => stats.white_wins += 1,
                Some(Team::Black) => stats.black_wins += 1,
                None => stats.draws += 1,
            }
            match winner {
                Some(w) if w == chal_team => {
                    stats.challenger_wins += 1;
                    score += 1.0;
                }
                Some(_) => {
                    stats.baseline_wins += 1;
                }
                None => {
                    score += 0.5;
                }
            }
            stats.games += 1;
        }
    }
    stats.win_rate = if stats.games == 0 {
        0.0
    } else {
        score / f64::from(stats.games)
    };
    Ok(stats)
}

/// Challenger score fraction (wins + 0.5·draws) / games.
pub fn promotion_win_rate(
    models_dir: &std::path::Path,
    challenger: &str,
    baseline: &str,
    start: &Board,
    config: &PromotionSuiteConfig,
) -> Result<f64, String> {
    Ok(promotion_suite(models_dir, challenger, baseline, start, config)?.win_rate)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::evaluator::{EvalResult, OnnxEvaluator};
    use crate::state::GoldenFixture;
    use std::fs;
    use std::path::PathBuf;

    struct MaterialEvaluator;

    impl Evaluator for MaterialEvaluator {
        fn evaluate(&mut self, board: &Board) -> Result<EvalResult, EvalError> {
            let mut score = 0.0f32;
            for piece in &board.pieces {
                use crate::state::PieceType::*;
                let value = match piece.piece_type {
                    King => 10.0,
                    Queen => 9.0,
                    Rook => 5.0,
                    Bishop | Knight | Checkers => 3.0,
                    Pawn => 1.0,
                };
                if piece.team == board.current_team() {
                    score += value;
                } else {
                    score -= value;
                }
            }
            Ok(EvalResult {
                value: (score / 20.0).tanh(),
                policy: Vec::new(),
            })
        }
    }

    fn fixtures_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../fixtures")
    }

    fn load_board(name: &str) -> Board {
        let path = fixtures_dir().join(format!("{name}.json"));
        let fixture = GoldenFixture::from_json(&fs::read_to_string(path).unwrap()).unwrap();
        let mut board = Board::from_serialized(&fixture.board);
        board.calculate_all_moves();
        board
    }

    #[test]
    fn mcts_picks_instant_win() {
        let board = load_board("declares_black_winner_when_white_king_hopped");
        let mut evaluator = MaterialEvaluator;
        let config = MctsConfig { simulations: 32, ..Default::default() };
        let mv = search_best_move_mcts(&board, &mut evaluator, &config, None).unwrap();
        assert_eq!((mv.from.x, mv.from.y, mv.to.x, mv.to.y), (4, 6, 2, 4));
    }

    #[test]
    fn mcts_returns_legal_move() {
        let board = load_board("initial_board");
        let mut evaluator = MaterialEvaluator;
        let config = MctsConfig { simulations: 64, ..Default::default() };
        let mv = search_best_move_mcts(&board, &mut evaluator, &config, None).unwrap();
        assert!(board
            .all_legal_moves()
            .iter()
            .any(|m| m.from == mv.from && m.to == mv.to));
    }

    #[test]
    fn mcts_runs_with_onnx_value_only_model() {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("models/v001.onnx");
        let mut evaluator = OnnxEvaluator::from_file(path).unwrap();
        let board = load_board("initial_board");
        let config = MctsConfig { simulations: 32, ..Default::default() };
        // v001 has no policy head -> uniform priors; MCTS must still return a move.
        let _ = search_best_move_mcts(&board, &mut evaluator, &config, None).unwrap();
    }

    fn models_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("models")
    }

    fn suite(chal_name: &str, chal: &MctsConfig, base_name: &str, base: &MctsConfig,
             seeds: std::ops::Range<u64>, opening_plies: u32, max_moves: u32) -> f64 {
        let config = PromotionSuiteConfig {
            challenger_mcts: chal.clone(),
            baseline_mcts: base.clone(),
            seed_count: (seeds.end - seeds.start) as u32,
            opening_plies,
            max_moves,
        };
        promotion_win_rate(
            &models_dir(),
            chal_name,
            base_name,
            &load_board("initial_board"),
            &config,
        )
        .unwrap_or_else(|e| panic!("suite failed: {e}"))
    }

    // Diagnostic: separates v002's value contribution (uniform priors) from its
    // policy-priors contribution, both vs v001. Not a gate — informs tuning.
    #[test]
    #[ignore = "slow diagnostic: run with --ignored --nocapture"]
    fn v002_diagnostic() {
        let uniform = MctsConfig { simulations: 100, policy_priors: false, ..Default::default() };
        let with_policy = MctsConfig { simulations: 100, policy_priors: true, ..Default::default() };
        let base = MctsConfig { simulations: 100, ..Default::default() };
        let value_only = suite("v002", &uniform, "v001", &base, 0..8, 6, 120);
        eprintln!("v002 value-only (uniform priors) vs v001: {:.1}%", value_only * 100.0);
        let full = suite("v002", &with_policy, "v001", &base, 0..8, 6, 120);
        eprintln!("v002 value+policy vs v001: {:.1}%", full * 100.0);
    }

    // T1-6 fixed evaluation suite (arch §9 Stage B exit). Both models play via
    // MCTS at equal sims; v002 uses its trained policy priors, v001 falls back to
    // uniform priors — isolating the policy head's contribution. Each model plays
    // both colors per seed; move-capped draws (§11) score half. Gate: v002 ≥ 55%.
    #[test]
    #[ignore = "slow: needs models/v002.onnx; run with --ignored --nocapture"]
    fn v002_beats_v001() {
        let config = PromotionSuiteConfig::gate(100);
        let win_rate = promotion_win_rate(
            &models_dir(),
            "v002",
            "v001",
            &load_board("initial_board"),
            &config,
        )
        .unwrap();
        eprintln!("v002 vs v001 (MCTS suite): {:.1}%", win_rate * 100.0);
        assert!(
            win_rate >= PROMOTION_WIN_THRESHOLD,
            "v002 must beat v001 ≥{:.0}%; got {:.1}%",
            PROMOTION_WIN_THRESHOLD * 100.0,
            win_rate * 100.0
        );
    }
}
