# Chesskers — Architecture Ground Truth

**Read this file first.** This document is the canonical reference for the Chesskers project. Future agents should pick a single milestone ID from [Section 7](#7-agent-milestone-checklist), verify prerequisites, implement only that scope, and check off the milestone when merged.

**Related docs:**

- [railway-vercel-migration.md](./railway-vercel-migration.md) — multiplayer wire protocol, server move pipeline, deployment detail
- [todo.md](./todo.md) — UI polish backlog (undo, redo, introduction)

---

## 1. Project overview

### What is Chesskers?

Chesskers is a chess/checkers hybrid played on an 8×8 board. White fields a standard chess army; black fields two checkers pieces with torus-wrapping movement. Win conditions are asymmetric — not standard chess checkmate.

### Project goal

Build a **separated architecture**:

| Component                  | Role                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------- |
| **React UI**               | Board rendering, input, sound, modals — no authoritative rules in online/engine modes |
| **TypeScript game-engine** | Canonical rules, serialization, shared `applyMove`                                    |
| **Rust engine**            | Fast search (MCTS / alpha-beta) + ONNX neural-network evaluation at play time         |
| **Python training**        | Offline self-play, PyTorch training, ONNX export                                      |
| **Node server**            | HTTP + WebSocket wrapper; spawns Rust engine for AI moves                             |

Components communicate **only** via versioned JSON schemas, golden fixtures, NPZ training shards, and ONNX model files. No runtime imports across language boundaries.

### Non-goals (v1)

- User authentication or accounts
- Persistent database (Postgres, Redis) — in-memory rooms only initially
- Horizontal scaling / multi-instance sync
- PGN export or move replay
- Timed games / clocks

---

## 2. Game rules reference

Rules documented here match the **current TypeScript implementation**. Rust and Python ports must pass the same golden fixtures — do not invent rules from chess or checkers conventions.

### 2.1 Initial setup

Source: `[src/Constants.ts](../src/Constants.ts)`

| Side                                   | Pieces                         | Positions                        |
| -------------------------------------- | ------------------------------ | -------------------------------- |
| **White** (`TeamType.OUR`, `"w"`)      | Full chess back rank + 8 pawns | Rows 0–1 (standard chess layout) |
| **Black** (`TeamType.OPPONENT`, `"b"`) | Two `checkers` pieces only     | `(3, 6)` and `(4, 6)`            |

There is no black chess army. Black's entire force is the two checkers.

`totalTurns` starts at **1**.

### 2.2 Turn model

Source: `[src/components/Referee/Referee.tsx](../src/components/Referee/Referee.tsx)`

- White moves when `totalTurns % 2 === 1` (odd).
- Black moves when `totalTurns % 2 === 0` (even).
- **Checkers hop lock:** when `checkersHopPosition` is set, only the checkers piece at that square may move. Turn parity checks are bypassed until the hop chain ends.
- After a valid checkers **jump**:
  - If further jumps exist from the landing square → set `checkersHopPosition` to landing; **do not** increment `totalTurns`.
  - Otherwise → clear `checkersHopPosition`; increment `totalTurns`.
- Non-jump moves (including chess moves and checkers steps) → clear hop lock; increment `totalTurns`.

### 2.3 Win conditions

Source: `[src/models/Board.ts](../src/models/Board.ts)` (`calculateAllMoves`, lines 69–83)

```typescript
if (!this.pieces.some((p) => p.team === TeamType.OPPONENT)) {
  this.winningTeam = TeamType.OUR; // white wins
}
if (!this.pieces.some((p) => p.isKing && p.team === TeamType.OUR)) {
  this.winningTeam = TeamType.OPPONENT; // black wins
}
```

| Winner            | Condition                  | Typical cause                   |
| ----------------- | -------------------------- | ------------------------------- |
| **White** (`"w"`) | No black pieces remain     | Both checkers captured          |
| **Black** (`"b"`) | No white **king** on board | King captured via checkers jump |

UI messages (`[Referee.tsx](../src/components/Referee/Referee.tsx)`):

- Black: `"Black wins — white king jumped and burgled!"`
- White: `"White wins — all black pieces captured!"`

There is no stalemate or draw detection in the current implementation.

### 2.4 Checkers piece rules

Source: `[src/referee/rules/CheckersRules.ts](../src/referee/rules/CheckersRules.ts)`

- **Step:** 1 square in any of 8 directions (king-like), to an empty square.
- **Jump:** 2 squares in any of 8 directions over an **adjacent opponent piece** to an empty landing square; jumped piece is removed.
- **Multi-hop:** mandatory continuation within the same turn when additional jumps exist (enforced via `checkersHopPosition`).
- **Torus wrapping:** only checkers use `wrapCoord()` from `[src/models/Position.ts](../src/models/Position.ts)`. Steps and jumps wrap at board edges.

Wrapped-edge behavior is tested in `[packages/game-engine/src/Board.test.ts](../packages/game-engine/src/Board.test.ts)`:

- Wrapped step across left edge: `(0,3) → (7,3)`
- Wrapped orthogonal hop: checkers at `(0,3)` jumps pawn at `(7,3)` to `(6,3)`
- Wrapped diagonal hop across corner: checkers at `(0,0)` jumps pawn at `(7,7)` to `(6,6)`

### 2.5 Chess piece rules

Standard chess movement for pawns, knights, bishops, rooks, queen, king — including castling and en passant. Chess pieces **do not** wrap; moves outside 0–7 are invalid (`[src/referee/rules/RookRules.ts](../src/referee/rules/RookRules.ts)` and siblings).

Castling moves are appended in `Board.calculateAllMoves()` after per-piece move generation.

### 2.6 Pawn promotion

When a pawn reaches rank **7** (white) or rank **0** (black):

- UI shows promotion modal (queen / rook / bishop / knight).
- In online and vs-engine modes, server sets `pendingPromotion` and emits `promote_required`; further moves blocked until `promote` message received.
- Promotion is **not** automatic — player (or engine policy) must choose piece type.

Pawn `enPassant` flag lives on `[src/models/Pawn.ts](../src/models/Pawn.ts)` and must serialize.

### 2.7 Logic split (critical for agents)

Today, game logic is split across two layers:

| Layer       | File                                                                          | Responsibilities                                                                                            |
| ----------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| **Board**   | `[src/models/Board.ts](../src/models/Board.ts)`                               | Move generation, `playMove()` (movement + captures), win detection, castling                                |
| **Referee** | `[src/components/Referee/Referee.tsx](../src/components/Referee/Referee.tsx)` | Turn enforcement, en passant **detection**, checkers hop continuation, turn increment, promotion UI trigger |

**Target state:** consolidate Referee orchestration into `packages/game-engine` as:

```typescript
applyMove(board: Board, move: Move): ApplyMoveResult
// ApplyMoveResult includes: new Board, pendingPromotion?, gameOver?
```

UI, server, and tests must all call `applyMove` — not duplicate turn/hop logic.

---

## 3. Target architecture

```mermaid
flowchart TB
  subgraph ui [TypeScript UI - Vite React]
    Chessboard[Chessboard + Referee]
  end

  subgraph tsEngine [packages/game-engine TS]
    Rules[Board rules + serialize]
  end

  subgraph serverLayer [server Node Fastify]
    WS[HTTP + WebSocket]
  end

  subgraph rustEngine [engine Rust]
    Search[MCTS or alpha-beta]
    Ort[ONNX Runtime]
  end

  subgraph trainingLayer [training Python offline]
    Mirror[Rules mirror]
    SelfPlay[Self-play workers]
    Train[PyTorch train export]
  end

  Chessboard -->|move intents| WS
  WS --> Rules
  WS --> Search
  Search --> Ort
  Mirror --> SelfPlay
  SelfPlay -->|NPZ shards| Train
  Train -->|model.onnx| Ort
  Rules -.->|JSON fixtures| Mirror
```

### Language assignments (locked)

| Layer                 | Language                    | Location                |
| --------------------- | --------------------------- | ----------------------- |
| UI                    | TypeScript / React          | `[src/](../src/)`       |
| Rules package         | TypeScript                  | `packages/game-engine/` |
| Game server           | Node (Fastify) v1           | `server/`               |
| Search + NN inference | **Rust** + ONNX Runtime     | `engine/`               |
| NN training           | **Python** (PyTorch → ONNX) | `training/`             |

### Separation principle

**No runtime imports across language boundaries.** Shared artifacts only:

| Artifact                           | Purpose                                    |
| ---------------------------------- | ------------------------------------------ |
| `fixtures/*.json`                  | Golden positions exported from Vitest      |
| `SerializedBoard` JSON             | Wire format between UI, server, engine CLI |
| `training/shards/*.npz`            | Training data on disk (`states`, `outcomes`; Stage B+ adds `policy_idx`, `policy_val` — [§5.7](#57-npz-shard-format-stage-b)) |
| `engine/models/*.onnx`             | Exported neural network weights            |
| `training/configs/encoder_v1.yaml` | Tensor layout spec (created at T1-3)       |

---

## 4. Repository layout (target)

```
React-Chess/
  packages/
    game-engine/          # TS: Board, rules, serialize, applyMove
  engine/                   # Rust: rules port, search, ONNX, CLI
  server/                   # HTTP/WS wrapper for UI + multiplayer
  training/                 # Python: mirror, encoder, self-play, train
    configs/
      encoder_v1.yaml       # created at T1-3
    shards/
    models/
  fixtures/                 # Golden JSON from vitest exports
  src/                      # React UI (imports game-engine)
  docs/
    architecture.md         # THIS FILE
    railway-vercel-migration.md
    todo.md
```

### Current source files (pre-extraction)

| Path                                                                                                                            | Role                                      |
| ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `[src/models/Board.ts](../src/models/Board.ts)`                                                                                 | Core game state and move application      |
| `[src/models/Piece.ts](../src/models/Piece.ts)`, `[Pawn.ts](../src/models/Pawn.ts)`, `[Position.ts](../src/models/Position.ts)` | Piece models                              |
| `[src/referee/rules/](../src/referee/rules/)`                                                                                   | Per-piece move generation                 |
| `[src/Types.ts](../src/Types.ts)`                                                                                               | `PieceType`, `TeamType` enums             |
| `[src/Constants.ts](../src/Constants.ts)`                                                                                       | `initialBoard`, board dimensions, UI axes |
| `[src/components/Referee/Referee.tsx](../src/components/Referee/Referee.tsx)`                                                   | UI orchestration (to be thinned)          |
| `[src/components/Chessboard/Chessboard.tsx](../src/components/Chessboard/Chessboard.tsx)`                                       | Board rendering and drag input            |
| `[packages/game-engine/src/Board.test.ts](../packages/game-engine/src/Board.test.ts)`                                           | Rules regression tests                    |

---

## 5. Shared contracts

### 5.1 SerializedBoard (schemaVersion: 1)

```typescript
interface SerializedBoard {
  schemaVersion: 1;
  pieces: {
    x: number;
    y: number;
    type: "pawn" | "rook" | "bishop" | "knight" | "queen" | "king" | "checkers";
    team: "w" | "b";
    hasMoved: boolean;
    enPassant?: boolean; // pawns only
  }[];
  totalTurns: number;
  checkersHopPosition?: { x: number; y: number };
  winningTeam?: "w" | "b";
}
```

**Serialization rules:**

- **Include:** position, type, team, `hasMoved`, pawn `enPassant`
- **Exclude:** `possibleMoves`, `image` paths (derived from type + team on each client)
- After deserialize, always call `calculateAllMoves()` before accepting input or validating moves
- Bump `schemaVersion` if the wire format changes; never silently break Rust/Python ports

### 5.2 Move encoding

```typescript
interface Move {
  from: { x: number; y: number };
  to: { x: number; y: number };
  promotion?: "queen" | "rook" | "bishop" | "knight";
}
```

**Legal move list:** engine returns `Move[]` computed from current board state. UI highlights via `calculateAllMoves()` locally — do not sync `possibleMoves` over the wire.

### 5.3 Move index for NN policy head

Variable legal move count per position. Policy head uses a fixed logits vector with **legal-move masking**.

**Base index (v1 draft — finalize in** `training/configs/encoder_v1.yaml` **at T1-3):**

```
fromIndex = from.y * 8 + from.x   // 0..63
toIndex   = to.y * 8 + to.x       // 0..63
baseIndex = fromIndex * 64 + toIndex   // 0..4095
```

When `promotion` applies (pawn on 7th/2nd rank reaching back rank), add a promotion bucket offset:

```
promotionOffset = { queen: 0, rook: 4096, bishop: 8192, knight: 12288 }[promotion]
moveIndex = baseIndex + promotionOffset
```

Maximum policy logits: 16384 (4096 × 4 promotion choices). Mask illegal indices to `-inf` before softmax.

### 5.4 NN input encoding (encoder_v1)

Spec file: `training/configs/encoder_v1.yaml` (created at T1-3; loaded by the Python encoder and mirrored by `engine/src/encoder.rs`).

| Plane(s) | Description                                                           |
| -------- | --------------------------------------------------------------------- |
| 0–6      | White piece types (pawn, rook, bishop, knight, queen, king, checkers) |
| 7–13     | Black piece types (same order)                                        |
| 14       | Side to move (1.0 = white, 0.0 = black) — full 8×8 fill               |
| 15       | Checkers hop lock (1.0 at hop square, 0 elsewhere)                    |

**Tensor shape:** `[batch, 16, 8, 8]`

**Value head output:** scalar in `[-1, 1]` from **side-to-move** perspective (+1 = side to move wins, −1 = loses, 0 = draw/unknown).

**Policy head output:** logits vector (size per §5.3); masked to legal moves.

**Versioning:** breaking layout changes → `encoder_v2.yaml`; Rust and Python encoders must stay in sync via fixture comparison tests.

### 5.5 UI ↔ server WebSocket protocol

Full message tables: [railway-vercel-migration.md §5](./railway-vercel-migration.md#5-wire-protocol).

**Summary — client → server:**

```typescript
{ type: "join", gameId: string, playerToken?: string }
{ type: "move", from: { x, y }, to: { x, y } }
{ type: "promote", pieceType: "queen" | "rook" | "bishop" | "knight" }
{ type: "requestEngineMove" }   // vs-engine mode only
```

**Summary — server → client:**

```typescript
{ type: "joined", color: "w" | "b", board: SerializedBoard, playerToken: string }
{ type: "waiting" }
{ type: "state", board: SerializedBoard }
{ type: "promote_required", position: { x, y } }
{ type: "gameOver", winner: "w" | "b", reason: "capture_all" | "king_jumped" }
{ type: "engineThinking" }
{ type: "error", message: string }
```

**REST endpoints:**

| Method | Path                | Response                                    |
| ------ | ------------------- | ------------------------------------------- |
| `GET`  | `/health`           | `{ ok: true }`                              |
| `POST` | `/games`            | `{ gameId, initialState: SerializedBoard }` |
| `POST` | `/games/:id/engine` | `{ engineColor, model?, thinkMs?, depth? }` | `{ engineColor, model, thinkMs, depth }`    |

Server move pipeline detail: [railway-vercel-migration.md §7](./railway-vercel-migration.md#7-server-side-move-pipeline).

### 5.6 Rust Evaluator trait (internal, in-process)

Not exposed over HTTP. Used inside the Rust engine between search and ONNX.

```rust
trait Evaluator {
    fn evaluate(&self, state: &GameState) -> EvalResult;
}

struct EvalResult {
    value: f32,                      // [-1, 1] from side-to-move POV
    policy: Vec<(Move, f32)>,        // optional; MCTS priors
}
```

### 5.7 NPZ shard format (Stage B+)

Written by `training/self_play.py`; consumed by `training/train.py`.

| Key           | dtype     | shape           | Description                                                          |
| ------------- | --------- | --------------- | -------------------------------------------------------------------- |
| `states`      | `float32` | `[N, 16, 8, 8]` | encoder_v1 tensor per position ([§5.4](#54-nn-input-encoding-encoder_v1)) |
| `outcomes`    | `float32` | `[N]`           | value target from side-to-move POV in `[-1, 1]`                      |
| `policy_idx`  | `int32`   | `[N, K]`        | sparse move indices ([§5.3](#53-move-index-for-nn-policy-head)); `-1` pad |
| `policy_val`  | `float32` | `[N, K]`        | normalized visit counts; `0` pad                                     |

`K` = 128 (`MAX_POLICY_ENTRIES` in `self_play.py`). Stage A shards (T1-4) omit `policy_idx` / `policy_val`; the T1-6 trainer rejects them.

---

## 6. Rust engine CLI

Documented interface for `engine/` binary (implemented at E1-5, E2-4). All commands read/write **JSON on stdin/stdout**.

```bash
# List legal moves for a position
echo '{"schemaVersion":1,...}' | chesskers-engine legal-moves

# Apply a move; prints new SerializedBoard or error
echo '{"board":{...},"move":{"from":{"x":3,"y":1},"to":{"x":3,"y":3}}}' | chesskers-engine apply-move

# Check terminal state
echo '{"schemaVersion":1,...}' | chesskers-engine is-terminal
# → {"terminal":true,"winner":"w"|"b"|null}

# Play a full random-vs-random game to terminal (E1-6)
echo '{"schemaVersion":1,...}' | chesskers-engine play-random --seed 42
# → {"terminal":true,"winner":"w"|"b","movesPlayed":N}

# Play one engine move (E2-4)
chesskers-engine best-move --model engine/models/v001.onnx --think-ms 2000 --depth 4 < board.json
# → {"move":{"from":{...},"to":{...},"promotion?":"queen"}}

# Promotion gate: MCTS-vs-MCTS win rate (T1-7)
chesskers-engine eval-promotion --challenger v003 --baseline v002
# → {"challenger":"v003","baseline":"v002","winRate":0.55,"games":30,"threshold":0.55,"promoted":true}
```

Server spawns `best-move` as a child process or links the crate directly — pick one at S1-4; document choice in server README.

---

## 7. Agent milestone checklist

Each milestone is **independently assignable**. Before starting:

1. Read this document fully.
2. Confirm prerequisite milestones are checked off below.
3. Implement only what "Done when" specifies.
4. Check off the milestone checkbox when merged.

---

### M0 — Game engine extraction (TypeScript)

- [x] **M0-1** — Scaffold `packages/game-engine`
  - **Prerequisites:** none
  - **Touch:** `packages/game-engine/` (`package.json`, `tsconfig.json`, vitest config)
  - **Done when:** `npm test` in package passes (empty or stub suite)

- [x] **M0-2** — Move core logic into game-engine
  - **Prerequisites:** M0-1
  - **Touch:** move `src/models/`, `src/referee/rules/`, `src/Types.ts` → game-engine; update `src/` imports
  - **Done when:** no duplicate model/rule files in `src/`; frontend builds

- [x] **M0-3** — Split constants
  - **Prerequisites:** M0-2
  - **Touch:** `[src/Constants.ts](../src/Constants.ts)` → game-engine board constants + `src/constants/ui.ts` for `VERTICAL_AXIS`, `HORIZONTAL_AXIS`
  - **Done when:** `initialBoard` lives in game-engine; UI axes in `src/`

- [x] **M0-4** — Board serialization
  - **Prerequisites:** M0-2
  - **Touch:** game-engine `serializeBoard` / `deserializeBoard`
  - **Done when:** round-trip test passes; output matches [§5.1](#51-serializedboard-schemaversion-1)

- [x] **M0-5** — Extract `applyMove()`
  - **Prerequisites:** M0-2
  - **Touch:** game-engine + `[Referee.tsx](../src/components/Referee/Referee.tsx)`
  - **Done when:** turn, hop, en passant, promotion-pending logic in game-engine; Referee delegates; `[Board.test.ts](../packages/game-engine/src/Board.test.ts)` passes

- [x] **M0-6** — Move tests to game-engine
  - **Prerequisites:** M0-5
  - **Touch:** move `[Board.test.ts](../packages/game-engine/src/Board.test.ts)` → game-engine; wire root `npm test`
  - **Done when:** CI / root test script green

- [x] **M0-7** — Export golden fixtures
  - **Prerequisites:** M0-6
  - **Touch:** `fixtures/*.json`, export script in game-engine
  - **Done when:** one JSON file per significant test case; format documented in [§8](#8-fixture-format)

---

### E1 — Rust engine shell

- [x] **E1-1** — Scaffold Rust crate
  - **Prerequisites:** M0-7
  - **Touch:** `engine/` (`cargo init`, `Cargo.toml`)
  - **Done when:** `cargo build` succeeds

- [x] **E1-2** — Port SerializedBoard types
  - **Prerequisites:** E1-1
  - **Touch:** `engine/src/state.rs` (or equivalent)
  - **Done when:** parses all files in `fixtures/`

- [x] **E1-3** — Port move generation + win detection
  - **Prerequisites:** E1-2
  - **Touch:** `engine/src/rules/`
  - **Done when:** `cargo test` legal-move and terminal assertions match fixtures

- [x] **E1-4** — Port `apply_move`
  - **Prerequisites:** E1-3
  - **Touch:** `engine/src/apply.rs`
  - **Done when:** fixture replay tests pass end-to-end (sequence of moves → expected board)

- [x] **E1-5** — CLI commands
  - **Prerequisites:** E1-4
  - **Touch:** `engine/src/main.rs`
  - **Done when:** `legal-moves`, `apply-move`, `is-terminal` work per [§6](#6-rust-engine-cli)

- [x] **E1-6** — Random-move bot
  - **Prerequisites:** E1-5
  - **Touch:** `engine/`
  - **Done when:** CLI plays a full random-vs-random game to terminal without illegal moves

---

### E2 — Search + ONNX (Rust)

- [x] **E2-1** — Board → tensor encoder (Rust)
  - **Prerequisites:** E1-4
  - **Touch:** `engine/src/encoder.rs`
  - **Done when:** matches Python encoder on all fixtures (T1-3 provides reference) or documented float tolerance

- [x] **E2-2** — ONNX Runtime integration
  - **Prerequisites:** E2-1
  - **Touch:** `engine/` (add `ort` or `tract` dependency)
  - **Done when:** loads dummy or v001 ONNX; `evaluate` returns finite value

- [x] **E2-3** — Search with value-only NN
  - **Prerequisites:** E2-2
  - **Touch:** `engine/src/search.rs`
  - **Done when:** beats E1-6 random bot >90% over 100-game suite

- [x] **E2-4** — `best-move` CLI
  - **Prerequisites:** E2-3
  - **Touch:** `engine/src/main.rs`
  - **Done when:** returns legal move within `--think-ms` budget per [§6](#6-rust-engine-cli)

---

### S1 — Server + UI vs engine

- [x] **S1-1** — Scaffold server
  - **Prerequisites:** M0-4
  - **Touch:** `server/` (Fastify + `ws`)
  - **Done when:** `GET /health` → `{ ok: true }`

- [x] **S1-2** — Create game endpoint
  - **Prerequisites:** S1-1, M0-4
  - **Touch:** `server/src/routes.ts`
  - **Done when:** `POST /games` returns `{ gameId, initialState }`

- [x] **S1-3** — WebSocket move pipeline
  - **Prerequisites:** S1-2, M0-5
  - **Touch:** `server/`
  - **Done when:** authoritative moves work; see [migration doc §7](./railway-vercel-migration.md#7-server-side-move-pipeline); local two-tab test passes

- [x] **S1-4** — Engine integration
  - **Prerequisites:** S1-3, E2-4
  - **Touch:** `server/` + engine binary
  - **Done when:** `POST /games/:id/engine` enables AI; `requestEngineMove` triggers Rust `best-move` and broadcasts `state`

- [x] **S1-5** — React vs-engine mode
  - **Prerequisites:** S1-4
  - **Touch:** `[Referee.tsx](../src/components/Referee/Referee.tsx)`, lobby route
  - **Done when:** full game vs engine in browser; local hot-seat still works

**Multiplayer (two humans) — S1-M sub-track:**

Follow checklist in [railway-vercel-migration.md §12](./railway-vercel-migration.md#12-implementation-checklist) items 11–16 (React Router, env vars, `useGameRoom`, deploy). Do not duplicate that checklist here.

---

### T1 — Python training pipeline (offline)

- [x] **T1-1** — Scaffold training package
  - **Prerequisites:** M0-7
  - **Touch:** `training/requirements.txt`, `training/README.md`
  - **Done when:** `pip install -r requirements.txt` succeeds (torch, numpy, onnx, pyyaml)

- [x] **T1-2** — Python rules mirror
  - **Prerequisites:** T1-1
  - **Touch:** `training/chesskers/` rules module
  - **Done when:** `pytest` passes all `fixtures/` assertions (legal moves, terminals, apply-move sequences)

- [x] **T1-3** — Python board encoder
  - **Prerequisites:** T1-2
  - **Touch:** `training/chesskers/encoder.py`, `training/configs/encoder_v1.yaml`
  - **Done when:** encoder output matches E2-1 Rust encoder on fixtures

- [x] **T1-4** — Self-play shard writer
  - **Prerequisites:** T1-2
  - **Touch:** `training/self_play.py`
  - **Done when:** generates 1000+ positions to `training/shards/` as NPZ (states, outcomes; policy targets optional until T1-6)

- [x] **T1-5** — Value-only CNN + ONNX export
  - **Prerequisites:** T1-3, T1-4
  - **Touch:** `training/train.py`, `training/models/v001.onnx`
  - **Done when:** ONNX loads in Rust E2-2; measurable improvement over random in 100-game suite
  - **Result:** `v001.onnx` loads via tract (`v001_onnx_loads_and_evaluates`); `search_vs_random_win_rate` scored 100/0/0 vs random (arch §9 Stage A exit met). Copy the trained model to `engine/models/v001.onnx` for the engine to consume.

- [x] **T1-6** — Policy + value head + MCTS self-play
  - **Prerequisites:** T1-5, E2-3
  - **Touch:**
    - `training/self_play.py` — MCTS self-play shard writer (`--distill` loads v001 for leaf value + distilled targets)
    - `training/train.py` — dual-head `PolicyValueNet` trainer + ONNX export
    - `training/chesskers/mcts.py`, `training/chesskers/move_index.py` — Python PUCT MCTS + §5.3 move index (mirrors Rust)
    - `training/tests/test_self_play.py`, `training/tests/test_move_index.py`
    - `engine/src/mcts.rs`, `engine/src/move_index.rs` — Rust MCTS + fixed eval suite
    - `engine/src/evaluator.rs` — dual-output ONNX (`value` + `policy` logits)
    - `training/models/v002.onnx` → copy to `engine/models/v002.onnx`
  - **Done when:** `v002.onnx` beats `v001.onnx` ≥55% in the fixed MCTS-vs-MCTS suite ([§9 Stage B exit](#stage-b--policy--value-t1-6))
  - **Workflow:**
    ```bash
    cd training
    python self_play.py --positions 5120 --sims 100 --distill models/v001.onnx --out shards/ --seed 42
    python train.py --shards shards/ --out models/v002.onnx --epochs 40 --policy-weight 1.0 --seed 42
    cp models/v002.onnx ../engine/models/v002.onnx
    cd ../engine
    cargo test --release mcts::tests::v002_beats_v001 -- --ignored --nocapture
    ```
  - **Artifacts:** NPZ shards add `policy_idx` / `policy_val` (sparse visit-count targets; see [§5.7](#57-npz-shard-format-stage-b)). Exported `v002.onnx` returns `value` (scalar tanh) and `policy` (`[1, 16384]` logits). Separate conv trunks for value and policy so v002 can distill v001's value tightly while learning priors independently.
  - **Result:** `v002.onnx` scored **55.0%** vs `v001.onnx` (`mcts::tests::v002_beats_v001`). Diagnostic (`v002_diagnostic`): value-only (uniform priors) 50.0%; value+policy 53.1% — confirms the gate measures policy-head lift, not a stronger value net.

- [x] **T1-7** — Iterative training workflow
  - **Prerequisites:** T1-6
  - **Touch:** `training/promote.py`, `engine/src/mcts.rs` (`promotion_win_rate`), `engine` CLI `eval-promotion`
  - **Done when:** `vNNN.onnx` naming convention documented; promotion reuses the [fixed MCTS-vs-MCTS suite](#stage-b--policy--value-t1-6) (≥55% vs incumbent) in a scripted loop
  - **Workflow:**
    ```bash
    cd training
    python promote.py --incumbent models/v002.onnx
    # or evaluate an existing candidate without retraining:
    python promote.py --incumbent models/v002.onnx --eval-only --candidate models/v003.onnx
    ```
  - **Naming:** `vNNN.onnx` — three-digit zero-padded (`v001` value-only, `v002+` policy+value). Promoted models are copied to `engine/models/`.

---

### P1 — UI polish (non-blocking)

- [x] **P1-1** — Undo / redo
  - **Prerequisites:** M0-5
  - **Touch:** Referee, move history stack
  - **Done when:** see [todo.md](./todo.md)

- [ ] **P1-2** — Introduction / rules page
  - **Prerequisites:** none
  - **Touch:** `src/` static page + lobby link
  - **Done when:** rules page reachable from app entry

- [x] **P1-3** — Engine strength selector
  - **Prerequisites:** S1-5
  - **Touch:** UI settings
  - **Done when:** user can set depth / think-ms before vs-engine game

---

## 8. Testing strategy

| Layer       | Tool                             | What it validates                              |
| ----------- | -------------------------------- | ---------------------------------------------- |
| TypeScript  | vitest in `packages/game-engine` | Rules regression, serialize round-trip         |
| Fixtures    | `fixtures/*.json`                | Single source of truth for Rust + Python ports |
| Rust        | `cargo test`                     | Loads same fixtures as TS/Python               |
| Python      | `pytest`                         | Loads same fixtures                            |
| Integration | 100-game Rust vs Rust suite      | Run after each model promotion (T1-7)          |

**Rules:**

- Export fixtures from TS tests (M0-7); never hand-author fixture JSON without a TS test backing it.
- **Do not** subprocess to Node from Python in the training hot loop.
- **Do not** share source code across Rust and Python — share fixtures and encoder YAML spec.

### Fixture format

Each file in `fixtures/` (created at M0-7):

```json
{
  "name": "declares_black_winner_when_white_king_hopped",
  "board": { "schemaVersion": 1, "pieces": [...], "totalTurns": 2 },
  "action": {
    "move": { "from": { "x": 4, "y": 6 }, "to": { "x": 2, "y": 4 } }
  },
  "expect": {
    "winningTeam": "b",
    "pieceCount": 1,
    "legalMovesFrom": null
  }
}
```

Exact schema may vary by test type (position-only vs move-sequence). Document the export script output in game-engine README when M0-7 lands.

---

## 9. Training pipeline (offline)

Training runs entirely in `training/` with no live connection to UI or server.

```mermaid
flowchart LR
  Fixtures[fixtures JSON] --> Mirror[Python rules mirror]
  Mirror --> SelfPlay[Self-play workers]
  SelfPlay --> Shards[NPZ shards]
  Shards --> Train[PyTorch train]
  Train --> ONNX[model.onnx]
  ONNX --> Rust[Rust engine ORT]
```

### Stage A — Value-only (T1-4, T1-5)

|             |                                                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------------------ |
| **Entry**   | Fixtures pass in Python; random bot exists in Rust                                                                 |
| **Process** | Self-play with random/heuristic opponents → outcome labels per position → train small CNN value head → export ONNX |
| **Exit**    | `v001.onnx` loaded in Rust; engine beats random >90%                                                               |

### Stage B — Policy + value (T1-6)

|             |                                                                                                                                                                                                 |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Entry**   | `v001.onnx` promoted (Stage A exit met)                                                                                                                                                         |
| **Process** | v001-guided MCTS self-play (`--distill`) → sparse visit-count policy labels + v001-distilled value targets → train dual-head net → export `v002.onnx`                                           |
| **Exit**    | `v002.onnx` beats `v001.onnx` ≥55% in the fixed MCTS-vs-MCTS suite below                                                                                                                      |

**Bootstrap rationale:** Self-play MCTS is leaf-guided by **v001's value** (not material heuristic) so policy targets are higher quality. Value targets are **distilled from v001** on every position — not terminal game outcomes — so v002's value head stays anchored to v001. The promotion gate then isolates the **policy head**: both models play via MCTS at equal sim budgets, but only v002 supplies trained PUCT priors (v001 is value-only and falls back to uniform priors).

**Fixed MCTS-vs-MCTS evaluation suite** (gate for Stage B and T1-7 promotions; implemented in `engine/src/mcts.rs`):

| Parameter        | Value                                                                 |
| ---------------- | --------------------------------------------------------------------- |
| Test             | `mcts::tests::v002_beats_v001` (diagnostic: `v002_diagnostic`)       |
| Board            | `fixtures/initial_board.json`                                         |
| Opening          | 6 random plies per game (`random_opening`)                            |
| Move cap         | 120 plies; capped games score **0.5** (half win)                      |
| MCTS sims/move   | 100 (both sides)                                                      |
| Seeds            | 15 (`0..15`), each played as challenger white **and** black → 30 games |
| Scoring          | win = 1.0, loss = 0.0, move-capped draw = 0.5                         |
| Gate             | challenger win rate ≥ **55%**                                         |

At play time, v002+ models use MCTS with policy priors from the policy head; v001 and earlier value-only models continue to use alpha-beta (`search.rs`) or MCTS with uniform priors.

### Stage C — Iterative (T1-7)

|             |                                                                                                                                          |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| **Entry**   | Stage B complete                                                                                                                         |
| **Process** | `self_play --distill vNNN.onnx` → `train.py` → candidate `vNNN+1.onnx` → [fixed eval suite](#stage-b--policy--value-t1-6) → promote if ≥55% |
| **Exit**    | Documented repeatable loop; models in `engine/models/vNNN.onnx`                                                                          |

**Value target semantics:**

| Stage   | Non-terminal value target                         | Terminal / move-capped              |
| ------- | ------------------------------------------------- | ----------------------------------- |
| A (T1-4)| eventual game outcome from side-to-move POV       | same (+1 / −1 / 0)                  |
| B (T1-6)| v001 network evaluation (`--distill`; §5.4 POV)   | distilled v001 value on that position |
| C (T1-7)| promoted model evaluation (iterative distillation)| same as Stage B pattern             |

Policy targets (Stage B+): root MCTS visit-count distribution over legal moves, stored sparsely as `(move_index, normalized_visits)` per [§5.7](#57-npz-shard-format-stage-b).

---

## 10. Deployment

| Host        | Artifact                  | Serves                                     |
| ----------- | ------------------------- | ------------------------------------------ |
| **Vercel**  | `npm run build` → `dist/` | Static React SPA                           |
| **Railway** | `server/` Node process    | HTTP, WebSocket, spawns Rust engine binary |
| **Local**   | all services              | Dev workflow                               |

**Environment variables:**

| Variable             | Where          | Purpose                                             |
| -------------------- | -------------- | --------------------------------------------------- |
| `VITE_API_URL`       | Vercel build   | Railway HTTP base                                   |
| `VITE_WS_URL`        | Vercel build   | Railway WebSocket base                              |
| `ENGINE_BINARY_PATH` | Railway server | Path to Rust `chesskers-engine` binary              |
| `MODEL_PATH`         | Railway server | Default ONNX model (e.g. `engine/models/v003.onnx`) |
| `PORT`               | Railway server | HTTP/WS listen port                                 |

Full deployment detail: [railway-vercel-migration.md §9](./railway-vercel-migration.md#9-deployment-split).

---

## 11. Known limitations and upgrade paths

### Multiplayer / server (from migration doc)

| Limitation                  | Impact                         | Upgrade path               |
| --------------------------- | ------------------------------ | -------------------------- |
| In-memory rooms             | Games lost on redeploy/crash   | Redis or Postgres          |
| No authentication           | Anyone with `gameId` can join  | Room passwords or auth     |
| Room ID is the secret       | Guessable IDs are joinable     | UUIDs; private rooms       |
| No move history             | No replay                      | Append-only move log in DB |
| No rate limiting            | Spamable                       | Per-IP throttle            |
| Single Railway instance     | No horizontal scaling          | Redis pub/sub              |
| `playerToken` not persisted | Reconnect fails after redeploy | Store tokens in Redis      |

### Engine / training

| Limitation                      | Impact                                   | Upgrade path                                |
| ------------------------------- | ---------------------------------------- | ------------------------------------------- |
| Model not on persistent volume  | Railway redeploy resets to default model | Mount volume or S3 fetch for `MODEL_PATH`   |
| Rules duplicated in 3 languages | Drift risk                               | Fixtures CI gate on every PR                |
| No draw detection               | Games run until terminal win             | Add repetition / move-limit rules if needed |
| 16384-move policy space         | Sparse for early training                | Stage A value-only first; mask aggressively |

### Future upgrades (out of scope v1)

- Redis persistence, spectators, rematch, timed games — see [migration doc §11](./railway-vercel-migration.md#11-future-upgrades-out-of-scope-for-v1)
- Board flip for black player online
- Analysis mode / eval bar in UI
- Engine opening book

---

## 12. Agent operating instructions

1. **Read this file fully** before starting any task.
2. **Pick one milestone ID** (e.g. M0-4, E1-3). Verify all prerequisites are checked off.
3. **Stay in scope.** Do not expand beyond that milestone's "Done when" criteria.
4. **Never share code** across Rust and Python. Share `fixtures/` and `encoder_v1.yaml` only.
5. **Bump versions** if you break wire format (`schemaVersion`) or tensor layout (`encoder_v2`).
6. **Check off the milestone** in [Section 7](#7-agent-milestone-checklist) when your PR merges.
7. **Do not sync** `possibleMoves` **over the wire.** Both sides call `calculateAllMoves()` locally.
8. **Consolidate Referee logic** into game-engine when touching move application — do not add a fourth copy in server code.
9. **Promotion is two-step** in server/engine modes: move → `promote_required` → `promote`. Engine must handle pending promotion in search state.
10. **Checkers torus wrapping** applies only to `PieceType.CHECKERS` — chess pieces clip at board edges.

---

## 13. Glossary

| Term                | Meaning                                                                                 |
| ------------------- | --------------------------------------------------------------------------------------- |
| **Chesskers**       | This project's hybrid chess/checkers game                                               |
| **Hop lock**        | `checkersHopPosition` state during a multi-jump checkers turn                           |
| **SerializedBoard** | Versioned JSON wire format for game state ([§5.1](#51-serializedboard-schemaversion-1)) |
| **Side to move**    | White on odd `totalTurns`, black on even — unless hop lock active                       |
| **Fixture**         | Golden JSON test case exported from Vitest ([§8](#8-fixture-format))                    |
| **OUR / OPPONENT**  | TS enum names for white (`"w"`) and black (`"b"`)                                       |
| **encoder_v1**      | 16-plane 8×8 tensor layout for NN input ([§5.4](#54-nn-input-encoding-encoder_v1))      |
| **Shard**           | NPZ file of training positions written by self-play                                     |
| **Promotion**       | Pawn reaching back rank; requires explicit piece-type choice                            |

---

## Document history

| Date       | Change                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------- |
| 2026-07-06 | Initial ground truth — UI / Rust engine / Python training architecture, milestone checklist, shared contracts |
| 2026-07-08 | T1-6: expanded Stage B workflow, fixed eval suite spec, NPZ shard contract (§5.7) |
| 2026-07-08 | T1-7: `promote.py` iterative loop, `eval-promotion` CLI, `promotion_win_rate` API |
