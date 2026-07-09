"""Iterative model promotion loop (T1-7, Stage C).

Model naming
------------
``vNNN.onnx`` — three-digit zero-padded version in ``training/models/`` and
``engine/models/``:

* ``v001`` — value-only (Stage A)
* ``v002+`` — dual-head policy+value (Stage B onward)

Each iteration distills from the incumbent net, trains candidate ``v(N+1)``, and
promotes only when the fixed Rust MCTS-vs-MCTS suite (arch §9) scores ≥
``PROMOTION_THRESHOLD`` (55%).

Usage:
    python promote.py --incumbent models/v002.onnx
    python promote.py --incumbent models/v002.onnx --eval-only --candidate models/v003.onnx
"""

from __future__ import annotations

import argparse
import json
import random
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

from chesskers.encoder import _spec
from self_play import _V001, generate_positions, write_shards
from train import PolicyValueNet, export_onnx, train

_TRAINING_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _TRAINING_DIR.parent
_ENGINE_DIR = _REPO_ROOT / "engine"
_DEFAULT_MODELS = _TRAINING_DIR / "models"
_DEFAULT_SHARDS = _TRAINING_DIR / "shards" / "promote"
_ENGINE_MODELS = _ENGINE_DIR / "models"

VERSION_RE = re.compile(r"^v(\d{3})\.onnx$", re.IGNORECASE)
PROMOTION_THRESHOLD = 0.55


def parse_version(path: Path) -> int:
    """Extract the numeric version from ``vNNN.onnx``."""
    match = VERSION_RE.match(path.name)
    if not match:
        raise ValueError(f"expected vNNN.onnx naming, got {path.name}")
    return int(match.group(1))


def version_stem(version: int) -> str:
    return f"v{version:03d}"


def version_path(models_dir: Path, version: int) -> Path:
    return models_dir / f"{version_stem(version)}.onnx"


@dataclass
class PromotionResult:
    incumbent: Path
    candidate: Path
    win_rate: float
    promoted: bool


def _stage_models(incumbent: Path, candidate: Path, engine_models: Path) -> tuple[str, str]:
    """Copy ONNX files into ``engine/models/`` under their version stems."""
    engine_models.mkdir(parents=True, exist_ok=True)
    inc_stem = version_stem(parse_version(incumbent))
    cand_stem = version_stem(parse_version(candidate))
    shutil.copy2(incumbent, engine_models / f"{inc_stem}.onnx")
    shutil.copy2(candidate, engine_models / f"{cand_stem}.onnx")
    return cand_stem, inc_stem


def run_eval_suite(
    incumbent: Path,
    candidate: Path,
    *,
    engine_dir: Path = _ENGINE_DIR,
    engine_models: Path = _ENGINE_MODELS,
    threshold: float = PROMOTION_THRESHOLD,
) -> tuple[float, bool]:
    """Run the fixed MCTS-vs-MCTS gate via ``chesskers-engine eval-promotion``."""
    cand_stem, inc_stem = _stage_models(incumbent, candidate, engine_models)
    cmd = [
        "cargo",
        "run",
        "--release",
        "--quiet",
        "--manifest-path",
        str(engine_dir / "Cargo.toml"),
        "--",
        "eval-promotion",
        "--challenger",
        cand_stem,
        "--baseline",
        inc_stem,
        "--models-dir",
        str(engine_models),
        "--threshold",
        str(threshold),
    ]
    proc = subprocess.run(cmd, cwd=engine_dir, capture_output=True, text=True, check=False)
    if proc.returncode != 0:
        err = proc.stderr.strip() or proc.stdout.strip() or f"exit {proc.returncode}"
        raise RuntimeError(f"eval-promotion failed: {err}")
    payload = json.loads(proc.stdout)
    if "error" in payload:
        raise RuntimeError(payload["error"])
    return float(payload["winRate"]), bool(payload["promoted"])


def generate_shards(
    incumbent: Path,
    shard_dir: Path,
    *,
    positions: int,
    sims: int,
    c_puct: float,
    max_moves: int,
    shard_size: int,
    seed: int,
) -> None:
    if shard_dir.exists():
        shutil.rmtree(shard_dir)
    v001 = _V001(incumbent)
    rng = random.Random(seed)
    states, values, policy_idx, policy_val, games = generate_positions(
        rng, positions, max_moves, sims, c_puct, v001
    )
    write_shards(states, values, policy_idx, policy_val, shard_dir, shard_size)
    print(
        f"self-play: {len(states)} positions from {games} games -> {shard_dir} "
        f"(distilled from {incumbent.name})"
    )


def train_candidate(
    shard_dir: Path,
    candidate: Path,
    *,
    epochs: int,
    batch_size: int,
    lr: float,
    policy_weight: float,
    seed: int,
) -> None:
    from train import load_shards

    spec = _spec()
    num_planes, board_dim = spec["num_planes"], spec["board_dim"]
    states, outcomes, policy_idx, policy_val = load_shards(shard_dir)
    print(f"train: {len(states)} positions from {shard_dir}")

    net = PolicyValueNet(num_planes, board_dim)
    train(
        net, states, outcomes, policy_idx, policy_val,
        epochs, batch_size, lr, policy_weight, seed,
    )
    export_onnx(net, num_planes, board_dim, candidate)
    print(f"exported candidate -> {candidate}")


def promote_once(
    incumbent: Path,
    *,
    models_dir: Path = _DEFAULT_MODELS,
    shard_dir: Path = _DEFAULT_SHARDS,
    candidate: Path | None = None,
    positions: int = 5120,
    sims: int = 100,
    c_puct: float = 1.5,
    max_moves: int = 160,
    shard_size: int = 512,
    epochs: int = 40,
    batch_size: int = 128,
    lr: float = 1e-3,
    policy_weight: float = 1.0,
    seed: int = 42,
    threshold: float = PROMOTION_THRESHOLD,
    eval_only: bool = False,
    skip_train: bool = False,
) -> PromotionResult:
    if not incumbent.is_file():
        raise FileNotFoundError(f"incumbent not found: {incumbent}")

    next_ver = parse_version(incumbent) + 1
    candidate = candidate or version_path(models_dir, next_ver)
    models_dir.mkdir(parents=True, exist_ok=True)

    if eval_only and candidate is None:
        candidate = version_path(models_dir, next_ver)

    if not eval_only:
        if not skip_train:
            generate_shards(
                incumbent, shard_dir,
                positions=positions, sims=sims, c_puct=c_puct,
                max_moves=max_moves, shard_size=shard_size, seed=seed,
            )
            train_candidate(
                shard_dir, candidate,
                epochs=epochs, batch_size=batch_size, lr=lr,
                policy_weight=policy_weight, seed=seed,
            )
        elif not candidate.is_file():
            raise FileNotFoundError(f"--skip-train but candidate missing: {candidate}")

    win_rate, promoted = run_eval_suite(incumbent, candidate, threshold=threshold)
    print(
        f"eval: {candidate.name} vs {incumbent.name} -> {win_rate * 100:.1f}% "
        f"(gate {threshold * 100:.0f}%): {'PROMOTED' if promoted else 'rejected'}"
    )

    if promoted:
        shutil.copy2(candidate, _ENGINE_MODELS / candidate.name)
        print(f"engine model -> {_ENGINE_MODELS / candidate.name}")
        return PromotionResult(incumbent=candidate, candidate=candidate, win_rate=win_rate, promoted=True)

    return PromotionResult(incumbent=incumbent, candidate=candidate, win_rate=win_rate, promoted=False)


def main() -> None:
    parser = argparse.ArgumentParser(description="Chesskers iterative model promotion (T1-7)")
    parser.add_argument("--incumbent", type=Path, required=True,
                        help="current best model (e.g. models/v002.onnx)")
    parser.add_argument("--candidate", type=Path, default=None,
                        help="output path (default: models/vNNN.onnx where NNN = incumbent + 1)")
    parser.add_argument("--models-dir", type=Path, default=_DEFAULT_MODELS)
    parser.add_argument("--shards", type=Path, default=_DEFAULT_SHARDS)
    parser.add_argument("--positions", type=int, default=5120)
    parser.add_argument("--sims", type=int, default=100)
    parser.add_argument("--c-puct", type=float, default=1.5)
    parser.add_argument("--max-moves", type=int, default=160)
    parser.add_argument("--shard-size", type=int, default=512)
    parser.add_argument("--epochs", type=int, default=40)
    parser.add_argument("--batch-size", type=int, default=128)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--policy-weight", type=float, default=1.0)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--threshold", type=float, default=PROMOTION_THRESHOLD)
    parser.add_argument("--iterations", type=int, default=1,
                        help="promotion attempts; stops early on rejection")
    parser.add_argument("--eval-only", action="store_true",
                        help="skip self-play + train; evaluate --candidate vs incumbent")
    parser.add_argument("--skip-train", action="store_true",
                        help="skip self-play + train; require existing --candidate")
    args = parser.parse_args()

    incumbent = args.incumbent
    if not incumbent.is_absolute():
        incumbent = _TRAINING_DIR / incumbent

    for attempt in range(1, args.iterations + 1):
        if args.iterations > 1:
            print(f"--- iteration {attempt}/{args.iterations} (incumbent {incumbent.name}) ---")
        result = promote_once(
            incumbent,
            models_dir=args.models_dir,
            shard_dir=args.shards,
            candidate=args.candidate,
            positions=args.positions,
            sims=args.sims,
            c_puct=args.c_puct,
            max_moves=args.max_moves,
            shard_size=args.shard_size,
            epochs=args.epochs,
            batch_size=args.batch_size,
            lr=args.lr,
            policy_weight=args.policy_weight,
            seed=args.seed + attempt - 1,
            threshold=args.threshold,
            eval_only=args.eval_only,
            skip_train=args.skip_train,
        )
        if result.promoted:
            incumbent = result.incumbent
            args.candidate = None
            args.eval_only = False
            args.skip_train = False
        else:
            sys.exit(1)

    print(f"done: incumbent {incumbent}")


if __name__ == "__main__":
    main()
