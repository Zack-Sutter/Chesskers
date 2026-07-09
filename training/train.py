"""Policy + value CNN training + ONNX export (T1-6, Stage B).

Loads the MCTS self-play NPZ shards written by ``self_play.py`` (states, outcome
value targets, and sparse visit-count policy targets), trains a small dual-head
convolutional network, and exports it to ``models/v002.onnx``.

The exported graph takes a single input ``board [1, 16, 8, 8]`` (encoder_v1) and
returns **two** outputs in this order:

* ``value``  — scalar in ``[-1, 1]`` (tanh), side-to-move perspective.
* ``policy`` — ``[1, 16384]`` logits over the §5.3 move index (masked to legal
  moves + softmaxed by the Rust ``OnnxEvaluator``; arch §5.3/§5.6).

Value-only models (v001) stay valid — the Rust evaluator keys off the output
count. tract loads only the ops used here: Conv, Relu, Gemm, Tanh, Reshape.

Usage:
    python train.py --shards shards/ --out models/v002.onnx --epochs 30
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import torch
from torch import nn

from chesskers.encoder import _spec
from chesskers.move_index import POLICY_SIZE

_TRAINING_DIR = Path(__file__).resolve().parent
_SHARD_DIR = _TRAINING_DIR / "shards"
_MODEL_OUT = _TRAINING_DIR / "models" / "v002.onnx"


def load_shards(shard_dir: Path):
    """Concatenate every ``shard_*.npz`` into (states, outcomes, policy_idx, policy_val)."""
    paths = sorted(shard_dir.glob("shard_*.npz"))
    if not paths:
        raise FileNotFoundError(
            f"no shard_*.npz in {shard_dir}; run self_play.py first (T1-6)"
        )
    states, outcomes, policy_idx, policy_val = [], [], [], []
    for path in paths:
        with np.load(path) as npz:
            states.append(npz["states"])
            outcomes.append(npz["outcomes"])
            if "policy_idx" not in npz:
                raise KeyError(
                    f"{path.name} has no policy targets — regenerate shards with the "
                    "T1-6 self_play.py (value-only T1-4 shards are not usable here)"
                )
            policy_idx.append(npz["policy_idx"])
            policy_val.append(npz["policy_val"])
    return (
        np.concatenate(states).astype(np.float32),
        np.concatenate(outcomes).astype(np.float32),
        np.concatenate(policy_idx).astype(np.int64),
        np.concatenate(policy_val).astype(np.float32),
    )


def _conv_trunk(num_planes: int, channels: int) -> nn.Sequential:
    return nn.Sequential(
        nn.Conv2d(num_planes, channels, kernel_size=3, padding=1),
        nn.ReLU(),
        nn.Conv2d(channels, channels, kernel_size=3, padding=1),
        nn.ReLU(),
    )


class PolicyValueNet(nn.Module):
    """Dual-head net with **separate** value/policy trunks.

    Separate trunks keep the value branch structurally identical to v001 so it can
    distill v001's value tightly, while the policy branch learns priors without
    multi-task interference (they compete when the trunk is shared).
    """

    def __init__(self, num_planes: int, board_dim: int, channels: int = 32) -> None:
        super().__init__()
        self.value_trunk = _conv_trunk(num_planes, channels)
        self.value_head = nn.Sequential(
            nn.Flatten(),
            nn.Linear(channels * board_dim * board_dim, 64),
            nn.ReLU(),
            nn.Linear(64, 1),
            nn.Tanh(),
        )
        self.policy_trunk = _conv_trunk(num_planes, channels)
        self.policy_head = nn.Sequential(
            nn.Conv2d(channels, 8, kernel_size=1),
            nn.ReLU(),
            nn.Flatten(),
            nn.Linear(8 * board_dim * board_dim, POLICY_SIZE),
        )

    def forward(self, x: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        return self.value_head(self.value_trunk(x)), self.policy_head(self.policy_trunk(x))


def _dense_policy(idx: torch.Tensor, val: torch.Tensor) -> torch.Tensor:
    """Scatter sparse ``(idx, val)`` policy targets into ``[B, POLICY_SIZE]``.

    Padded slots (idx == -1, val == 0) clamp to index 0 and add 0, so
    ``scatter_add_`` leaves the real (distinct-index) targets untouched.
    """
    dense = torch.zeros(idx.shape[0], POLICY_SIZE, dtype=torch.float32)
    dense.scatter_add_(1, idx.clamp(min=0), val)
    return dense


def train(
    net: nn.Module,
    states: np.ndarray,
    outcomes: np.ndarray,
    policy_idx: np.ndarray,
    policy_val: np.ndarray,
    epochs: int,
    batch_size: int,
    lr: float,
    policy_weight: float,
    seed: int,
) -> tuple[float, float]:
    torch.manual_seed(seed)
    dataset = torch.utils.data.TensorDataset(
        torch.from_numpy(states),
        torch.from_numpy(outcomes).unsqueeze(1),
        torch.from_numpy(policy_idx),
        torch.from_numpy(policy_val),
    )
    loader = torch.utils.data.DataLoader(dataset, batch_size=batch_size, shuffle=True)
    optimizer = torch.optim.Adam(net.parameters(), lr=lr)
    value_loss_fn = nn.MSELoss()

    net.train()
    last_v = last_p = float("nan")
    for epoch in range(epochs):
        run_v = run_p = 0.0
        seen = 0
        for xb, vb, pib, pvb in loader:
            optimizer.zero_grad()
            value_out, policy_logits = net(xb)
            value_loss = value_loss_fn(value_out, vb)
            target = _dense_policy(pib, pvb)
            log_probs = torch.log_softmax(policy_logits, dim=1)
            policy_loss = -(target * log_probs).sum(dim=1).mean()
            (value_loss + policy_weight * policy_loss).backward()
            optimizer.step()
            run_v += value_loss.item() * len(xb)
            run_p += policy_loss.item() * len(xb)
            seen += len(xb)
        last_v, last_p = run_v / seen, run_p / seen
        print(f"epoch {epoch + 1:>3}/{epochs}  value_mse={last_v:.4f}  policy_ce={last_p:.4f}")
    return last_v, last_p


def export_onnx(net: nn.Module, num_planes: int, board_dim: int, out_path: Path) -> None:
    net.eval()
    out_path.parent.mkdir(parents=True, exist_ok=True)
    dummy = torch.zeros(1, num_planes, board_dim, board_dim, dtype=torch.float32)
    torch.onnx.export(
        net,
        dummy,
        str(out_path),
        input_names=["board"],
        output_names=["value", "policy"],
        opset_version=17,
        dynamo=False,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Chesskers policy+value CNN trainer (T1-6)")
    parser.add_argument("--shards", type=Path, default=_SHARD_DIR)
    parser.add_argument("--out", type=Path, default=_MODEL_OUT)
    parser.add_argument("--epochs", type=int, default=30)
    parser.add_argument("--batch-size", type=int, default=128)
    parser.add_argument("--lr", type=float, default=1e-3)
    parser.add_argument("--policy-weight", type=float, default=1.0)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    spec = _spec()
    num_planes, board_dim = spec["num_planes"], spec["board_dim"]

    states, outcomes, policy_idx, policy_val = load_shards(args.shards)
    print(f"loaded {len(states)} positions from {args.shards}")

    net = PolicyValueNet(num_planes, board_dim)
    train(
        net, states, outcomes, policy_idx, policy_val,
        args.epochs, args.batch_size, args.lr, args.policy_weight, args.seed,
    )

    export_onnx(net, num_planes, board_dim, args.out)
    print(f"exported ONNX -> {args.out}")

    _verify(args.out, states[:1])


def _verify(onnx_path: Path, sample_state: np.ndarray) -> None:
    """Reload the exported model (onnxruntime if present, else onnx.checker)."""
    try:
        import onnxruntime as ort  # type: ignore
    except ImportError:
        import onnx

        onnx.checker.check_model(onnx.load(str(onnx_path)))
        print("onnx.checker: model well-formed (install onnxruntime for a value check)")
        return

    sess = ort.InferenceSession(str(onnx_path))
    value, policy = sess.run(None, {sess.get_inputs()[0].name: sample_state})
    v = float(np.asarray(value).reshape(-1)[0])
    assert np.isfinite(v) and -1.0 <= v <= 1.0, f"value {v} outside [-1, 1]"
    assert np.asarray(policy).reshape(-1).shape[0] == POLICY_SIZE, "policy head wrong size"
    print(f"onnxruntime check: value={v:.4f} in [-1, 1], policy[{POLICY_SIZE}] OK")


if __name__ == "__main__":
    main()
