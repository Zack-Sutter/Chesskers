# Chesskers training pipeline (offline)

Offline self-play + PyTorch training + ONNX export for the Rust engine's neural
evaluator. This package has **no runtime connection** to the UI or server — it
shares only `fixtures/*.json`, `configs/encoder_v1.yaml`, NPZ shards, and the
exported `*.onnx` model files. See [docs/architecture.md](../docs/architecture.md)
§9 for the full pipeline and §5.3–5.4 for the move-index / tensor contracts.

## Setup

```bash
cd training
python -m venv .venv
# Windows:  .venv\Scripts\activate
# Unix:     source .venv/bin/activate
pip install -r requirements.txt
```

Requires Python 3.10+ (tested on 3.13).

## Dependencies

| Package  | Purpose                                          |
| -------- | ------------------------------------------------ |
| `torch`  | CNN value/policy network training                |
| `numpy`  | NPZ shard I/O, encoder tensors                   |
| `onnx`   | Export trained models for the Rust ORT engine    |
| `pyyaml` | Read `configs/encoder_v1.yaml` tensor spec       |
| `pytest` | Run fixture-parity tests against `fixtures/*.json`|
| `onnxruntime` | Optional leaf evaluator for `--distill` in MCTS self-play (T1-6) |

## Layout (built out across T1-2 … T1-7)

```
training/
  requirements.txt      # this milestone (T1-1)
  README.md             # this file (T1-1)
  chesskers/            # rules mirror + encoder (T1-2, T1-3)
  configs/
    encoder_v1.yaml     # tensor layout spec (T1-3)
  self_play.py          # self-play shard writer (T1-4 random, T1-6 MCTS)
  train.py              # value/policy training + ONNX export (T1-5, T1-6)
  promote.py            # iterative promotion loop (T1-7)
  shards/               # generated NPZ training data
  models/               # exported *.onnx
```

## Tests

```bash
cd training
python -m pytest        # runs fixture-parity tests in tests/
```

`tests/test_fixtures.py` replays every `fixtures/*.json` golden case through the
Python rules mirror (`chesskers/rules.py`) and asserts legal moves, terminal
states, and apply-move results match the TypeScript/Rust engines.

## Self-play (T1-4)

Generate value-only training data from random-vs-random games:

```bash
cd training
python self_play.py --positions 1000 --out shards/ --seed 42
```

Each non-terminal position is encoded with `encoder_v1` and labeled with the
eventual game outcome from that position's side-to-move perspective (`+1` win,
`-1` loss, `0` draw/move-limit — architecture §5.4). Shards are NPZ files with
`states` (`float32 [N, 16, 8, 8]`) and `outcomes` (`float32 [N]`). Policy
targets arrive with the policy head at T1-6.

## Value model (T1-5)

Train a small CNN value head on the self-play shards and export it to ONNX:

```bash
cd training
python self_play.py --positions 20000 --out shards/ --seed 42   # if shards/ is empty
python train.py --shards shards/ --out models/v001.onnx --epochs 30
cp models/v001.onnx ../engine/models/v001.onnx                    # engine consumes it here
```

The exported graph takes one input `board [1, 16, 8, 8]` (encoder_v1) and returns
a scalar `value` in `[-1, 1]` (tanh) from the side-to-move perspective — the
contract the Rust `OnnxEvaluator` expects. Verify in the engine:

```bash
cd engine
cargo test --release v001_onnx_loads_and_evaluates            # loads in tract (E2-2)
cargo test --release search_vs_random_win_rate -- --ignored --nocapture   # 100-game suite
```

The value-only engine scored **100/100 vs random** at depth 2 (arch §9 Stage A
exit target of >90% met).

## Policy + value model (T1-6)

MCTS self-play with v001-distilled value targets and visit-count policy labels:

```bash
cd training
python self_play.py --positions 5120 --sims 100 --distill models/v001.onnx --out shards/ --seed 42
python train.py --shards shards/ --out models/v002.onnx --epochs 40 --policy-weight 1.0 --seed 42
cp models/v002.onnx ../engine/models/v002.onnx
```

`--distill` loads `v001.onnx` via onnxruntime as the MCTS leaf value **and** as
the distilled value target (anchors v002's value head to v001). Without it,
self-play falls back to material leaf values and terminal outcomes.

The exported graph returns two outputs: `value` (scalar, tanh) and `policy`
(`[1, 16384]` logits over the §5.3 move index). `PolicyValueNet` uses **separate**
conv trunks for value and policy. Verify in the engine:

```bash
cd engine
cargo test --release mcts::tests::v002_diagnostic -- --ignored --nocapture   # value vs policy breakdown
cargo test --release mcts::tests::v002_beats_v001 -- --ignored --nocapture   # ≥55% gate
```

Stage B exit: **55.0%** vs v001 in the fixed MCTS-vs-MCTS suite.

## Iterative promotion (T1-7)

One scripted iteration: distill from incumbent → train candidate → eval → promote if ≥
55%. Models use the `vNNN.onnx` naming convention (`v001` value-only, `v002+`
policy+value; three-digit zero-padded).

```bash
cd training
python promote.py --incumbent models/v002.onnx
```

Options:

| Flag | Default | Purpose |
| ---- | ------- | ------- |
| `--positions` | 5120 | MCTS self-play positions (`--distill` incumbent) |
| `--epochs` | 40 | training epochs for candidate |
| `--threshold` | 0.55 | promotion gate (matches arch §9) |
| `--iterations` | 1 | stop early if a candidate fails the gate |
| `--eval-only` | off | skip self-play/train; evaluate `--candidate` vs incumbent |
| `--skip-train` | off | require existing `--candidate` ONNX |

The gate runs `chesskers-engine eval-promotion` (fixed 30-game MCTS-vs-MCTS suite
from arch §9). On promotion the candidate is copied to `engine/models/`.

```bash
cd engine
cargo run --release -- eval-promotion --challenger v003 --baseline v002
```

## Milestone status

**T1-1** through **T1-7** are complete. The encoder (`chesskers/encoder.py`,
spec `configs/encoder_v1.yaml`) produces byte-identical tensors to the Rust encoder
on every fixture, verified via FNV-1a golden hashes in `tests/test_encoder.py`.
Iterative promotion is documented in [docs/architecture.md](../docs/architecture.md) §7 / §9 Stage C.
