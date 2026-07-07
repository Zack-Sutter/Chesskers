# Chesskers server

Authoritative Node (Fastify + `ws`) game server. Applies moves with the shared
`game-engine`, so clients never validate rules themselves.

## Run

```bash
npm run dev    # tsx watch
npm start      # tsx
npm test       # vitest
```

## REST

| Method | Path                | Body                                | Response                                    |
| ------ | ------------------- | ----------------------------------- | ------------------------------------------- |
| `GET`  | `/health`           | —                                   | `{ ok: true }`                              |
| `POST` | `/games`            | —                                   | `{ gameId, initialState: SerializedBoard }` |
| `POST` | `/games/:id/engine` | `{ engineColor, model?, thinkMs? }` | `{ engineColor, model, thinkMs }`           |

`POST /games/:id/engine` enables AI for a room. `engineColor` is `"w"` or `"b"`.
`model` falls back to the `MODEL_PATH` env var; `thinkMs` defaults to `2000`.

## WebSocket

See [docs/railway-vercel-migration.md §5](../docs/railway-vercel-migration.md#5-wire-protocol).
Additional message: `{ type: "requestEngineMove" }` (client → server) makes the
server run the engine for its configured color, emitting `engineThinking` then a
`state` broadcast (or `gameOver`).

## Engine integration (S1-4)

The server **spawns the Rust `chesskers-engine best-move` binary as a child
process** per engine move rather than linking the crate — Node cannot link a Rust
crate without a native addon, and a subprocess keeps the language boundary clean
(JSON over stdin/stdout, per [docs/architecture.md §6](../docs/architecture.md#6-rust-engine-cli)).

The serialized board is written to the child's stdin; the `{ "move": ... }`
response is parsed and applied via `applyMove`. A checkers multi-hop is resolved
by looping `best-move` until the engine's turn ends. If the engine move promotes
a pawn, the server auto-promotes to queen.

Ceiling: one process spawn per move. Upgrade path is a long-lived engine process
or an N-API addon.

### Environment variables

| Variable             | Purpose                                            |
| -------------------- | -------------------------------------------------- |
| `PORT`               | HTTP/WS listen port (default `3001`)               |
| `ENGINE_BINARY_PATH` | Path to the Rust binary (default `chesskers-engine`) |
| `MODEL_PATH`         | Default ONNX model when the request omits `model`  |
