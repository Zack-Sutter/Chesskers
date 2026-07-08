"""Value-only CNN training + ONNX export (T1-5).

Loads the NPZ shards written by ``self_play.py`` (states ``float32
[N, 16, 8, 8]`` encoder_v1 tensors, outcomes ``float32 [N]`` side-to-move
value targets in {-1, 0, +1}), trains a small convolutional value head with
MSE regression, and exports it to ``models/v001.onnx``.

The exported graph takes a single input of shape ``[1, 16, 8, 8]`` and returns
a scalar value in ``[-1, 1]`` (tanh) from the side-to-move perspective — the
contract the Rust ``OnnxEvaluator`` expects (engine/src/evaluator.rs, arch
§5.4/§5.6). tract loads only ops we stick to here: Conv, Relu, Gemm, Tanh.

Usage:
    python train.py --shards shards/ --out models/v001.onnx --epochs 30
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import torch
from torch import nn

from chesskers.encoder import _spec

_TRAINING_DIR = Path(__file__).resolve().parent
_SHARD_DIR = _TRAINING_DIR / "shards"
_MODEL_OUT = _TRAINING_DIR / "models" / "v001.onnx"


def load_shards(shard_dir: Path) -> tuple[np.ndarray, np.ndarray]:
    """Concatenate every ``shard_*.npz`` in ``shard_dir`` into one dataset."""
    paths = sorted(shard_dir.glob("shard_*.npz"))
    if not paths:
        raise FileNotFoundError(
            f"no shard_*.npz in {shard_dir}; run self_play.py first (T1-4)"
        )
    states, outcomes = [], []
    for path in paths:
        with np.load(path) as npz:
            states.append(npz["states"])
            outcomes.append(npz["outcomes"])
    return (
        np.concatenate(states).astype(np.float32),
        np.concatenate(outcomes).astype(np.float32),
    )


class ValueNet(nn.Module):
    """Small CNN value head: [B, 16, 8, 8] -> scalar in [-1, 1]."""

    def __init__(self, num_planes: int, board_dim: int, channels: int = 32) -> None:
        super().__init__()
        self.features = nn.Sequential(
            nn.Conv2d(num_planes, channels, kernel_size=3, padding=1),
            nn.ReLU(),
            nn.Conv2d(channels, channels, kernel_size=3, padding=1),
            nn.ReLU(),
        )
        self.head = nn.Sequential(
            nn.Flatten(),
            nn.Linear(channels * board_dim * board_dim, 64),
            nn.ReLU(),
            nn.Linear(64, 1),
            nn.Tanh(),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.head(self.features(x))


def train(
    net: nn.Module,
    states: np.ndarray,
    outcomes: np.ndarray,
    epochs: int,
    batch_size: int,
    lr: float,
    seed: int,
) -> float:
    torch.manual_seed(seed)
    x = torch.from_numpy(states)
    y = torch.from_numpy(outcomes).unsqueeze(1)
    loader = torch.utils.data.DataLoader(
        torch.utils.data.TensorDataset(x, y),
        batch_size=batch_size,
        shuffle=True,
    )
    optimizer = torch.optim.Adam(net.parameters(), lr=lr)
    loss_fn = nn.MSELoss()

    net.train()
    last_loss = float("nan")
    for epoch in range(epochs):
        running, seen = 0.0, 0
        for xb, yb in loader:
            optimizer.zero_grad()
            loss = loss_fn(net(xb), yb)
            loss.backward()
            optimizer.step()
            running += loss.item() * len(xb)
            seen += len(xb)
        last_loss = running / seen
        print(f"epoch {epoch + 1:>3}/{epochs}  mse={last_loss:.4f}")
    return last_loss


def export_onnx(net: nn.Module, num_planes: int, board_dim: int, out_path: Path) -> None:
    net.eval()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    dummy = torch.zeros(1, num_planes, board_dim, board_dim, dtype=torch.float32)
    torch.onnx.export(
        net,
        dummy,
        str(out_path),
        input_names=["board"],
        output_names=["value"],
        opset_version=17,
        dynamo=False,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Chesskers value-only CNN trainer (T1-5)")
    parser.add_argument("--shards", type=Path, default=_SHARD_DIR)
    parser.add_argument("--out", type=Path, default=_MODEL_OUT)
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--batch-size", type=int, default=128)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    spec = _spec()
    num_planes, board_dim = spec["num_planes"], spec["board_dim"]

    states, outcomes = load_shards(args.shards)
    print(f"loaded {len(states)} positions from {args.shards}")

    net = ValueNet(num_planes, board_dim)
    train(net, states, outcomes, args.epochs, args.batch_size, args.lr, args.seed)

    export_onnx(net, num_planes, board_dim, args.out)
    print(f"exported ONNX -> {args.out}")

    # self-check: reload and confirm a finite in-range value on a real position
    _verify(args.out, states[:1])


def _verify(onnx_path: Path, sample_state: np.ndarray) -> None:
    """Load the exported model with onnxruntime if present, else onnx.checker."""
    try:
        import onnxruntime as ort  # type: ignore
    except ImportError:
        import onnx

        onnx.checker.check_model(onnx.load(str(onnx_path)))
        print("onnx.checker: model well-formed (install onnxruntime for a value check)")
        return

    sess = ort.InferenceSession(str(onnx_path))
    (value,) = sess.run(None, {sess.get_inputs()[0].name: sample_state})
    v = float(np.asarray(value).reshape(-1)[0])
    assert np.isfinite(v) and -1.0 <= v <= 1.0, f"value {v} outside [-1, 1]"
    print(f"onnxruntime check: value={v:.4f} in [-1, 1] OK")


if __name__ == "__main__":
    main()
