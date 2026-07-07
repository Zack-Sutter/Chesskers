"""Self-play shard writer checks (T1-4).

Verifies the invariants the trainer relies on: outcomes are side-to-move value
targets in {-1, 0, +1}, states have the encoder_v1 shape, generation is
seed-deterministic, and shards round-trip through NPZ.
"""

from __future__ import annotations

import random

import numpy as np

from self_play import generate_positions, write_shards, _outcomes


def test_outcome_labeling_is_side_to_move_pov() -> None:
    teams = ["w", "b", "w", "b"]
    assert _outcomes(teams, "w") == [1.0, -1.0, 1.0, -1.0]
    assert _outcomes(teams, "b") == [-1.0, 1.0, -1.0, 1.0]
    assert _outcomes(teams, None) == [0.0, 0.0, 0.0, 0.0]


def test_generate_positions_shape_and_values() -> None:
    states, outcomes, games = generate_positions(random.Random(1), 200, max_moves=300)
    assert len(states) >= 200
    assert states.shape[1:] == (16, 8, 8)
    assert states.dtype == np.float32
    assert len(states) == len(outcomes)
    assert games >= 1
    assert set(np.unique(outcomes)).issubset({-1.0, 0.0, 1.0})


def test_generation_is_deterministic() -> None:
    a, oa, _ = generate_positions(random.Random(7), 100, max_moves=300)
    b, ob, _ = generate_positions(random.Random(7), 100, max_moves=300)
    assert np.array_equal(a, b)
    assert np.array_equal(oa, ob)


def test_shard_roundtrip(tmp_path) -> None:
    states, outcomes, _ = generate_positions(random.Random(3), 150, max_moves=300)
    paths = write_shards(states, outcomes, tmp_path, shard_size=64)
    assert len(paths) == -(-len(states) // 64)  # ceil-divide positions into shards

    loaded_states, loaded_outcomes = [], []
    for path in paths:
        with np.load(path) as npz:
            loaded_states.append(npz["states"])
            loaded_outcomes.append(npz["outcomes"])
    assert np.array_equal(np.concatenate(loaded_states), states)
    assert np.array_equal(np.concatenate(loaded_outcomes), outcomes)
