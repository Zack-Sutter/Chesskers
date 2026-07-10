"""Tests for threefold repetition draw detection."""

from chesskers import Board, Piece
from chesskers.repetition import (
    init_position_tracking,
    is_terminal_board,
    position_key,
    record_position,
)


def _board(pieces, total_turns=1):
    return Board(pieces=pieces, total_turns=total_turns)


def test_position_key_stable_across_piece_order():
    a = _board([Piece(0, 0, "king", "w"), Piece(3, 6, "checkers", "b")])
    b = _board([Piece(3, 6, "checkers", "b"), Piece(0, 0, "king", "w")])
    assert position_key(a) == position_key(b)


def test_position_key_ignores_total_turns_when_side_matches():
    a = _board([Piece(4, 0, "king", "w")], total_turns=1)
    b = _board([Piece(4, 0, "king", "w")], total_turns=5)
    assert position_key(a) == position_key(b)


def test_declares_draw_on_third_identical_position():
    board = init_position_tracking(_board([Piece(4, 0, "king", "w")]))
    key = position_key(board)

    record_position(board)
    assert not board.is_draw
    assert board.position_counts[key] == 2

    record_position(board)
    assert board.is_draw
    assert board.position_counts[key] == 3
    assert is_terminal_board(board)


def test_skips_record_when_already_won():
    board = init_position_tracking(_board([Piece(4, 0, "king", "w")]))
    board.winning_team = "w"
    record_position(board)
    assert len(board.position_counts) == 1
    assert not board.is_draw
