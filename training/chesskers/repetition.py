"""Position repetition tracking for draw-by-threefold (mirrors game-engine)."""

from __future__ import annotations

import json
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .rules import Board


def _piece_key(piece) -> str:
    en_passant = "1" if piece.type == "pawn" and piece.en_passant else "0"
    return (
        f"{piece.x},{piece.y}:{piece.type}:{piece.team}:"
        f"{'1' if piece.has_moved else '0'}:{en_passant}"
    )


def position_key(board: Board) -> str:
    pieces = sorted(_piece_key(p) for p in board.pieces)
    hop = ""
    if board.checkers_hop_position is not None:
        hop = f"{board.checkers_hop_position[0]},{board.checkers_hop_position[1]}"
    return json.dumps(
        {"pieces": pieces, "totalTurns": board.total_turns, "hop": hop},
        separators=(",", ":"),
    )


def init_position_tracking(board: Board) -> Board:
    board.position_counts = {}
    board.is_draw = False
    board.position_counts[position_key(board)] = 1
    return board


def record_position(board: Board) -> None:
    if board.winning_team is not None or board.is_draw:
        return
    if not board.position_counts:
        init_position_tracking(board)
        return
    key = position_key(board)
    count = board.position_counts.get(key, 0) + 1
    board.position_counts[key] = count
    if count >= 3:
        board.is_draw = True


def is_terminal_board(board: Board) -> bool:
    return board.winning_team is not None or board.is_draw
