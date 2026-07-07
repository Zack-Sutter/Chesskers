# game-engine

Canonical Chesskers rules, board serialization, and `applyMove`.

## Tests

```bash
npm test
```

## Golden fixtures

Rules regression cases live in `src/goldenFixtures.ts`. Vitest validates each case in `src/goldenFixtures.test.ts`; exported JSON in the repo-root `fixtures/` directory must stay in sync.

Regenerate after changing a case:

```bash
npm run export-fixtures
```

### Fixture JSON format

Each `fixtures/<name>.json` file:

| Field | Required | Description |
| ----- | -------- | ----------- |
| `name` | yes | Stable snake_case id (matches filename) |
| `board` | yes | `SerializedBoard` v1 — input position before any action. Non-terminal positions used for move generation must include a white king (black wins immediately when none is on the board). |
| `action` | no | `{ "move": { "from": {x,y}, "to": {x,y}, "promotion"?: "queen"\|"rook"\|"bishop"\|"knight" } }` |
| `expect` | yes | Assertions Rust/Python ports must satisfy |

`expect` fields (all optional; only listed keys are checked):

| Key | Meaning |
| --- | ------- |
| `winningTeam` | `"w"` or `"b"` after `calculateAllMoves` / `applyMove` |
| `pieceCount` | Piece count on the resulting board |
| `applyOk` | Whether `applyMove` succeeds (`true` / `false`) |
| `totalTurns` | Turn counter after the action (or unchanged on reject) |
| `checkersHopPosition` | `{x,y}` hop lock, or `null` if cleared |
| `pendingPromotion` | `{x,y,team}` when promotion is required, or `null` |
| `pieceAt` | `[{x,y,type}]` pieces that must exist |
| `noPieceAt` | `[{x,y}]` squares that must be empty |
| `noPieceType` | Piece type that must not remain |
| `legalMovesFrom` | `[{ from, include?, exclude?, exact? }]` — position-only cases; run `calculateAllMoves` then check moves from `from` |

**Position-only** fixtures omit `action`; consumers deserialize `board`, call move generation, and check `expect.legalMovesFrom` / `expect.winningTeam`.

**Apply-move** fixtures include `action`; consumers deserialize `board`, call `applyMove(action.move)`, then check the remaining `expect` fields.

Do not hand-edit `fixtures/*.json` without updating `goldenFixtures.ts` and re-running `npm run export-fixtures`.
