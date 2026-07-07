"""Fixture-parity tests for the Python rules mirror (T1-2).

Loads every ``fixtures/*.json`` golden case and asserts the Python mirror
produces the same legal moves, terminal states, and apply-move results as the
TypeScript/Rust engines. Fixtures are the single source of truth (architecture
§8): never hand-author expectations here without a fixture backing them.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from chesskers import Board, apply_move

FIXTURES_DIR = Path(__file__).resolve().parents[2] / "fixtures"


def _load_fixtures() -> list[dict]:
    files = sorted(FIXTURES_DIR.glob("*.json"))
    assert files, f"no fixtures found in {FIXTURES_DIR}"
    return [json.loads(f.read_text(encoding="utf-8")) for f in files]


FIXTURES = _load_fixtures()


def _assert_legal_moves(name: str, board: Board, spec: dict) -> None:
    from_ = (spec["from"]["x"], spec["from"]["y"])
    moves = board.legal_moves_from(from_)
    move_set = set(moves)

    if "exact" in spec:
        expected = {(c["x"], c["y"]) for c in spec["exact"]}
        assert move_set == expected, f"{name}: legal moves from {from_} mismatch: {move_set} != {expected}"
    for inc in spec.get("include", []):
        assert (inc["x"], inc["y"]) in move_set, f"{name}: expected move to ({inc['x']},{inc['y']}) from {from_}"
    for exc in spec.get("exclude", []):
        assert (exc["x"], exc["y"]) not in move_set, f"{name}: unexpected move to ({exc['x']},{exc['y']}) from {from_}"


def _assert_expect(name: str, expect: dict, board: Board, result=None) -> None:
    if "applyOk" in expect:
        assert result is not None, f"{name}: applyOk expected but fixture has no action"
        assert result.ok == expect["applyOk"], f"{name}: applyOk mismatch"

    if "totalTurns" in expect:
        assert board.total_turns == expect["totalTurns"], f"{name}: totalTurns mismatch"

    if "checkersHopPosition" in expect:
        exp = expect["checkersHopPosition"]
        if exp is None:
            assert board.checkers_hop_position is None, f"{name}: expected no checkersHopPosition"
        else:
            assert board.checkers_hop_position == (exp["x"], exp["y"]), f"{name}: checkersHopPosition mismatch"

    if "pendingPromotion" in expect:
        exp = expect["pendingPromotion"]
        pp = result.pending_promotion if result else None
        if exp is None:
            assert pp is None, f"{name}: expected no pendingPromotion"
        else:
            assert pp is not None and (pp.x, pp.y, pp.team) == (exp["x"], exp["y"], exp["team"]), \
                f"{name}: pendingPromotion mismatch"

    if "winningTeam" in expect:
        assert board.winning_team == expect["winningTeam"], f"{name}: winningTeam mismatch"

    if "pieceCount" in expect:
        assert len(board.pieces) == expect["pieceCount"], f"{name}: pieceCount mismatch"

    if "noPieceType" in expect:
        assert not any(p.type == expect["noPieceType"] for p in board.pieces), \
            f"{name}: expected no piece of type {expect['noPieceType']}"

    for want in expect.get("pieceAt", []):
        assert any(p.x == want["x"] and p.y == want["y"] and p.type == want["type"] for p in board.pieces), \
            f"{name}: missing {want['type']} at ({want['x']},{want['y']})"

    for at in expect.get("noPieceAt", []):
        assert not any(p.coord == (at["x"], at["y"]) for p in board.pieces), \
            f"{name}: unexpected piece at ({at['x']},{at['y']})"

    for spec in expect.get("legalMovesFrom", []):
        _assert_legal_moves(name, board, spec)


@pytest.mark.parametrize("fixture", FIXTURES, ids=[f["name"] for f in FIXTURES])
def test_fixture(fixture: dict) -> None:
    name = fixture["name"]
    board = Board.from_serialized(fixture["board"])
    board.calculate_all_moves()

    result = None
    if "action" in fixture:
        result = apply_move(board, fixture["action"]["move"])
        board = result.board

    _assert_expect(name, fixture["expect"], board, result)
