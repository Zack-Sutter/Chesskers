"""Encoder parity tests for encoder_v1 (T1-3).

Asserts the Python encoder (``chesskers/encoder.py``) produces byte-identical
tensors to the Rust encoder (``engine/src/encoder.rs``) on every
``fixtures/*.json`` case. Parity is checked via FNV-1a golden hashes copied from
``engine/src/encoder.rs::fixture_tensor_golden_hashes``. Values are strictly
0.0/1.0, so the match is exact (architecture §5.4). If the encoder_v1 spec
changes, regenerate hashes on both sides and bump to encoder_v2.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from chesskers import Board
from chesskers.encoder import encode, tensor_fnv1a

FIXTURES_DIR = Path(__file__).resolve().parents[2] / "fixtures"

# Golden hashes from engine/src/encoder.rs (single source of truth for parity).
GOLDEN_HASHES: dict[str, int] = {
    "checkers_hop_chain_keeps_turn": 0x27C653EBF8287325,
    "checkers_hop_continuation_jump_only": 0x53090CD4C5A87325,
    "checkers_no_adjacent_king_step_capture": 0x7392746F62A87325,
    "checkers_orthogonal_hop_removes_pawn": 0x2F0D6C15C8A87325,
    "checkers_single_hop_removes_pawn": 0xEEF6BA9A46A87325,
    "checkers_wrapped_diagonal_hop_corner": 0x9CFC52C661A87325,
    "checkers_wrapped_orthogonal_hop_left_edge": 0x70645C24D0A87325,
    "checkers_wrapped_step_left_edge": 0xE859EBAF46287325,
    "declares_black_winner_when_white_king_hopped": 0xFC0EDE8C89287325,
    "declares_white_winner_when_no_black_pieces": 0xA936D00E0BA87325,
<<<<<<< HEAD
    "initial_board": 0x52FE4DDD45287325,
=======
    "initial_board": 0x84DB03D610A87325,
>>>>>>> 4107f54961c92f1d1aa746e90f5023c5abf3f2ea
    "pawn_reaches_back_rank_pending_promotion": 0xA1CD68D48CA87325,
    "rejects_move_on_wrong_turn": 0x071F0A99AFA87325,
}


def _load_fixtures() -> list[dict]:
    files = sorted(FIXTURES_DIR.glob("*.json"))
    assert files, f"no fixtures found in {FIXTURES_DIR}"
    return [json.loads(f.read_text(encoding="utf-8")) for f in files]


FIXTURES = _load_fixtures()


@pytest.mark.parametrize("fixture", FIXTURES, ids=[f["name"] for f in FIXTURES])
def test_encoder_matches_rust_golden_hash(fixture: dict) -> None:
    name = fixture["name"]
    assert name in GOLDEN_HASHES, f"{name}: no golden hash — add it from engine/src/encoder.rs"

    board = Board.from_serialized(fixture["board"])
    board.calculate_all_moves()
    tensor = encode(board)

    assert tensor.shape == (16, 8, 8)
    assert set(tensor.reshape(-1).tolist()) <= {0.0, 1.0}, f"{name}: non-binary tensor value"
    assert tensor_fnv1a(tensor) == GOLDEN_HASHES[name], (
        f"{name}: encoder tensor hash mismatch vs Rust golden "
        "(encoder_v1 spec drift — resync engine/src/encoder.rs)"
    )


def test_all_golden_hashes_are_exercised() -> None:
    fixture_names = {f["name"] for f in FIXTURES}
    stale = set(GOLDEN_HASHES) - fixture_names
    assert not stale, f"stale golden hashes with no fixture: {stale}"
