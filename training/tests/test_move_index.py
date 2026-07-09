"""Move-index parity with the Rust engine (architecture §5.3).

The golden indices below are identical to
``engine/src/move_index.rs::matches_spec_golden_indices`` — the single source of
truth. If §5.3 changes, update both sides together.
"""

from __future__ import annotations

from chesskers.move_index import POLICY_SIZE, move_index


def _mv(fx, fy, tx, ty, promo=None):
    m = {"from": {"x": fx, "y": fy}, "to": {"x": tx, "y": ty}}
    if promo is not None:
        m["promotion"] = promo
    return m


def test_matches_spec_golden_indices() -> None:
    assert move_index(_mv(0, 0, 0, 0)) == 0
    assert move_index(_mv(3, 1, 3, 3)) == 731
    assert move_index(_mv(0, 6, 0, 7, "rook")) == 7224
    assert move_index(_mv(0, 6, 0, 7, "queen")) == 3128
    assert move_index(_mv(7, 7, 7, 7, "knight")) == 4095 + 12288
    assert move_index(_mv(7, 7, 7, 7, "knight")) < POLICY_SIZE
