mod checkers;
mod chess;
mod general;
mod pawn;

pub use checkers::{is_checkers_jump, jumped_piece, possible_checkers_moves};
pub use chess::{castling_moves, possible_bishop_moves, possible_king_moves, possible_knight_moves, possible_queen_moves, possible_rook_moves};
pub use pawn::possible_pawn_moves;
