use crate::apply::apply_move;
use crate::board::Board;
use crate::state::{Move, PieceType, PromotionChoice, Team};

const PROMOTIONS: [PromotionChoice; 4] = [
    PromotionChoice::Queen,
    PromotionChoice::Rook,
    PromotionChoice::Bishop,
    PromotionChoice::Knight,
];

// ponytail: LCG PRNG avoids a rand dependency; swap to rand crate if we need distribution quality
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

fn promotion_row(team: Team) -> u8 {
    if team == Team::White { 7 } else { 0 }
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

#[derive(Debug)]
pub struct PlayResult {
    pub terminal: bool,
    pub winner: Option<Team>,
    pub moves_played: u32,
}

// ponytail: safety cap; real games finish well under this; upgrade path is draw detection
const MAX_MOVES: u32 = 10_000;

pub fn play_random_game(mut board: Board, seed: u64) -> Result<PlayResult, String> {
    let mut rng = Rng::new(seed);
    let mut moves_played = 0;

    board.calculate_all_moves();

    while board.winning_team.is_none() {
        if moves_played >= MAX_MOVES {
            return Err(format!("exceeded {MAX_MOVES} moves without terminal"));
        }

        if board.all_legal_moves().is_empty() {
            return Err("no legal moves in non-terminal position".to_string());
        }

        let mv = pick_random_move(&board, &mut rng);
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::SerializedBoard;
    use std::fs;
    use std::path::PathBuf;

    fn initial_board() -> Board {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../fixtures/initial_board.json");
        let fixture: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
        let serialized: SerializedBoard = serde_json::from_value(fixture["board"].clone()).unwrap();
        Board::from_serialized(&serialized)
    }

    #[test]
    fn random_vs_random_reaches_terminal() {
        for seed in 0..20 {
            let board = initial_board();
            let result = play_random_game(board, seed).unwrap_or_else(|e| {
                panic!("seed {seed}: {e}");
            });
            assert!(result.terminal);
            assert!(result.winner.is_some());
            assert!(result.moves_played > 0);
        }
    }

    #[test]
    fn hundred_game_suite_all_terminal() {
        for seed in 0..100 {
            let board = initial_board();
            play_random_game(board, seed + 1000).unwrap_or_else(|e| {
                panic!("seed {}: {e}", seed + 1000);
            });
        }
    }
}
