//! Board → NN input tensor (encoder_v1). Layout: [16, 8, 8] row-major flat.
//! Spec: docs/architecture.md §5.4

use crate::board::Board;
use crate::state::{PieceType, SerializedBoard, Team};

pub const NUM_PLANES: usize = 16;
pub const BOARD_DIM: usize = 8;
pub const PLANE_SIZE: usize = BOARD_DIM * BOARD_DIM;
pub const TENSOR_LEN: usize = NUM_PLANES * PLANE_SIZE;

pub const PLANE_SIDE_TO_MOVE: usize = 14;
pub const PLANE_CHECKERS_HOP: usize = 15;

/// Flat index for plane `p`, board square `(x, y)`.
#[inline]
pub fn tensor_index(plane: usize, x: u8, y: u8) -> usize {
    plane * PLANE_SIZE + usize::from(y) * BOARD_DIM + usize::from(x)
}

/// Encode board state to a `[16, 8, 8]` tensor flattened in plane-major order.
pub fn encode(board: &Board) -> [f32; TENSOR_LEN] {
    let mut out = [0.0f32; TENSOR_LEN];

    for piece in &board.pieces {
        let plane = piece_plane(piece.team, piece.piece_type);
        out[tensor_index(plane, piece.coord.x, piece.coord.y)] = 1.0;
    }

    let side = if board.current_team() == Team::White {
        1.0
    } else {
        0.0
    };
    fill_plane(&mut out, PLANE_SIDE_TO_MOVE, side);

    if let Some(pos) = board.checkers_hop_position {
        out[tensor_index(PLANE_CHECKERS_HOP, pos.x, pos.y)] = 1.0;
    }

    out
}

pub fn encode_serialized(board: &SerializedBoard) -> [f32; TENSOR_LEN] {
    encode(&Board::from_serialized(board))
}

fn piece_plane(team: Team, piece_type: PieceType) -> usize {
    let base = match team {
        Team::White => 0,
        Team::Black => 7,
    };
    base + piece_type_plane_offset(piece_type)
}

fn piece_type_plane_offset(piece_type: PieceType) -> usize {
    match piece_type {
        PieceType::Pawn => 0,
        PieceType::Rook => 1,
        PieceType::Bishop => 2,
        PieceType::Knight => 3,
        PieceType::Queen => 4,
        PieceType::King => 5,
        PieceType::Checkers => 6,
    }
}

fn fill_plane(tensor: &mut [f32; TENSOR_LEN], plane: usize, value: f32) {
    let start = plane * PLANE_SIZE;
    tensor[start..start + PLANE_SIZE].fill(value);
}

/// ponytail: FNV-1a over float bits — stable cross-language golden check (exact match, no float tolerance).
pub fn tensor_fnv1a(tensor: &[f32; TENSOR_LEN]) -> u64 {
    let mut hash = 0xcbf29ce484222325u64;
    for &v in tensor {
        hash ^= v.to_bits() as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::GoldenFixture;
    use std::collections::HashMap;
    use std::fs;
    use std::path::PathBuf;

    fn fixtures_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../fixtures")
    }

    fn load_fixtures() -> Vec<GoldenFixture> {
        let dir = fixtures_dir();
        let mut fixtures = Vec::new();
        for entry in fs::read_dir(&dir).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let json = fs::read_to_string(&path).unwrap();
            fixtures.push(GoldenFixture::from_json(&json).unwrap());
        }
        fixtures.sort_by(|a, b| a.name.cmp(&b.name));
        fixtures
    }

    fn count_plane_ones(tensor: &[f32; TENSOR_LEN], plane: usize) -> usize {
        let start = plane * PLANE_SIZE;
        tensor[start..start + PLANE_SIZE]
            .iter()
            .filter(|&&v| v == 1.0)
            .count()
    }

    fn assert_binary(tensor: &[f32; TENSOR_LEN], name: &str) {
        for (i, &v) in tensor.iter().enumerate() {
            assert!(
                v == 0.0 || v == 1.0,
                "{name}: non-binary value {v} at index {i}"
            );
        }
    }

    fn assert_piece_planes_match_board(name: &str, board: &Board, tensor: &[f32; TENSOR_LEN]) {
        for piece in &board.pieces {
            let plane = piece_plane(piece.team, piece.piece_type);
            let idx = tensor_index(plane, piece.coord.x, piece.coord.y);
            assert_eq!(
                tensor[idx], 1.0,
                "{name}: missing piece {:?} {:?} at ({},{}) plane {plane}",
                piece.team, piece.piece_type, piece.coord.x, piece.coord.y
            );
        }

        let mut occupied: HashMap<(u8, u8), usize> = HashMap::new();
        for plane in 0..14 {
            for y in 0..8u8 {
                for x in 0..8u8 {
                    if tensor[tensor_index(plane, x, y)] == 1.0 {
                        *occupied.entry((x, y)).or_insert(0) += 1;
                    }
                }
            }
        }
        assert_eq!(
            occupied.len(),
            board.pieces.len(),
            "{name}: piece-plane occupancy count mismatch"
        );
        for count in occupied.values() {
            assert_eq!(*count, 1, "{name}: overlapping piece planes");
        }
    }

    fn assert_meta_planes(name: &str, board: &Board, tensor: &[f32; TENSOR_LEN]) {
        let expected_side = if board.current_team() == Team::White {
            1.0
        } else {
            0.0
        };
        let start = PLANE_SIDE_TO_MOVE * PLANE_SIZE;
        for &v in &tensor[start..start + PLANE_SIZE] {
            assert_eq!(v, expected_side, "{name}: side-to-move plane mismatch");
        }

        let hop_start = PLANE_CHECKERS_HOP * PLANE_SIZE;
        let hop_ones = tensor[hop_start..hop_start + PLANE_SIZE]
            .iter()
            .filter(|&&v| v == 1.0)
            .count();
        match board.checkers_hop_position {
            Some(pos) => {
                assert_eq!(hop_ones, 1, "{name}: expected one hop-lock square");
                assert_eq!(
                    tensor[tensor_index(PLANE_CHECKERS_HOP, pos.x, pos.y)],
                    1.0,
                    "{name}: hop-lock at wrong square"
                );
            }
            None => assert_eq!(hop_ones, 0, "{name}: unexpected hop-lock"),
        }
    }

    #[test]
    fn initial_board_tensor_layout() {
        let json = fs::read_to_string(fixtures_dir().join("initial_board.json")).unwrap();
        let fixture = GoldenFixture::from_json(&json).unwrap();
        let board = Board::from_serialized(&fixture.board);
        let tensor = encode(&board);

        assert_eq!(count_plane_ones(&tensor, 0), 8, "white pawns");
        assert_eq!(count_plane_ones(&tensor, 1), 2, "white rooks");
        assert_eq!(count_plane_ones(&tensor, 2), 2, "white bishops");
        assert_eq!(count_plane_ones(&tensor, 3), 2, "white knights");
        assert_eq!(count_plane_ones(&tensor, 4), 1, "white queen");
        assert_eq!(count_plane_ones(&tensor, 5), 1, "white king");
        assert_eq!(count_plane_ones(&tensor, 13), 4, "black checkers");
        assert_eq!(tensor[tensor_index(14, 0, 0)], 1.0, "white to move");
    }

    #[test]
    fn encodes_all_fixtures_with_binary_planes() {
        for fixture in load_fixtures() {
            let board = Board::from_serialized(&fixture.board);
            let tensor = encode(&board);
            assert_binary(&tensor, &fixture.name);
            assert_piece_planes_match_board(&fixture.name, &board, &tensor);
            assert_meta_planes(&fixture.name, &board, &tensor);
        }
    }

    #[test]
    #[ignore = "run with --ignored --nocapture to regenerate golden hashes"]
    fn print_fixture_tensor_golden_hashes() {
        for fixture in load_fixtures() {
            let board = Board::from_serialized(&fixture.board);
            let hash = tensor_fnv1a(&encode(&board));
            println!("(\"{}\", 0x{:016x}),", fixture.name, hash);
        }
    }

    // Golden FNV-1a hashes for cross-language fixture sync (T1-3 Python encoder).
    // Exact match — values are strictly 0.0 or 1.0, no float tolerance needed.
    #[test]
    fn fixture_tensor_golden_hashes() {
        let expected: &[(&str, u64)] = &[
            ("checkers_hop_chain_keeps_turn", 0x27c653ebf8287325),
            ("checkers_hop_continuation_jump_only", 0x53090cd4c5a87325),
            ("checkers_no_adjacent_king_step_capture", 0x7392746f62a87325),
            ("checkers_orthogonal_hop_removes_pawn", 0x2f0d6c15c8a87325),
            ("checkers_single_hop_removes_pawn", 0xeef6ba9a46a87325),
            ("checkers_wrapped_diagonal_hop_corner", 0x9cfc52c661a87325),
            ("checkers_wrapped_orthogonal_hop_left_edge", 0x70645c24d0a87325),
            ("checkers_wrapped_step_left_edge", 0xe859ebaf46287325),
            ("declares_black_winner_when_white_king_hopped", 0xfc0ede8c89287325),
            ("declares_white_winner_when_no_black_pieces", 0xa936d00e0ba87325),
            ("initial_board", 0x52fe4ddd45287325),
            ("pawn_reaches_back_rank_pending_promotion", 0xa1cd68d48ca87325),
            ("rejects_move_on_wrong_turn", 0x071f0a99afa87325),
        ];

        let mut by_name: HashMap<&str, u64> = expected.iter().copied().collect();
        for fixture in load_fixtures() {
            let board = Board::from_serialized(&fixture.board);
            let hash = tensor_fnv1a(&encode(&board));
            let Some(want) = by_name.remove(fixture.name.as_str()) else {
                panic!("missing golden hash for fixture {}", fixture.name);
            };
            assert_eq!(
                hash, want,
                "encoder golden hash mismatch for {} (update if encoder_v1 spec changed)",
                fixture.name
            );
        }
        assert!(by_name.is_empty(), "stale golden hashes: {by_name:?}");
    }
}
