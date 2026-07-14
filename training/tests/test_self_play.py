"""MCTS self-play shard writer checks (T1-6).

Verifies the invariants the trainer relies on: outcomes are side-to-move value
targets in {-1, 0, +1}, states have the encoder_v1 shape, policy targets are
valid sparse visit distributions, generation is seed-deterministic, and shards
round-trip through NPZ with all four keys.
"""

from __future__ import annotations

import random

import numpy as np

from chesskers.move_index import POLICY_SIZE
from self_play import (
    MAX_POLICY_ENTRIES,
    _outcomes,
    _shard_out_dir,
    generate_positions,
    write_shards,
)

# Small sims keep the MCTS-driven tests fast while still exercising the tree.
_SIMS = 16


def _gen(seed: int, n: int):
    return generate_positions(random.Random(seed), n, max_moves=120, sims=_SIMS)


def test_outcome_labeling_is_side_to_move_pov() -> None:
    teams = ["w", "b", "w", "b"]
    assert _outcomes(teams, "w") == [1.0, -1.0, 1.0, -1.0]
    assert _outcomes(teams, "b") == [-1.0, 1.0, -1.0, 1.0]
    assert _outcomes(teams, None) == [0.0, 0.0, 0.0, 0.0]


def test_generate_positions_shape_and_values() -> None:
    states, outcomes, policy_idx, policy_val, games = _gen(1, 120)
    assert len(states) >= 120
    assert states.shape[1:] == (16, 8, 8)
    assert states.dtype == np.float32
    assert len(states) == len(outcomes) == len(policy_idx) == len(policy_val)
    assert games >= 1
    assert set(np.unique(outcomes)).issubset({-1.0, 0.0, 1.0})

    assert policy_idx.shape == (len(states), MAX_POLICY_ENTRIES)
    assert policy_val.shape == (len(states), MAX_POLICY_ENTRIES)
    # Indices are either padding (-1) or valid policy indices.
    valid = policy_idx[policy_idx >= 0]
    assert valid.size > 0
    assert valid.max() < POLICY_SIZE
    # Each row's probabilities sum to ~1 (visit distribution) and are non-negative.
    assert (policy_val >= 0).all()
    row_sums = policy_val.sum(axis=1)
    assert np.allclose(row_sums, 1.0, atol=1e-5)


def test_generation_is_deterministic() -> None:
    a = _gen(7, 80)
    b = _gen(7, 80)
    for arr_a, arr_b in zip(a[:4], b[:4]):
        assert np.array_equal(arr_a, arr_b)


def test_mixed_positions_include_both_sides() -> None:
    states, *_ = _gen(5, 200)
    side_plane = states[:, 14, 0, 0]
    assert side_plane.min() == 0.0 and side_plane.max() == 1.0


def test_side_filter_keeps_only_requested_side() -> None:
    for side, expected in (("w", 1.0), ("b", 0.0)):
        states, *_ = generate_positions(
            random.Random(9), 40, max_moves=120, sims=_SIMS, side=side
        )
        assert len(states) >= 40
        assert (states[:, 14, 0, 0] == expected).all()


def test_shard_out_dir_side_defaults() -> None:
    from self_play import _SHARD_DIR

    assert _shard_out_dir(None, None) == _SHARD_DIR
    assert _shard_out_dir("w", None) == _SHARD_DIR / "white"
    assert _shard_out_dir("b", None) == _SHARD_DIR / "black"
    custom = _SHARD_DIR / "custom"
    assert _shard_out_dir("w", custom) == custom


def test_shard_roundtrip(tmp_path) -> None:
    states, outcomes, policy_idx, policy_val, _ = _gen(3, 100)
    paths = write_shards(states, outcomes, policy_idx, policy_val, tmp_path, shard_size=64)
    assert len(paths) == -(-len(states) // 64)  # ceil-divide positions into shards

    keys = ("states", "outcomes", "policy_idx", "policy_val")
    loaded = {k: [] for k in keys}
    for path in paths:
        with np.load(path) as npz:
            for k in keys:
                loaded[k].append(npz[k])
    assert np.array_equal(np.concatenate(loaded["states"]), states)
    assert np.array_equal(np.concatenate(loaded["outcomes"]), outcomes)
    assert np.array_equal(np.concatenate(loaded["policy_idx"]), policy_idx)
    assert np.array_equal(np.concatenate(loaded["policy_val"]), policy_val)
