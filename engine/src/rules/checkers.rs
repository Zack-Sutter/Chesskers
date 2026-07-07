use crate::board::Piece;
use crate::state::{Coord, Team};

use super::general::{tile_is_occupied, tile_is_occupied_by_opponent, wrap_coord};

const DIRECTIONS: [(i32, i32); 8] = [
    (0, 1),
    (0, -1),
    (1, 0),
    (-1, 0),
    (1, 1),
    (1, -1),
    (-1, 1),
    (-1, -1),
];

fn torus_delta(from: u8, to: u8) -> i32 {
    let mut d = i32::from(to) - i32::from(from);
    if d > BOARD_DIM / 2 {
        d -= BOARD_DIM;
    }
    if d < -BOARD_DIM / 2 {
        d += BOARD_DIM;
    }
    d
}

use super::general::BOARD_DIM;

fn king_step_moves(piece: &Piece, pieces: &[Piece]) -> Vec<Coord> {
    let mut moves = Vec::new();
    let px = i32::from(piece.coord.x);
    let py = i32::from(piece.coord.y);

    for (dx, dy) in DIRECTIONS {
        let destination = Coord {
            x: wrap_coord(px + dx),
            y: wrap_coord(py + dy),
        };
        if !tile_is_occupied(destination, pieces) {
            moves.push(destination);
        }
    }

    moves
}

fn single_jump_moves(piece: &Piece, pieces: &[Piece]) -> Vec<Coord> {
    let mut moves = Vec::new();
    let px = i32::from(piece.coord.x);
    let py = i32::from(piece.coord.y);

    for (dx, dy) in DIRECTIONS {
        let adjacent = Coord {
            x: wrap_coord(px + dx),
            y: wrap_coord(py + dy),
        };
        let landing = Coord {
            x: wrap_coord(px + 2 * dx),
            y: wrap_coord(py + 2 * dy),
        };
        if tile_is_occupied_by_opponent(adjacent, pieces, piece.team)
            && !tile_is_occupied(landing, pieces)
        {
            moves.push(landing);
        }
    }

    moves
}

pub fn possible_checkers_moves(
    piece: &Piece,
    pieces: &[Piece],
    hop_continuation: bool,
) -> Vec<Coord> {
    let jumps = single_jump_moves(piece, pieces);
    if hop_continuation {
        return jumps;
    }

    let steps = king_step_moves(piece, pieces);
    let mut seen = std::collections::HashSet::new();
    let mut moves = Vec::new();

    for mv in steps.into_iter().chain(jumps) {
        let key = (mv.x, mv.y);
        if seen.insert(key) {
            moves.push(mv);
        }
    }

    moves
}

pub fn jumped_piece(from: Coord, to: Coord, pieces: &[Piece]) -> Option<&Piece> {
    let dx = torus_delta(from.x, to.x);
    let dy = torus_delta(from.y, to.y);
    let abs_dx = dx.unsigned_abs();
    let abs_dy = dy.unsigned_abs();
    let is_valid_jump = (abs_dx == 2 && abs_dy == 0)
        || (abs_dx == 0 && abs_dy == 2)
        || (abs_dx == 2 && abs_dy == 2);
    if !is_valid_jump {
        return None;
    }

    let middle = Coord {
        x: wrap_coord(i32::from(from.x) + dx / 2),
        y: wrap_coord(i32::from(from.y) + dy / 2),
    };
    pieces.iter().find(|p| p.coord == middle)
}

pub fn is_checkers_jump(from: Coord, to: Coord, pieces: &[Piece], team: Team) -> bool {
    jumped_piece(from, to, pieces)
        .is_some_and(|jumped| jumped.team != team)
}
