"""Promotion loop helpers (T1-7, V2-T3)."""

from __future__ import annotations

from pathlib import Path

import pytest

from promote import (
    PROMOTION_THRESHOLD,
    ModelId,
    parse_model,
    parse_version,
    version_path,
    version_stem,
)


def test_version_naming_round_trip() -> None:
    assert parse_version(Path("v002.onnx")) == 2
    assert parse_version(Path("models/v010.onnx")) == 10
    assert version_stem(3) == "v003"
    assert version_path(Path("models"), 7) == Path("models/v007.onnx")


def test_side_version_naming_round_trip() -> None:
    assert parse_model(Path("w001.onnx")) == ModelId(side="w", number=1)
    assert parse_model(Path("models/b012.onnx")) == ModelId(side="b", number=12)
    assert version_stem(2, "w") == "w002"
    assert version_path(Path("models"), 3, "b") == Path("models/b003.onnx")


def test_bad_model_name_raises() -> None:
    with pytest.raises(ValueError, match="vNNN"):
        parse_version(Path("model2.onnx"))


def test_promotion_threshold_matches_arch() -> None:
    assert PROMOTION_THRESHOLD == 0.55
