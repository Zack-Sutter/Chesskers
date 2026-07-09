"""Move -> NN policy logit index (architecture §5.3).

Mirrors ``engine/src/move_index.rs``; both must agree with the spec (verified by
``tests/test_move_index.py`` against the same golden indices as the Rust unit
test). Layout::

    from_index = from.y*8 + from.x   # 0..63
    to_index   = to.y*8 + to.x       # 0..63
    base_index = from_index*64 + to_index   # 0..4095
    move_index = base_index + promotion_offset

Promotion buckets: queen 0, rook 4096, bishop 8192, knight 12288. Non-promotion
moves live in bucket 0; max index is 16383 < POLICY_SIZE.
"""

from __future__ import annotations

# 4096 (from×to) × 4 promotion buckets.
POLICY_SIZE = 16384

_PROMOTION_OFFSET = {
    None: 0,
    "queen": 0,
    "rook": 4096,
    "bishop": 8192,
    "knight": 12288,
}


def move_index(move: dict) -> int:
    """Flat policy index for an ``{from, to, promotion?}`` move payload."""
    f, t = move["from"], move["to"]
    from_i = f["y"] * 8 + f["x"]
    to_i = t["y"] * 8 + t["x"]
    return from_i * 64 + to_i + _PROMOTION_OFFSET[move.get("promotion")]
