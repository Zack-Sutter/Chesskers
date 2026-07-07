use crate::board::Piece;
use crate::state::Coord;

use super::general::{
    coord, in_bounds, tile_is_occupied, tile_is_occupied_by_opponent,
    tile_is_empty_or_occupied_by_opponent,
};

fn ray_moves(
    piece: &Piece,
    pieces: &[Piece],
    deltas: &[(i32, i32)],
    clip: bool,
) -> Vec<Coord> {
    let mut moves = Vec::new();
    let px = i32::from(piece.coord.x);
    let py = i32::from(piece.coord.y);

    for (dx, dy) in deltas {
        for i in 1..8 {
            let x = px + dx * i;
            let y = py + dy * i;
            if clip && !in_bounds(x, y) {
                break;
            }
            let destination = coord(x, y);
            if !tile_is_occupied(destination, pieces) {
                moves.push(destination);
            } else if tile_is_occupied_by_opponent(destination, pieces, piece.team) {
                moves.push(destination);
                break;
            } else {
                break;
            }
        }
    }

    moves
}

pub fn possible_rook_moves(rook: &Piece, pieces: &[Piece]) -> Vec<Coord> {
    ray_moves(
        rook,
        pieces,
        &[(0, 1), (0, -1), (-1, 0), (1, 0)],
        true,
    )
}

pub fn possible_bishop_moves(bishop: &Piece, pieces: &[Piece]) -> Vec<Coord> {
    ray_moves(
        bishop,
        pieces,
        &[(1, 1), (1, -1), (-1, -1), (-1, 1)],
        true,
    )
}

pub fn possible_queen_moves(queen: &Piece, pieces: &[Piece]) -> Vec<Coord> {
    ray_moves(
        queen,
        pieces,
        &[
            (0, 1),
            (0, -1),
            (-1, 0),
            (1, 0),
            (1, 1),
            (1, -1),
            (-1, -1),
            (-1, 1),
        ],
        true,
    )
}

pub fn possible_king_moves(king: &Piece, pieces: &[Piece]) -> Vec<Coord> {
    ray_moves(
        king,
        pieces,
        &[
            (0, 1),
            (0, -1),
            (-1, 0),
            (1, 0),
            (1, 1),
            (1, -1),
            (-1, -1),
            (-1, 1),
        ],
        true,
    )
}

pub fn castling_moves(king: &Piece, pieces: &[Piece]) -> Vec<Coord> {
    if king.has_moved {
        return Vec::new();
    }

    let mut moves = Vec::new();
    for rook in pieces.iter().filter(|p| {
        p.piece_type == crate::state::PieceType::Rook
            && p.team == king.team
            && !p.has_moved
    }) {
        let direction = if rook.coord.x > king.coord.x { 1 } else { -1 };
        let adjacent = coord(
            i32::from(king.coord.x) + direction,
            i32::from(king.coord.y),
        );
        if rook.possible_moves.iter().any(|m| *m == adjacent) {
            moves.push(rook.coord);
        }
    }

    moves
}

pub fn possible_knight_moves(knight: &Piece, pieces: &[Piece]) -> Vec<Coord> {
    let mut moves = Vec::new();
    let px = i32::from(knight.coord.x);
    let py = i32::from(knight.coord.y);

    for i in [-1, 1] {
        for j in [-1, 1] {
            let vx = px + j;
            let vy = py + i * 2;
            let hx = px + i * 2;
            let hy = py + j;

            if in_bounds(vx, vy) {
                let vertical = coord(vx, vy);
                if tile_is_empty_or_occupied_by_opponent(vertical, pieces, knight.team) {
                    moves.push(vertical);
                }
            }
            if in_bounds(hx, hy) {
                let horizontal = coord(hx, hy);
                if tile_is_empty_or_occupied_by_opponent(horizontal, pieces, knight.team) {
                    moves.push(horizontal);
                }
            }
        }
    }

    moves
}
