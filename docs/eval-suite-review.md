# Eval suite review — v007 vs v006

**Date:** 2026-07-14  
**Harness:** `chesskers-engine eval-promotion` → `promotion_suite` in `engine/src/mcts.rs`  
**Matchup:** challenger `v007` vs baseline `v006`  
**Sample:** 150 seeds × both colors = **300 games** per board  
**Gate:** challenger score ≥ **55%** (wins + 0.5×draws) / games  

Artifacts:

- [`engine/eval_v007_vs_v006_300.json`](../engine/eval_v007_vs_v006_300.json) — 3-checker board (branch head)
- [`engine/eval_v007_vs_v006_300_2checker.json`](../engine/eval_v007_vs_v006_300_2checker.json) — 2-checker board (pre-`20dc9bb`)

Interactive charts live in the Cursor canvas `eval-suite-review` (open beside chat).

---

## Verdict

| Board | Black checkers | Win rate | Gate | Models (W–W–D) | Team color (W–B–D) |
| ----- | -------------- | -------- | ---- | -------------- | ------------------ |
| **3-checker** | `(2,6) (4,6) (6,6)` | **50.2%** | rejected | 144–143–13 | 22–265–13 |
| **2-checker** | `(3,6) (4,6)` | **57.2%** | promoted | 167–124–9 | 115–176–9 |

Same models, same MCTS protocol, opposite gate outcomes. On the 3-checker fixture the suite mostly measures **color imbalance**, not relative model strength. On the 2-checker (training) fixture it recovers a clean ~7 pp edge for `v007`.

---

## Suite anatomy

The promotion eval is six separable sections. Scores below use arch §9 scoring: win=1, loss=0, move-capped/stalemate draw=0.5.

### 1. Initial board (fixture)

| | |
| --- | --- |
| **What** | Start position from `fixtures/initial_board.json` (overridable with `--fixtures-dir`) |
| **Control** | Only variable that changed between the two 300-game runs |
| **3-checker performance** | Flat 50.2% model score; black wins **88.3%** of games |
| **2-checker performance** | `v007` at **57.2%**; black still ahead but only **58.7%** |

**Assessment:** Dominant source of variance. Adding the third checker (spread across files 2 / 4 / 6) collapses white’s ability to win under equal MCTS. Do not treat a failed gate on a new board as proof that `v007` ≈ `v006` until the nets are trained for that setup.

### 2. Color balance (challenger sits both seats)

| | |
| --- | --- |
| **What** | Per seed, challenger plays white **and** black; reported `winRate` averages both seats |
| **Intent** | Cancel first-move / seating bias so identical models score ~50% |

Seat scores `(W + 0.5·D) / 150`:

| Board | Challenger as white | Challenger as black |
| ----- | ------------------- | ------------------- |
| 3-checker | **9.7%** (11W / 132L / 7D) | **90.7%** (133W / 11L / 6D) |
| 2-checker | **47.0%** (69W / 78L / 3D) | **67.3%** (98W / 46L / 6D) |

**Assessment:** Color balance does its job (identity matchups would still average ~50%). On 3-checker the seats are so far apart that the average has almost **no discriminative power** between models of similar strength — both nets inherit the black bias.

### 3. Model matchup (challenger vs baseline)

| Board | `v007` wins | `v006` wins | Draws | Edge |
| ----- | ----------- | ----------- | ----- | ---- |
| 3-checker | 144 | 143 | 13 | +1 (noise) |
| 2-checker | 167 | 124 | 9 | **+43** |

**Assessment:** This is the section the 55% gate is meant to read. Only the 2-checker run shows a real skill gap. The 3-checker tie is consistent with both nets being trained on the old initial position.

### 4. Board-color outcomes (white vs black team)

| Board | White wins | Black wins | Draws | White win % |
| ----- | ---------- | ---------- | ----- | ----------- |
| 3-checker | 22 | 265 | 13 | **7.3%** |
| 2-checker | 115 | 176 | 9 | **38.3%** |

**Assessment:** Critical diagnostic (why tallies were added to the JSON). A flat ~50% `winRate` can hide an 88% black win rate. Per-side gates (`--side w`) that always seat the challenger as white would report ~10% even for identical models on 3-checker — previously observed in w-model debugging.

### 5. Opening + search protocol

| Parameter | Value | Role |
| --------- | ----- | ---- |
| Opening | 6 random plies (`random_opening`, seed+9000) | Decorrelate from fixed start |
| MCTS sims / move | 100 both sides | Equal compute; policy priors differentiate dual-head nets |
| Move cap | 120 plies → draw (0.5) | Finite games |
| Default gate | 15 seeds → 30 games | Fast CI / promote loop |
| These diagnostics | 150 seeds → 300 games (`--seeds 150`) | Lower-variance measurement |

Draw share stayed low (**4.3%** / **3.0%**), so the move cap is not swallowing signal.

**Runtime (this machine):**

| Board | Wall clock | ≈ sec / game |
| ----- | ---------- | ------------ |
| 3-checker | ~50 min | ~10 s |
| 2-checker | ~21 min | ~4 s |

**Assessment:** Protocol is appropriate for equal-budget neural MCTS comparison on a **stable** board. Cost scales with game length; the 3-checker setup produces longer / higher-branching games under the same sim budget.

### 6. Promotion gate (≥55%)

| Board | Score | Margin vs 55% | Decision |
| ----- | ----- | ------------- | -------- |
| 3-checker | 50.2% | **−4.8 pp** | reject |
| 2-checker | 57.2% | **+2.2 pp** | promote |

**Assessment:** Threshold was calibrated under Stage B/C for the **2-checker** world (`architecture.md` §9). Reusing it unchanged on the 3-checker fixture rejects every near-parity pair and says little about relative quality.

---

## Implications

1. **Keep color-balanced gates**, but run them on a board that matches training (or retrain before gating on a new setup).
2. **Do not promote 3-checker rules from these nets alone** — distill / self-play on the new initial position first, then re-gate.
3. **Always persist** `challengerWins` / `baselineWins` / `whiteWins` / `blackWins` / `challengerAsWhite` / `challengerAsBlack` (now emitted by `eval-promotion`). A single `winRate` is insufficient.
4. **Default 30-game gate** remains fine for smoke promotion; use ≥300 games when changing the board or diagnosing color bias.

---

## How to reproduce

```powershell
# 3-checker (current fixtures/)
chesskers-engine eval-promotion --challenger v007 --baseline v006 `
  --models-dir engine/models --fixtures-dir fixtures --seeds 150

# 2-checker snapshot
chesskers-engine eval-promotion --challenger v007 --baseline v006 `
  --models-dir engine/models --fixtures-dir engine/eval_fixtures_2checker --seeds 150
```

`--seeds N` → `2N` color-balanced games (added for these diagnostics; default remains 15 → 30).
