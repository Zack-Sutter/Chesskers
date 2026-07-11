"""Initial-board mirror tests (V2-R2)."""

from __future__ import annotations

import json
from pathlib import Path

from chesskers import initial_board

FIXTURES_DIR = Path(__file__).resolve().parents[2] / "fixtures"


def test_initial_board_matches_fixture() -> None:
    fixture = json.loads((FIXTURES_DIR / "initial_board.json").read_text(encoding="utf-8"))
    board = initial_board()

    assert len(board.pieces) == 20
    checkers = sorted((p.x, p.y) for p in board.pieces if p.type == "checkers")
    assert checkers == [(2, 6), (3, 6), (4, 6), (5, 6)]
    assert board.to_serialized() == fixture["board"]
