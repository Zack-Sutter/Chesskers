use crate::board::Piece;
use crate::state::{Coord, Team};

use super::general::{
    coord, tile_is_occupied, tile_is_occupied_by_opponent,
};

pub fn possible_pawn_moves(pawn: &Piece, pieces: &[Piece]) -> Vec<Coord> {
    let special_row = if pawn.team == Team::White { 1 } else { 6 };
    let pawn_direction = if pawn.team == Team::White { 1 } else { -1 };
    let px = i32::from(pawn.coord.x);
    let py = i32::from(pawn.coord.y);

    let normal_move = coord(px, py + pawn_direction);
    let special_move = coord(px, py + 2 * pawn_direction);
    let upper_left_attack = coord(px - 1, py + pawn_direction);
    let upper_right_attack = coord(px + 1, py + pawn_direction);
    let left_position = coord(px - 1, py);
    let right_position = coord(px + 1, py);

    let mut moves = Vec::new();

    if !tile_is_occupied(normal_move, pieces) {
        moves.push(normal_move);
        if pawn.coord.y == special_row && !tile_is_occupied(special_move, pieces) {
            moves.push(special_move);
        }
    }

    if tile_is_occupied_by_opponent(upper_left_attack, pieces, pawn.team) {
        moves.push(upper_left_attack);
    } else if !tile_is_occupied(upper_left_attack, pieces) {
        if let Some(left_piece) = pieces.iter().find(|p| p.coord == left_position) {
            if left_piece.en_passant {
                moves.push(upper_left_attack);
            }
        }
    }

    if tile_is_occupied_by_opponent(upper_right_attack, pieces, pawn.team) {
        moves.push(upper_right_attack);
    } else if !tile_is_occupied(upper_right_attack, pieces) {
        if let Some(right_piece) = pieces.iter().find(|p| p.coord == right_position) {
            if right_piece.en_passant {
                moves.push(upper_right_attack);
            }
        }
    }

    moves
}
