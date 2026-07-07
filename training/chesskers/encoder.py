"""encoder_v1: Board -> NN input tensor (T1-3).

Mirrors ``engine/src/encoder.rs``. The plane layout is loaded from
``configs/encoder_v1.yaml`` so the Python trainer and the Rust engine share a
single spec; cross-language parity is verified against ``fixtures/*.json`` via
FNV-1a golden hashes (see ``tests/test_encoder.py``). Values are strictly 0.0 or
1.0, so the hash is an exact match — no float tolerance. See architecture §5.4.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import numpy as np
import yaml

from .rules import WHITE, Board

_CONFIG_PATH = Path(__file__).resolve().parents[1] / "configs" / "encoder_v1.yaml"

_FNV_OFFSET = 0xCBF29CE484222325
_FNV_PRIME = 0x100000001B3
_U64_MASK = 0xFFFFFFFFFFFFFFFF


@lru_cache(maxsize=1)
def _spec() -> dict:
    with _CONFIG_PATH.open(encoding="utf-8") as f:
        return yaml.safe_load(f)


def encode(board: Board) -> np.ndarray:
    """Encode ``board`` to a ``[num_planes, 8, 8]`` float32 tensor (encoder_v1)."""
    spec = _spec()
    dim = spec["board_dim"]
    tensor = np.zeros((spec["num_planes"], dim, dim), dtype=np.float32)

    base = spec["piece_plane_base"]
    offset = spec["piece_type_offset"]
    for p in board.pieces:
        tensor[base[p.team] + offset[p.type], p.y, p.x] = 1.0

    planes = spec["planes"]
    if board.current_team() == WHITE:
        tensor[planes["side_to_move"], :, :] = 1.0

    hop = board.checkers_hop_position
    if hop is not None:
        tensor[planes["checkers_hop"], hop[1], hop[0]] = 1.0

    return tensor


def encode_serialized(serialized: dict) -> np.ndarray:
    return encode(Board.from_serialized(serialized))


def tensor_fnv1a(tensor: np.ndarray) -> int:
    """FNV-1a over the float32 bit patterns, matching ``engine/src/encoder.rs``.

    Hashes the tensor in C-order (plane-major) flat layout — identical to the
    Rust ``[16, 8, 8]`` iteration order — so hashes match exactly across
    languages for golden fixture comparison.
    """
    flat = np.ascontiguousarray(tensor, dtype=np.float32).reshape(-1).view(np.uint32)
    h = _FNV_OFFSET
    for bits in flat.tolist():
        h = ((h ^ bits) * _FNV_PRIME) & _U64_MASK
    return h
