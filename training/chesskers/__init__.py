"""Chesskers Python rules mirror (offline training).

Shares no runtime code with the UI/server/Rust engine — parity is guaranteed
only through ``fixtures/*.json``. See docs/architecture.md §7 T1-2.
"""

from .encoder import encode, encode_serialized, tensor_fnv1a
from .move_index import POLICY_SIZE, move_index
from .repetition import init_position_tracking, is_terminal_board, position_key, record_position
from .rules import (
    ApplyMoveResult,
    Board,
    PendingPromotion,
    Piece,
    apply_move,
)

__all__ = [
    "ApplyMoveResult",
    "Board",
    "PendingPromotion",
    "Piece",
    "POLICY_SIZE",
    "apply_move",
    "encode",
    "encode_serialized",
    "init_position_tracking",
    "is_terminal_board",
    "move_index",
    "position_key",
    "record_position",
    "tensor_fnv1a",
]
