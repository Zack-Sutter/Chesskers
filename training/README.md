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

## Layout (built out across T1-2 … T1-7)

```
training/
  requirements.txt      # this milestone (T1-1)
  README.md             # this file (T1-1)
  chesskers/            # rules mirror + encoder (T1-2, T1-3)
  configs/
    encoder_v1.yaml     # tensor layout spec (T1-3)
  self_play.py          # random self-play shard writer (T1-4)
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

## Milestone status

**T1-1** (scaffold), **T1-2** (rules mirror), **T1-3** (board encoder),
**T1-4** (self-play shard writer), and **T1-5** (value-only CNN + ONNX export)
are complete. The encoder (`chesskers/encoder.py`, spec
`configs/encoder_v1.yaml`) produces byte-identical tensors to the Rust encoder on
every fixture, verified via FNV-1a golden hashes in `tests/test_encoder.py`.
Remaining milestones (T1-6 policy+MCTS, T1-7 iterative loop) are tracked in
[docs/architecture.md](../docs/architecture.md) §7.
