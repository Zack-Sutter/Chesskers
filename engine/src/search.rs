//! Alpha-beta negamax search with ONNX leaf evaluation (E2-3).

use crate::apply::apply_move;
use crate::board::Board;
use crate::bot::PlayResult;
use crate::evaluator::{EvalError, Evaluator};
use crate::state::{Move, PieceType, PromotionChoice, Team};
use std::time::{Duration, Instant};

const PROMOTIONS: [PromotionChoice; 4] = [
    PromotionChoice::Queen,
    PromotionChoice::Rook,
    PromotionChoice::Bishop,
    PromotionChoice::Knight,
];

// ponytail: cap quiescence plies; upgrade path is deeper q-search or SEE
const MAX_QUIESCENCE_DEPTH: u32 = 2;

#[derive(Debug, Clone)]
pub struct SearchConfig {
    pub max_depth: u32,
}

impl Default for SearchConfig {
    fn default() -> Self {
        Self { max_depth: 4 }
    }
}

#[derive(Debug)]
pub enum SearchError {
    NoLegalMoves,
    PendingPromotion,
    Eval(EvalError),
}

impl std::fmt::Display for SearchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NoLegalMoves => write!(f, "no legal moves"),
            Self::PendingPromotion => write!(f, "promotion left pending"),
            Self::Eval(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for SearchError {}

struct ChildMove {
    mv: Move,
    board: Board,
    is_capture: bool,
}

fn promotion_row(team: Team) -> u8 {
    if team == Team::White { 7 } else { 0 }
}

fn terminal_score(board: &Board) -> f32 {
    match board.winning_team {
        Some(winner) if winner == board.current_team() => 1.0,
        Some(_) => -1.0,
        None => 0.0,
    }
}

fn is_promotion_move(board: &Board, mv: &Move) -> bool {
    let Some(piece) = board.pieces.iter().find(|p| p.coord == mv.from) else {
        return false;
    };
    piece.piece_type == PieceType::Pawn && mv.to.y == promotion_row(piece.team)
}

pub fn expand_moves(board: &Board) -> Vec<Move> {
    let mut out = Vec::new();
    for mv in board.all_legal_moves() {
        if is_promotion_move(board, &mv) {
            for promo in PROMOTIONS {
                out.push(Move {
                    from: mv.from,
                    to: mv.to,
                    promotion: Some(promo),
                });
            }
        } else {
            out.push(mv);
        }
    }
    out
}

fn generate_children(board: &Board) -> Vec<ChildMove> {
    let mut children = Vec::new();
    for mv in expand_moves(board) {
        let result = apply_move(board, &mv);
        if result.ok && result.pending_promotion.is_none() {
            children.push(ChildMove {
                mv,
                board: result.board,
                is_capture: result.is_capture,
            });
        }
    }
    children.sort_by(|a, b| b.is_capture.cmp(&a.is_capture));
    children
}

fn past_deadline(deadline: Option<Instant>) -> bool {
    deadline.is_some_and(|dl| Instant::now() >= dl)
}

fn quiescence<E: Evaluator>(
    board: &Board,
    evaluator: &mut E,
    depth: u32,
    mut alpha: f32,
    beta: f32,
    deadline: Option<Instant>,
) -> Result<f32, SearchError> {
    if board.winning_team.is_some() {
        return Ok(terminal_score(board));
    }

    if past_deadline(deadline) {
        return evaluator.evaluate(board).map(|r| r.value).map_err(SearchError::Eval);
    }

    let stand_pat = evaluator.evaluate(board).map_err(SearchError::Eval)?.value;
    if depth >= MAX_QUIESCENCE_DEPTH {
        return Ok(stand_pat);
    }

    let mut best = stand_pat;
    for mv in expand_moves(board) {
        if past_deadline(deadline) {
            break;
        }
        let result = apply_move(board, &mv);
        if !result.ok || result.pending_promotion.is_some() || !result.is_capture {
            continue;
        }
        let score = -quiescence(&result.board, evaluator, depth + 1, -beta, -alpha, deadline)?;
        best = best.max(score);
        alpha = alpha.max(best);
        if alpha >= beta {
            break;
        }
    }
    Ok(best)
}

fn negamax<E: Evaluator>(
    board: &Board,
    evaluator: &mut E,
    depth: u32,
    mut alpha: f32,
    beta: f32,
    deadline: Option<Instant>,
) -> Result<f32, SearchError> {
    if board.winning_team.is_some() {
        return Ok(terminal_score(board));
    }

    if past_deadline(deadline) {
        return evaluator.evaluate(board).map(|r| r.value).map_err(SearchError::Eval);
    }

    if depth == 0 {
        return quiescence(board, evaluator, 0, alpha, beta, deadline);
    }

    let children = generate_children(board);
    if children.is_empty() {
        return Ok(terminal_score(board));
    }

    let side = board.current_team();
    for child in &children {
        if child.board.winning_team == Some(side) {
            return Ok(1.0);
        }
    }

    let mut best = f32::NEG_INFINITY;
    for child in children {
        if past_deadline(deadline) {
            break;
        }
        let score = -negamax(&child.board, evaluator, depth - 1, -beta, -alpha, deadline)?;
        best = best.max(score);
        alpha = alpha.max(best);
        if alpha >= beta {
            break;
        }
    }

    if best == f32::NEG_INFINITY {
        return Ok(terminal_score(board));
    }
    Ok(best)
}

pub fn search_best_move<E: Evaluator>(
    board: &Board,
    evaluator: &mut E,
    config: &SearchConfig,
    deadline: Option<Instant>,
) -> Result<Move, SearchError> {
    let children = generate_children(board);
    if children.is_empty() {
        return Err(SearchError::NoLegalMoves);
    }

    let side = board.current_team();
    for child in &children {
        if child.board.winning_team == Some(side) {
            return Ok(child.mv.clone());
        }
    }

    let mut best_move = children[0].mv.clone();
    let mut best_score = f32::NEG_INFINITY;

    for child in children {
        if past_deadline(deadline) {
            break;
        }
        let score = -negamax(
            &child.board,
            evaluator,
            config.max_depth.saturating_sub(1),
            f32::NEG_INFINITY,
            f32::INFINITY,
            deadline,
        )?;
        if score > best_score || (score == best_score && child.is_capture) {
            best_score = score;
            best_move = child.mv;
        }
    }

    Ok(best_move)
}

#[derive(Debug, Clone)]
pub struct TimedSearchConfig {
    pub max_depth: u32,
    pub think_ms: u64,
}

/// Iterative deepening until `think_ms` elapses; returns best move from last completed depth.
pub fn search_best_move_timed<E: Evaluator>(
    board: &Board,
    evaluator: &mut E,
    config: &TimedSearchConfig,
) -> Result<Move, SearchError> {
    let children = generate_children(board);
    if children.is_empty() {
        return Err(SearchError::NoLegalMoves);
    }

    let side = board.current_team();
    for child in &children {
        if child.board.winning_team == Some(side) {
            return Ok(child.mv.clone());
        }
    }

    let deadline = Instant::now() + Duration::from_millis(config.think_ms);
    let mut best_move = children[0].mv.clone();
    let max_depth = config.max_depth.max(1);

    for depth in 1..=max_depth {
        if Instant::now() >= deadline {
            break;
        }
        let search_config = SearchConfig { max_depth: depth };
        best_move = search_best_move(board, evaluator, &search_config, Some(deadline))?;
        if Instant::now() >= deadline {
            break;
        }
    }

    Ok(best_move)
}

// ponytail: LCG PRNG duplicated from bot.rs to avoid coupling harness to private bot helpers
struct Rng(u64);

impl Rng {
    fn new(seed: u64) -> Self {
        Self(seed)
    }

    fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1);
        self.0
    }

    fn index(&mut self, len: usize) -> usize {
        debug_assert!(len > 0);
        (self.next_u64() as usize) % len
    }
}

fn pick_random_move(board: &Board, rng: &mut Rng) -> Move {
    let legal = board.all_legal_moves();
    let mut mv = legal[rng.index(legal.len())].clone();
    if let Some(piece) = board.pieces.iter().find(|p| p.coord == mv.from) {
        if piece.piece_type == PieceType::Pawn && mv.to.y == promotion_row(piece.team) {
            mv.promotion = Some(PROMOTIONS[rng.index(PROMOTIONS.len())]);
        }
    }
    mv
}

pub fn play_search_vs_random<E: Evaluator>(
    mut board: Board,
    evaluator: &mut E,
    search_as: Team,
    config: &SearchConfig,
    random_seed: u64,
    max_moves: u32,
) -> Result<PlayResult, String> {
    let mut rng = Rng::new(random_seed);
    let mut moves_played = 0;

    board.calculate_all_moves();

    while board.winning_team.is_none() {
        if moves_played >= max_moves {
            // No draw detection (arch §11): a move-capped game is a draw, not an error.
            return Ok(PlayResult {
                terminal: false,
                winner: None,
                moves_played,
            });
        }

        if board.all_legal_moves().is_empty() {
            return Err("no legal moves in non-terminal position".to_string());
        }

        let mv = if board.current_team() == search_as {
            search_best_move(&board, evaluator, config, None).map_err(|e| e.to_string())?
        } else {
            pick_random_move(&board, &mut rng)
        };

        let result = apply_move(&board, &mv);
        if !result.ok {
            return Err(format!("illegal move: {mv:?}"));
        }
        if result.pending_promotion.is_some() {
            return Err("promotion left pending".to_string());
        }

        board = result.board;
        moves_played += 1;
    }

    Ok(PlayResult {
        terminal: true,
        winner: board.winning_team,
        moves_played,
    })
}

/// Play `plies` seeded random moves from `board` to diversify a starting
/// position (used by the fixed evaluation suites so otherwise-deterministic
/// engine-vs-engine games differ per seed).
pub(crate) fn random_opening(mut board: Board, plies: u32, seed: u64) -> Result<Board, String> {
    let mut rng = Rng::new(seed);
    board.calculate_all_moves();
    for _ in 0..plies {
        if board.winning_team.is_some() || board.all_legal_moves().is_empty() {
            break;
        }
        let mv = pick_random_move(&board, &mut rng);
        let result = apply_move(&board, &mv);
        if !result.ok {
            return Err(format!("illegal opening move: {mv:?}"));
        }
        board = result.board;
    }
    Ok(board)
}

/// Play one engine-vs-engine game (both sides use alpha-beta with their own
/// evaluator). Returns the winner, or `None` for a move-capped/stalemated draw
/// (no draw rules, §11).
#[allow(clippy::too_many_arguments)]
pub fn play_engine_vs_engine<W: Evaluator, B: Evaluator>(
    start: Board,
    white_eval: &mut W,
    white_cfg: &SearchConfig,
    black_eval: &mut B,
    black_cfg: &SearchConfig,
    opening_plies: u32,
    seed: u64,
    max_moves: u32,
) -> Result<Option<Team>, String> {
    let mut board = random_opening(start, opening_plies, seed)?;
    let mut moves_played = 0;

    while board.winning_team.is_none() {
        if moves_played >= max_moves {
            return Ok(None);
        }
        if board.all_legal_moves().is_empty() {
            return Ok(None);
        }
        let mv = if board.current_team() == Team::White {
            search_best_move(&board, white_eval, white_cfg, None).map_err(|e| e.to_string())?
        } else {
            search_best_move(&board, black_eval, black_cfg, None).map_err(|e| e.to_string())?
        };
        let result = apply_move(&board, &mv);
        if !result.ok {
            return Err(format!("illegal move: {mv:?}"));
        }
        if result.pending_promotion.is_some() {
            return Err("promotion left pending".to_string());
        }
        board = result.board;
        moves_played += 1;
    }

    Ok(board.winning_team)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::evaluator::{EvalResult, OnnxEvaluator};
    use crate::state::GoldenFixture;
    use std::fs;
    use std::path::PathBuf;

    // ponytail: material eval for fast harness tests; OnnxEvaluator tested separately
    struct MaterialEvaluator;

    impl Evaluator for MaterialEvaluator {
        fn evaluate(&mut self, board: &Board) -> Result<EvalResult, EvalError> {
            let mut score = 0.0f32;
            for piece in &board.pieces {
                let value = match piece.piece_type {
                    PieceType::King => 10.0,
                    PieceType::Queen => 9.0,
                    PieceType::Rook => 5.0,
                    PieceType::Bishop | PieceType::Knight => 3.0,
                    PieceType::Checkers => 3.0,
                    PieceType::Pawn => 1.0,
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

    fn initial_board() -> Board {
        load_board("initial_board")
    }

    fn dummy_evaluator() -> OnnxEvaluator {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("models/dummy.onnx");
        OnnxEvaluator::from_file(path).unwrap()
    }

    fn v001_evaluator() -> OnnxEvaluator {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("models/v001.onnx");
        OnnxEvaluator::from_file(path).unwrap()
    }

    #[test]
    fn expand_moves_splits_pawn_promotion() {
        let board = load_board("pawn_reaches_back_rank_pending_promotion");
        let expanded = expand_moves(&board);
        let promos: Vec<_> = expanded
            .iter()
            .filter(|mv| mv.from.x == 0 && mv.from.y == 6 && mv.to.y == 7)
            .collect();
        assert_eq!(promos.len(), 4);
        assert!(promos.iter().all(|mv| mv.promotion.is_some()));
    }

    #[test]
    fn search_picks_instant_win() {
        let board = load_board("declares_black_winner_when_white_king_hopped");
        let mut evaluator = dummy_evaluator();
        let config = SearchConfig { max_depth: 1 };
        let mv = search_best_move(&board, &mut evaluator, &config, None).unwrap();
        assert_eq!(mv.from.x, 4);
        assert_eq!(mv.from.y, 6);
        assert_eq!(mv.to.x, 2);
        assert_eq!(mv.to.y, 4);
    }

    #[test]
    fn search_handles_promotion() {
        let board = load_board("pawn_reaches_back_rank_pending_promotion");
        let mut evaluator = dummy_evaluator();
        let config = SearchConfig { max_depth: 1 };
        let mv = search_best_move(&board, &mut evaluator, &config, None).unwrap();
        let result = apply_move(&board, &mv);
        assert!(result.ok);
        assert!(
            result.pending_promotion.is_none(),
            "search must pick a promotion"
        );
        assert!(mv.promotion.is_some());
    }

    #[test]
    fn search_vs_random_reaches_terminal() {
        let board = initial_board();
        let mut evaluator = MaterialEvaluator;
        let config = SearchConfig { max_depth: 2 };
        let result =
            play_search_vs_random(board, &mut evaluator, Team::Black, &config, 7, 2000).unwrap();
        assert!(result.terminal);
        assert!(result.winner.is_some());
        assert!(result.moves_played < 500, "expected a reasonably short game");
    }

    #[test]
    fn search_vs_random_beats_random_short_suite() {
        let mut evaluator = MaterialEvaluator;
        let config = SearchConfig { max_depth: 2 };
        let mut wins = 0u32;

        // Black (checkers) benefits most from tactical search; white games can stall without draw rules.
        for seed in 0..10 {
            let board = initial_board();
            let result =
                play_search_vs_random(board, &mut evaluator, Team::Black, &config, seed + 5000, 2000)
                    .unwrap_or_else(|e| panic!("seed {seed}: {e}"));
            assert!(
                result.moves_played < 2000,
                "seed {seed}: game too long ({} moves)",
                result.moves_played
            );
            if result.winner == Some(Team::Black) {
                wins += 1;
            }
        }

        assert!(wins >= 5, "search should beat random in short suite; got {wins}/10");
    }

    #[test]
    fn search_uses_onnx_evaluator_at_quiescence_leaf() {
        let board = initial_board();
        let mut evaluator = dummy_evaluator();
        let config = SearchConfig { max_depth: 1 };
        let _ = search_best_move(&board, &mut evaluator, &config, None).unwrap();
    }

    // ponytail: shared 100-game harness; move-capped games are draws (no draw rules, arch §11)
    fn win_loss_draw<E: Evaluator>(
        evaluator: &mut E,
        config: &SearchConfig,
        max_moves: u32,
    ) -> (u32, u32, u32) {
        let (mut wins, mut losses, mut draws) = (0u32, 0u32, 0u32);
        for seed in 0..100 {
            let board = initial_board();
            let search_as = if seed % 2 == 0 { Team::White } else { Team::Black };
            let result =
                play_search_vs_random(board, evaluator, search_as, config, seed + 5000, max_moves)
                    .unwrap_or_else(|e| panic!("seed {seed}: {e}"));
            match result.winner {
                Some(w) if w == search_as => wins += 1,
                Some(_) => losses += 1,
                None => draws += 1,
            }
        }
        (wins, losses, draws)
    }

    #[test]
    #[ignore = "slow: 100-game ONNX suite; run with --ignored --nocapture"]
    fn search_vs_random_win_rate() {
        let mut evaluator = v001_evaluator();
        let config = SearchConfig { max_depth: 2 };
        let (wins, losses, draws) = win_loss_draw(&mut evaluator, &config, 400);

        eprintln!("v001.onnx depth 2 vs random: {wins} win / {losses} loss / {draws} draw (of 100)");
        // Measured 100/0/0 (deterministic seeds): the value net meets the arch §9
        // Stage A exit target of >90% vs random. Move-capped games count as draws
        // (no draw detection, §11).
        assert!(
            wins >= 90,
            "v001.onnx should beat random >90%; got {wins} win / {losses} loss / {draws} draw"
        );
    }

    #[test]
    fn v001_onnx_loads_and_evaluates() {
        let mut evaluator = v001_evaluator();
        let value = evaluator.evaluate(&initial_board()).unwrap().value;
        assert!(value.is_finite());
        assert!((-1.0..=1.0).contains(&value), "value {value} outside [-1, 1]");
    }

    #[test]
    #[ignore = "slow: 100-game suite; run with --ignored --nocapture"]
    fn search_vs_random_win_rate_report() {
        let mut evaluator = dummy_evaluator();
        let config = SearchConfig { max_depth: 3 };
        let (wins, losses, draws) = win_loss_draw(&mut evaluator, &config, 600);

        eprintln!("dummy.onnx depth 3 vs random: {wins} win / {losses} loss / {draws} draw (of 100)");
        // ponytail: honest gate — tactical search only, no positional signal (dummy net).
        assert!(wins > losses, "search should beat random baseline; got {wins}w/{losses}l/{draws}d");
    }
}
