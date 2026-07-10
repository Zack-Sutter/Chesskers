use std::collections::HashMap;

use crate::board::Board;
use crate::state::PieceType;

fn piece_key(p: &crate::board::Piece) -> String {
    let en_passant = if p.piece_type == PieceType::Pawn && p.en_passant {
        "1"
    } else {
        "0"
    };
    format!(
        "{},{}:{:?}:{:?}:{}:{}",
        p.coord.x,
        p.coord.y,
        p.piece_type,
        p.team,
        if p.has_moved { "1" } else { "0" },
        en_passant
    )
}

pub fn position_key(board: &Board) -> String {
    let mut pieces: Vec<String> = board.pieces.iter().map(piece_key).collect();
    pieces.sort();
    let hop = board
        .checkers_hop_position
        .map(|c| format!("{},{}", c.x, c.y))
        .unwrap_or_default();
    serde_json::json!({
        "pieces": pieces,
        "totalTurns": board.total_turns,
        "hop": hop,
    })
    .to_string()
}

pub fn init_position_tracking(board: &mut Board) {
    board.position_counts = HashMap::new();
    board.is_draw = false;
    let key = position_key(board);
    board.position_counts.insert(key, 1);
}

pub fn record_position(board: &mut Board) {
    if board.winning_team.is_some() || board.is_draw {
        return;
    }
    if board.position_counts.is_empty() {
        init_position_tracking(board);
        return;
    }
    let key = position_key(board);
    let count = board.position_counts.get(&key).copied().unwrap_or(0) + 1;
    board.position_counts.insert(key, count);
    if count >= 3 {
        board.is_draw = true;
    }
}

pub fn is_terminal_board(board: &Board) -> bool {
    board.winning_team.is_some() || board.is_draw
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::board::Piece;
    use crate::state::{Coord, PieceType, Team};

    fn make_board(pieces: Vec<Piece>, total_turns: u32) -> Board {
        Board {
            pieces,
            total_turns,
            winning_team: None,
            checkers_hop_position: None,
            is_draw: false,
            position_counts: HashMap::new(),
        }
    }

    #[test]
    fn declares_draw_on_third_identical_position() {
        let mut board = make_board(
            vec![Piece {
                coord: Coord { x: 4, y: 0 },
                piece_type: PieceType::King,
                team: Team::White,
                has_moved: false,
                en_passant: false,
                possible_moves: Vec::new(),
            }],
            1,
        );
        init_position_tracking(&mut board);
        let key = position_key(&board);

        record_position(&mut board);
        assert!(!board.is_draw);
        assert_eq!(board.position_counts.get(&key), Some(&2));

        record_position(&mut board);
        assert!(board.is_draw);
        assert_eq!(board.position_counts.get(&key), Some(&3));
        assert!(is_terminal_board(&board));
    }
}
