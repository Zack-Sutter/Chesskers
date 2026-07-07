use crate::board::Piece;
use crate::state::{Coord, Team};

pub const BOARD_DIM: i32 = 8;

pub fn wrap_coord(n: i32) -> u8 {
    ((n % BOARD_DIM + BOARD_DIM) % BOARD_DIM) as u8
}

pub fn tile_is_occupied(coord: Coord, pieces: &[Piece]) -> bool {
    pieces.iter().any(|p| p.coord == coord)
}

pub fn tile_is_occupied_by_opponent(coord: Coord, pieces: &[Piece], team: Team) -> bool {
    pieces
        .iter()
        .any(|p| p.coord == coord && p.team != team)
}

pub fn tile_is_empty_or_occupied_by_opponent(coord: Coord, pieces: &[Piece], team: Team) -> bool {
    !tile_is_occupied(coord, pieces) || tile_is_occupied_by_opponent(coord, pieces, team)
}

pub fn coord(x: i32, y: i32) -> Coord {
    Coord {
        x: x as u8,
        y: y as u8,
    }
}

pub fn in_bounds(x: i32, y: i32) -> bool {
    (0..BOARD_DIM).contains(&x) && (0..BOARD_DIM).contains(&y)
}
