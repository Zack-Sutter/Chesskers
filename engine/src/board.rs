use std::collections::HashMap;

use crate::rules::{
    castling_moves, possible_bishop_moves, possible_checkers_moves, possible_king_moves,
    possible_knight_moves, possible_pawn_moves, possible_queen_moves, possible_rook_moves,
};
use crate::state::{Coord, Move, PieceType, SerializedBoard, SerializedPiece, Team};

#[derive(Debug, Clone)]
pub struct Piece {
    pub coord: Coord,
    pub piece_type: PieceType,
    pub team: Team,
    pub has_moved: bool,
    pub en_passant: bool,
    pub possible_moves: Vec<Coord>,
}

#[derive(Debug, Clone)]
pub struct Board {
    pub pieces: Vec<Piece>,
    pub total_turns: u32,
    pub winning_team: Option<Team>,
    pub checkers_hop_position: Option<Coord>,
    pub is_draw: bool,
  // ponytail: string-keyed HashMap per game; upgrade path is Zobrist + count vec
    pub position_counts: HashMap<String, u32>,
}

impl From<SerializedPiece> for Piece {
    fn from(sp: SerializedPiece) -> Self {
        Self {
            coord: Coord {
                x: sp.x,
                y: sp.y,
            },
            piece_type: sp.piece_type,
            team: sp.team,
            has_moved: sp.has_moved,
            en_passant: sp.en_passant.unwrap_or(false),
            possible_moves: Vec::new(),
        }
    }
}

impl Board {
    pub fn from_serialized(board: &SerializedBoard) -> Self {
        Self {
            pieces: board.pieces.clone().into_iter().map(Piece::from).collect(),
            total_turns: board.total_turns,
            winning_team: board.winning_team,
            checkers_hop_position: board.checkers_hop_position,
            is_draw: board.is_draw,
            position_counts: HashMap::new(),
        }
    }

    pub fn current_team(&self) -> Team {
        if self.total_turns % 2 == 0 {
            Team::Black
        } else {
            Team::White
        }
    }

    pub fn calculate_all_moves(&mut self) {
        self.winning_team = None;

        if !self.pieces.iter().any(|p| p.team == Team::Black) {
            self.winning_team = Some(Team::White);
            return;
        }

        if !self
            .pieces
            .iter()
            .any(|p| p.piece_type == PieceType::King && p.team == Team::White)
        {
            self.winning_team = Some(Team::Black);
            return;
        }

        let hop = self.checkers_hop_position;
        let pieces_snapshot: Vec<Piece> = self.pieces.clone();

        for i in 0..self.pieces.len() {
            let piece = &pieces_snapshot[i];
            let moves = piece_valid_moves(piece, &pieces_snapshot, hop);
            self.pieces[i].possible_moves = moves;
        }

        if let Some(hop_pos) = hop {
            let current = self.current_team();
            for piece in self.pieces.iter_mut().filter(|p| p.team == current) {
                if piece.coord != hop_pos {
                    piece.possible_moves.clear();
                }
            }
        }

        let kings: Vec<usize> = self
            .pieces
            .iter()
            .enumerate()
            .filter(|(_, p)| p.piece_type == PieceType::King)
            .map(|(i, _)| i)
            .collect();

        for idx in kings {
            let extra = castling_moves(&self.pieces[idx], &self.pieces);
            self.pieces[idx].possible_moves.extend(extra);
        }

        let current = self.current_team();
        for piece in self.pieces.iter_mut().filter(|p| p.team != current) {
            piece.possible_moves.clear();
        }
    }

    pub fn legal_moves_from(&self, from: Coord) -> Vec<Coord> {
        self.pieces
            .iter()
            .find(|p| p.coord == from)
            .map(|p| p.possible_moves.clone())
            .unwrap_or_default()
    }

    pub fn all_legal_moves(&self) -> Vec<Move> {
        let mut moves = Vec::new();
        for piece in &self.pieces {
            for to in &piece.possible_moves {
                moves.push(Move {
                    from: piece.coord,
                    to: *to,
                    promotion: None,
                });
            }
        }
        moves
    }

    pub fn to_serialized(&self) -> SerializedBoard {
        SerializedBoard {
            schema_version: 1,
            pieces: self
                .pieces
                .iter()
                .map(|p| SerializedPiece {
                    x: p.coord.x,
                    y: p.coord.y,
                    piece_type: p.piece_type,
                    team: p.team,
                    has_moved: p.has_moved,
                    en_passant: (p.piece_type == PieceType::Pawn && p.en_passant).then_some(true),
                })
                .collect(),
            total_turns: self.total_turns,
            checkers_hop_position: self.checkers_hop_position,
            winning_team: self.winning_team,
            is_draw: self.is_draw,
        }
    }

    /// Starting position — mirrors `packages/game-engine/src/boardConstants.ts`.
    pub fn initial() -> Self {
        fn piece(x: u8, y: u8, piece_type: PieceType, team: Team) -> Piece {
            Piece {
                coord: Coord { x, y },
                piece_type,
                team,
                has_moved: false,
                en_passant: false,
                possible_moves: Vec::new(),
            }
        }

        let mut board = Self {
            pieces: vec![
                piece(2, 6, PieceType::Checkers, Team::Black),
                piece(3, 6, PieceType::Checkers, Team::Black),
                piece(4, 6, PieceType::Checkers, Team::Black),
                piece(5, 6, PieceType::Checkers, Team::Black),
                piece(0, 0, PieceType::Rook, Team::White),
                piece(1, 0, PieceType::Knight, Team::White),
                piece(2, 0, PieceType::Bishop, Team::White),
                piece(3, 0, PieceType::Queen, Team::White),
                piece(4, 0, PieceType::King, Team::White),
                piece(5, 0, PieceType::Bishop, Team::White),
                piece(6, 0, PieceType::Knight, Team::White),
                piece(7, 0, PieceType::Rook, Team::White),
                piece(0, 1, PieceType::Pawn, Team::White),
                piece(1, 1, PieceType::Pawn, Team::White),
                piece(2, 1, PieceType::Pawn, Team::White),
                piece(3, 1, PieceType::Pawn, Team::White),
                piece(4, 1, PieceType::Pawn, Team::White),
                piece(5, 1, PieceType::Pawn, Team::White),
                piece(6, 1, PieceType::Pawn, Team::White),
                piece(7, 1, PieceType::Pawn, Team::White),
            ],
            total_turns: 1,
            winning_team: None,
            checkers_hop_position: None,
            is_draw: false,
            position_counts: HashMap::new(),
        };
        board.calculate_all_moves();
        board
    }
}

fn piece_valid_moves(piece: &Piece, board_state: &[Piece], hop: Option<Coord>) -> Vec<Coord> {
    match piece.piece_type {
        PieceType::Pawn => possible_pawn_moves(piece, board_state),
        PieceType::Knight => possible_knight_moves(piece, board_state),
        PieceType::Bishop => possible_bishop_moves(piece, board_state),
        PieceType::Rook => possible_rook_moves(piece, board_state),
        PieceType::Queen => possible_queen_moves(piece, board_state),
        PieceType::King => possible_king_moves(piece, board_state),
        PieceType::Checkers => {
            let hop_continuation = hop.is_some_and(|pos| pos == piece.coord);
            possible_checkers_moves(piece, board_state, hop_continuation)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{FixtureExpect, GoldenFixture, LegalMovesExpect};
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

    fn assert_legal_moves(fixture_name: &str, spec: &LegalMovesExpect, moves: &[Coord]) {
        if let Some(exact) = &spec.exact {
            let mut a: Vec<_> = moves.iter().map(|c| (c.x, c.y)).collect();
            let mut b: Vec<_> = exact.iter().map(|c| (c.x, c.y)).collect();
            a.sort();
            b.sort();
            assert_eq!(a, b, "{fixture_name}: legal moves from ({},{}) mismatch", spec.from.x, spec.from.y);
        }
        if let Some(include) = &spec.include {
            for inc in include {
                assert!(
                    moves.iter().any(|m| m.x == inc.x && m.y == inc.y),
                    "{fixture_name}: expected move to ({},{}) from ({},{})",
                    inc.x,
                    inc.y,
                    spec.from.x,
                    spec.from.y
                );
            }
        }
        if let Some(exclude) = &spec.exclude {
            for exc in exclude {
                assert!(
                    !moves.iter().any(|m| m.x == exc.x && m.y == exc.y),
                    "{fixture_name}: unexpected move to ({},{}) from ({},{})",
                    exc.x,
                    exc.y,
                    spec.from.x,
                    spec.from.y
                );
            }
        }
    }

    fn assert_fixture_rules(fixture: &GoldenFixture) {
        if fixture.action.is_some() {
            return;
        }

        let mut board = Board::from_serialized(&fixture.board);
        board.calculate_all_moves();
        assert_fixture_expect(&fixture.name, &fixture.expect, &board);
    }

    fn assert_fixture_expect(name: &str, expect: &FixtureExpect, board: &Board) {
        if let Some(winning_team) = expect.winning_team {
            assert_eq!(
                board.winning_team,
                Some(winning_team),
                "{name}: winningTeam mismatch"
            );
        }

        if let Some(specs) = &expect.legal_moves_from {
            for spec in specs {
                let moves = board.legal_moves_from(spec.from);
                assert_legal_moves(name, spec, &moves);
            }
        }
    }

    #[test]
    fn fixture_legal_moves_and_terminal_assertions() {
        for fixture in load_fixtures() {
            assert_fixture_rules(&fixture);
        }
    }

    #[test]
    fn initial_board_matches_fixture() {
        let fixture = load_fixtures()
            .into_iter()
            .find(|f| f.name == "initial_board")
            .expect("initial_board fixture");
        let board = Board::initial();
        assert_eq!(board.pieces.len(), 20);
        assert_eq!(
            board
                .pieces
                .iter()
                .filter(|p| p.piece_type == PieceType::Checkers)
                .count(),
            4
        );
        assert_eq!(board.to_serialized(), fixture.board);
    }

    #[test]
    fn detects_black_winner_when_no_white_king() {
        let mut board = Board::from_serialized(&SerializedBoard {
            schema_version: 1,
            pieces: vec![SerializedPiece {
                x: 3,
                y: 6,
                piece_type: PieceType::Checkers,
                team: Team::Black,
                has_moved: false,
                en_passant: None,
            }],
            total_turns: 1,
            checkers_hop_position: None,
            winning_team: None,
            is_draw: false,
        });
        board.calculate_all_moves();
        assert_eq!(board.winning_team, Some(Team::Black));
    }
}
