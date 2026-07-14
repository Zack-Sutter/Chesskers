"""Iterative model promotion loop (T1-7, Stage C; V2-T3 side-specific).

Model naming
------------
``vNNN.onnx`` — legacy unified model (v1):

* ``v001`` — value-only (Stage A)
* ``v002+`` — dual-head policy+value (Stage B onward)

``wNNN.onnx`` / ``bNNN.onnx`` — v2 side-specific models (arch §14.2):

* ``w001+`` — white engine (chess-heavy training)
* ``b001+`` — black engine (checkers-heavy training)

Each iteration distills from the incumbent net, trains candidate ``(N+1)``, and
promotes only when the fixed Rust MCTS-vs-MCTS suite (arch §9) scores ≥
``PROMOTION_THRESHOLD`` (55%). With ``--side w|b``, the gate runs 15 games with
the challenger always playing that color (not color-balanced).

Usage:
    python promote.py --incumbent models/v002.onnx
    python promote.py --incumbent models/v002.onnx --eval-only --candidate models/v003.onnx
    python promote.py --side w --incumbent models/w001.onnx
    python promote.py --side b --incumbent models/b001.onnx --eval-only --candidate models/b002.onnx
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
from train import export_onnx, load_net_from_onnx, train

_TRAINING_DIR = Path(__file__).resolve().parent
_REPO_ROOT = _TRAINING_DIR.parent
_ENGINE_DIR = _REPO_ROOT / "engine"
_DEFAULT_MODELS = _TRAINING_DIR / "models"
_DEFAULT_SHARDS = _TRAINING_DIR / "shards" / "promote"
_SIDE_PROMOTE_SHARDS = {
    "w": _TRAINING_DIR / "shards" / "white" / "promote",
    "b": _TRAINING_DIR / "shards" / "black" / "promote",
}
_ENGINE_MODELS = _ENGINE_DIR / "models"

VERSION_RE = re.compile(r"^v(\d{3})\.onnx$", re.IGNORECASE)
SIDE_VERSION_RE = re.compile(r"^([wb])(\d{3})\.onnx$", re.IGNORECASE)
PROMOTION_THRESHOLD = 0.55


@dataclass(frozen=True)
class ModelId:
    """Parsed ``vNNN`` or ``{w|b}NNN`` stem."""

    side: str | None
    number: int

    @property
    def stem(self) -> str:
        return f"{self.side}{self.number:03d}" if self.side else f"v{self.number:03d}"


def parse_model(path: Path) -> ModelId:
    """Extract side prefix (if any) and version number from a model filename."""
    name = path.name
    match = SIDE_VERSION_RE.match(name)
    if match:
        return ModelId(side=match.group(1).lower(), number=int(match.group(2)))
    match = VERSION_RE.match(name)
    if match:
        return ModelId(side=None, number=int(match.group(1)))
    raise ValueError(f"expected vNNN.onnx or w|bNNN.onnx naming, got {name}")


def parse_version(path: Path) -> int:
    """Extract the numeric version from ``vNNN.onnx`` or ``{w|b}NNN.onnx``."""
    return parse_model(path).number


def version_stem(version: int, side: str | None = None) -> str:
    return f"{side}{version:03d}" if side else f"v{version:03d}"


def version_path(models_dir: Path, version: int, side: str | None = None) -> Path:
    return models_dir / f"{version_stem(version, side)}.onnx"


@dataclass
class PromotionResult:
    incumbent: Path
    candidate: Path
    win_rate: float
    promoted: bool


def _stage_models(incumbent: Path, candidate: Path, engine_models: Path) -> tuple[str, str]:
    """Copy ONNX files into ``engine/models/`` under their version stems."""
    engine_models.mkdir(parents=True, exist_ok=True)
    inc_stem = parse_model(incumbent).stem
    cand_stem = parse_model(candidate).stem
    shutil.copy2(incumbent, engine_models / f"{inc_stem}.onnx")
    shutil.copy2(candidate, engine_models / f"{cand_stem}.onnx")
    return cand_stem, inc_stem


def run_eval_suite(
    incumbent: Path,
    candidate: Path,
    *,
    side: str | None = None,
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
    if side is not None:
        cmd.extend(["--side", side])
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
    side: str | None = None,
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
        rng, positions, max_moves, sims, c_puct, v001, side
    )
    write_shards(states, values, policy_idx, policy_val, shard_dir, shard_size)
    side_note = f" ({side} to move)" if side else ""
    print(
        f"self-play: {len(states)} positions{side_note} from {games} games -> {shard_dir} "
        f"(distilled from {incumbent.name})"
    )


def train_candidate(
    shard_dir: Path,
    candidate: Path,
    *,
    incumbent: Path,
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

    net = load_net_from_onnx(incumbent, num_planes, board_dim)
    print(f"init weights from {incumbent.name}")
    train(
        net, states, outcomes, policy_idx, policy_val,
        epochs, batch_size, lr, policy_weight, seed,
    )
    export_onnx(net, num_planes, board_dim, candidate)
    print(f"exported candidate -> {candidate}")


def promote_once(
    incumbent: Path,
    *,
    side: str | None = None,
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

    model = parse_model(incumbent)
    if side is not None and model.side is not None and model.side != side:
        raise ValueError(
            f"--side {side} conflicts with incumbent prefix {model.side} in {incumbent.name}"
        )
    side = side or model.side

    next_ver = model.number + 1
    candidate = candidate or version_path(models_dir, next_ver, side)
    models_dir.mkdir(parents=True, exist_ok=True)

    if eval_only and candidate is None:
        candidate = version_path(models_dir, next_ver, side)

    if not eval_only:
        if not skip_train:
            generate_shards(
                incumbent, shard_dir,
                side=side,
                positions=positions, sims=sims, c_puct=c_puct,
                max_moves=max_moves, shard_size=shard_size, seed=seed,
            )
            train_candidate(
                shard_dir, candidate,
                incumbent=incumbent,
                epochs=epochs, batch_size=batch_size, lr=lr,
                policy_weight=policy_weight, seed=seed,
            )
        elif not candidate.is_file():
            raise FileNotFoundError(f"--skip-train but candidate missing: {candidate}")

    win_rate, promoted = run_eval_suite(incumbent, candidate, side=side, threshold=threshold)
    gate_note = f" as {side}" if side else ""
    print(
        f"eval: {candidate.name} vs {incumbent.name}{gate_note} -> {win_rate * 100:.1f}% "
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
                        help="current best model (e.g. models/v002.onnx or models/w001.onnx)")
    parser.add_argument("--side", choices=["w", "b"], default=None,
                        help="v2 side-specific loop: wNNN/bNNN naming + per-side eval gate")
    parser.add_argument("--candidate", type=Path, default=None,
                        help="output path (default: models/vNNN.onnx or w|bNNN with --side)")
    parser.add_argument("--models-dir", type=Path, default=_DEFAULT_MODELS)
    parser.add_argument("--shards", type=Path, default=None,
                        help="promotion shard dir (default: shards/promote or shards/{white,black}/promote)")
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

    shard_dir = args.shards or (
        _SIDE_PROMOTE_SHARDS[args.side] if args.side else _DEFAULT_SHARDS
    )

    for attempt in range(1, args.iterations + 1):
        if args.iterations > 1:
            print(f"--- iteration {attempt}/{args.iterations} (incumbent {incumbent.name}) ---")
        result = promote_once(
            incumbent,
            side=args.side,
            models_dir=args.models_dir,
            shard_dir=shard_dir,
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
