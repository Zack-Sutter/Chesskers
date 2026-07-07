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
  self_play.py          # shard writer (T1-4)
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

## Milestone status

**T1-1** (scaffold), **T1-2** (rules mirror), and **T1-3** (board encoder) are
complete. The encoder (`chesskers/encoder.py`, spec `configs/encoder_v1.yaml`)
produces byte-identical tensors to the Rust encoder on every fixture, verified
via FNV-1a golden hashes in `tests/test_encoder.py`. Subsequent milestones
(T1-4 self-play, T1-5 value model, T1-6 policy+MCTS, T1-7 iterative loop) are
tracked in [docs/architecture.md](../docs/architecture.md) §7.
