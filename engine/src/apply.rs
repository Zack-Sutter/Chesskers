use crate::board::Board;
use crate::rules::{is_checkers_jump, jumped_piece, possible_checkers_moves};
use crate::state::{Coord, Move, PendingPromotion, PieceType, PromotionChoice, Team};

#[derive(Debug, Clone)]
pub struct ApplyMoveResult {
    pub ok: bool,
    pub board: Board,
    pub pending_promotion: Option<PendingPromotion>,
    pub is_capture: bool,
}

fn pawn_direction(team: Team) -> i32 {
    if team == Team::White {
        1
    } else {
        -1
    }
}

fn promotion_piece_type(choice: PromotionChoice) -> PieceType {
    match choice {
        PromotionChoice::Queen => PieceType::Queen,
        PromotionChoice::Rook => PieceType::Rook,
        PromotionChoice::Bishop => PieceType::Bishop,
        PromotionChoice::Knight => PieceType::Knight,
    }
}

fn is_en_passant_move(
    board: &Board,
    from: Coord,
    to: Coord,
    piece_type: PieceType,
    team: Team,
) -> bool {
    if piece_type != PieceType::Pawn {
        return false;
    }

    let dir = pawn_direction(team);
    let dx = i32::from(to.x) - i32::from(from.x);
    let dy = i32::from(to.y) - i32::from(from.y);

    if (dx == -1 || dx == 1) && dy == dir {
        let victim_y = (i32::from(to.y) - dir) as u8;
        return board.pieces.iter().any(|p| {
            p.piece_type == PieceType::Pawn
                && p.coord.x == to.x
                && p.coord.y == victim_y
                && p.en_passant
        });
    }

    false
}

fn apply_promotion_choice(board: &mut Board, position: Coord, promotion: PromotionChoice) {
    let piece_type = promotion_piece_type(promotion);
    for piece in &mut board.pieces {
        if piece.coord == position {
            piece.piece_type = piece_type;
            piece.has_moved = true;
            piece.en_passant = false;
        }
    }
}

impl Board {
    fn play_move(
        &mut self,
        en_passant: bool,
        played_from: Coord,
        played_type: PieceType,
        played_team: Team,
        destination: Coord,
    ) -> bool {
        let dir = pawn_direction(played_team);

        if played_type == PieceType::King {
            if let Some(dest_piece) = self.pieces.iter().find(|p| p.coord == destination) {
                if dest_piece.piece_type == PieceType::Rook && dest_piece.team == played_team {
                    let king_x = played_from.x;
                    let rook_x = destination.x;
                    let direction = if i32::from(rook_x) - i32::from(king_x) > 0 {
                        1
                    } else {
                        -1
                    };
                    let new_king_x = (i32::from(king_x) + direction * 2) as u8;
                    let new_rook_x = (i32::from(new_king_x) - direction) as u8;

                    for piece in &mut self.pieces {
                        if piece.coord == played_from {
                            piece.coord.x = new_king_x;
                        } else if piece.coord == destination {
                            piece.coord.x = new_rook_x;
                        }
                    }

                    self.calculate_all_moves();
                    return true;
                }
            }
        }

        if en_passant {
            let victim_y = (i32::from(destination.y) - dir) as u8;
            let mut next_pieces = Vec::with_capacity(self.pieces.len());

            for mut piece in self.pieces.drain(..) {
                if piece.coord == played_from {
                    piece.coord = destination;
                    piece.has_moved = true;
                    if piece.piece_type == PieceType::Pawn {
                        piece.en_passant = false;
                    }
                    next_pieces.push(piece);
                } else if piece.coord.x == destination.x && piece.coord.y == victim_y {
                    // captured pawn removed
                } else {
                    if piece.piece_type == PieceType::Pawn {
                        piece.en_passant = false;
                    }
                    next_pieces.push(piece);
                }
            }

            self.pieces = next_pieces;
            self.calculate_all_moves();
            return true;
        }

        let checkers_jump = played_type == PieceType::Checkers
            && is_checkers_jump(played_from, destination, &self.pieces, played_team);
        let jumped = if checkers_jump {
            jumped_piece(played_from, destination, &self.pieces).map(|p| p.coord)
        } else {
            None
        };

        let from_y = played_from.y;
        let mut next_pieces = Vec::with_capacity(self.pieces.len());

        for mut piece in self.pieces.drain(..) {
            if piece.coord == played_from {
                if piece.piece_type == PieceType::Pawn {
                    piece.en_passant =
                        (i32::from(from_y) - i32::from(destination.y)).unsigned_abs() == 2;
                }
                piece.coord = destination;
                piece.has_moved = true;
                next_pieces.push(piece);
            } else if jumped == Some(piece.coord) {
                // jumped piece removed by checkers hop
            } else if piece.coord != destination {
                if piece.piece_type == PieceType::Pawn {
                    piece.en_passant = false;
                }
                next_pieces.push(piece);
            }
        }

        self.pieces = next_pieces;
        self.calculate_all_moves();
        true
    }
}

pub fn apply_move(board: &Board, mv: &Move) -> ApplyMoveResult {
    let mut next_board = board.clone();
    let destination = mv.to;

    let Some(played_idx) = next_board.pieces.iter().position(|p| p.coord == mv.from) else {
        return ApplyMoveResult {
            ok: false,
            board: next_board,
            pending_promotion: None,
            is_capture: false,
        };
    };

    let played_from = next_board.pieces[played_idx].coord;
    let played_type = next_board.pieces[played_idx].piece_type;
    let played_team = next_board.pieces[played_idx].team;

    if let Some(hop) = next_board.checkers_hop_position {
        if played_from != hop {
            return ApplyMoveResult {
                ok: false,
                board: next_board,
                pending_promotion: None,
                is_capture: false,
            };
        }
    } else if played_team == Team::White && next_board.total_turns % 2 != 1 {
        return ApplyMoveResult {
            ok: false,
            board: next_board,
            pending_promotion: None,
            is_capture: false,
        };
    } else if played_team == Team::Black && next_board.total_turns % 2 != 0 {
        return ApplyMoveResult {
            ok: false,
            board: next_board,
            pending_promotion: None,
            is_capture: false,
        };
    }

    if !next_board.pieces[played_idx]
        .possible_moves
        .iter()
        .any(|c| *c == destination)
    {
        return ApplyMoveResult {
            ok: false,
            board: next_board,
            pending_promotion: None,
            is_capture: false,
        };
    }

    let en_passant =
        is_en_passant_move(&next_board, played_from, destination, played_type, played_team);
    let checkers_jump = played_type == PieceType::Checkers
        && is_checkers_jump(played_from, destination, &next_board.pieces, played_team);
    let is_capture = en_passant
        || checkers_jump
        || next_board
            .pieces
            .iter()
            .any(|p| p.coord == destination && p.team != played_team);

    if !next_board.play_move(
        en_passant,
        played_from,
        played_type,
        played_team,
        destination,
    ) {
        return ApplyMoveResult {
            ok: false,
            board: next_board,
            pending_promotion: None,
            is_capture: false,
        };
    }

    if next_board.winning_team.is_none() {
        if played_type == PieceType::Checkers && checkers_jump {
            let more_jumps = next_board
                .pieces
                .iter()
                .find(|p| {
                    p.piece_type == PieceType::Checkers
                        && p.team == played_team
                        && p.coord == destination
                })
                .is_some_and(|p| !possible_checkers_moves(p, &next_board.pieces, true).is_empty());

            if more_jumps {
                next_board.checkers_hop_position = Some(destination);
            } else {
                next_board.checkers_hop_position = None;
                next_board.total_turns += 1;
            }
        } else {
            next_board.checkers_hop_position = None;
            next_board.total_turns += 1;
        }
    }

    next_board.calculate_all_moves();

    let promotion_row = if played_team == Team::White { 7 } else { 0 };
    let mut pending_promotion = None;

    if destination.y == promotion_row && played_type == PieceType::Pawn {
        match mv.promotion {
            None => {
                pending_promotion = Some(PendingPromotion {
                    x: destination.x,
                    y: destination.y,
                    team: played_team,
                });
            }
            Some(choice) => {
                apply_promotion_choice(&mut next_board, destination, choice);
                next_board.calculate_all_moves();
            }
        }
    }

    ApplyMoveResult {
        ok: true,
        board: next_board,
        pending_promotion,
        is_capture,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{
        FixtureExpect, GoldenFixture, LegalMovesExpect, PieceAtExpect,
    };
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
            assert_eq!(
                a, b,
                "{fixture_name}: legal moves from ({},{}) mismatch",
                spec.from.x, spec.from.y
            );
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

    fn assert_fixture_expect(
        name: &str,
        expect: &FixtureExpect,
        board: &Board,
        apply_ok: Option<bool>,
        pending_promotion: Option<&PendingPromotion>,
        pre_apply_board: &Board,
    ) {
        if let Some(expected_ok) = expect.apply_ok {
            assert_eq!(
                apply_ok,
                Some(expected_ok),
                "{name}: applyOk mismatch"
            );
        }

        if let Some(expected_turns) = expect.total_turns {
            let turns = if apply_ok == Some(false) {
                pre_apply_board.total_turns
            } else {
                board.total_turns
            };
            assert_eq!(turns, expected_turns, "{name}: totalTurns mismatch");
        }

        if let Some(expected_hop) = &expect.checkers_hop_position {
            match expected_hop {
                None => assert!(
                    board.checkers_hop_position.is_none(),
                    "{name}: expected no checkersHopPosition"
                ),
                Some(hop) => assert_eq!(
                    board.checkers_hop_position,
                    Some(*hop),
                    "{name}: checkersHopPosition mismatch"
                ),
            }
        }

        if let Some(expected_promo) = &expect.pending_promotion {
            match expected_promo {
                None => assert!(
                    pending_promotion.is_none(),
                    "{name}: expected no pendingPromotion"
                ),
                Some(promo) => assert_eq!(
                    pending_promotion,
                    Some(promo),
                    "{name}: pendingPromotion mismatch"
                ),
            }
        }

        if let Some(winning_team) = expect.winning_team {
            assert_eq!(
                board.winning_team,
                Some(winning_team),
                "{name}: winningTeam mismatch"
            );
        }

        if let Some(count) = expect.piece_count {
            assert_eq!(board.pieces.len(), count, "{name}: pieceCount mismatch");
        }

        if let Some(piece_type) = expect.no_piece_type {
            assert!(
                !board.pieces.iter().any(|p| p.piece_type == piece_type),
                "{name}: expected no piece of type {piece_type:?}"
            );
        }

        if let Some(wants) = &expect.piece_at {
            for want in wants {
                assert_piece_at(name, board, want);
            }
        }

        if let Some(coords) = &expect.no_piece_at {
            for at in coords {
                assert!(
                    !board.pieces.iter().any(|p| p.coord == *at),
                    "{name}: unexpected piece at ({},{})",
                    at.x,
                    at.y
                );
            }
        }

        if let Some(specs) = &expect.legal_moves_from {
            for spec in specs {
                let moves = board.legal_moves_from(spec.from);
                assert_legal_moves(name, spec, &moves);
            }
        }
    }

    fn assert_piece_at(name: &str, board: &Board, want: &PieceAtExpect) {
        let found = board.pieces.iter().any(|p| {
            p.coord.x == want.x && p.coord.y == want.y && p.piece_type == want.piece_type
        });
        assert!(
            found,
            "{name}: missing {:?} at ({},{})",
            want.piece_type, want.x, want.y
        );
    }

    #[test]
    fn fixture_replay_apply_move() {
        for fixture in load_fixtures() {
            let Some(action) = &fixture.action else {
                continue;
            };

            let mut board = Board::from_serialized(&fixture.board);
            board.calculate_all_moves();

            let pre_apply = board.clone();
            let result = apply_move(&board, &action.mv);

            assert_fixture_expect(
                &fixture.name,
                &fixture.expect,
                &result.board,
                Some(result.ok),
                result.pending_promotion.as_ref(),
                &pre_apply,
            );
        }
    }
}
