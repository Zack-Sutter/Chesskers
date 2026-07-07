use crate::board::Piece;
use crate::state::{Coord, Team};

use super::general::{
    coord, in_bounds, tile_is_occupied, tile_is_occupied_by_opponent,
};

pub fn possible_pawn_moves(pawn: &Piece, pieces: &[Piece]) -> Vec<Coord> {
    let special_row = if pawn.team == Team::White { 1 } else { 6 };
    let pawn_direction = if pawn.team == Team::White { 1 } else { -1 };
    let px = i32::from(pawn.coord.x);
    let py = i32::from(pawn.coord.y);

    let mut moves = Vec::new();

    let ny = py + pawn_direction;
    if in_bounds(px, ny) {
        let normal_move = coord(px, ny);
        if !tile_is_occupied(normal_move, pieces) {
            moves.push(normal_move);
            let sy = py + 2 * pawn_direction;
            if pawn.coord.y == special_row && in_bounds(px, sy) {
                let special_move = coord(px, sy);
                if !tile_is_occupied(special_move, pieces) {
                    moves.push(special_move);
                }
            }
        }
    }

    let ulx = px - 1;
    let uly = py + pawn_direction;
    if in_bounds(ulx, uly) {
        let upper_left_attack = coord(ulx, uly);
        if tile_is_occupied_by_opponent(upper_left_attack, pieces, pawn.team) {
            moves.push(upper_left_attack);
        } else if !tile_is_occupied(upper_left_attack, pieces) {
            if in_bounds(px - 1, py) {
                let left_position = coord(px - 1, py);
                if let Some(left_piece) = pieces.iter().find(|p| p.coord == left_position) {
                    if left_piece.en_passant {
                        moves.push(upper_left_attack);
                    }
                }
            }
        }
    }

    let urx = px + 1;
    let ury = py + pawn_direction;
    if in_bounds(urx, ury) {
        let upper_right_attack = coord(urx, ury);
        if tile_is_occupied_by_opponent(upper_right_attack, pieces, pawn.team) {
            moves.push(upper_right_attack);
        } else if !tile_is_occupied(upper_right_attack, pieces) {
            if in_bounds(px + 1, py) {
                let right_position = coord(px + 1, py);
                if let Some(right_piece) = pieces.iter().find(|p| p.coord == right_position) {
                    if right_piece.en_passant {
                        moves.push(upper_right_attack);
                    }
                }
            }
        }
    }

    moves
}
