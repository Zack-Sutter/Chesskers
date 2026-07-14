import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import {
  applyMove,
  initialBoard,
  TeamType,
  type Board,
  type Move,
} from "game-engine";
import { describe, expect, it, vi } from "vitest";
import { registerRoutes, rooms, type EngineConfig, type GameRoom } from "./routes.js";
import { handleEngineMove } from "./ws.js";

function makeRoom(engines?: GameRoom["engines"]): GameRoom {
  return {
    id: randomUUID(),
    board: initialBoard.clone(),
    engines,
    createdAt: Date.now(),
  };
}

describe("POST /games/:id/engine", () => {
  it("stores engine config and echoes it back", async () => {
    rooms.clear();
    const app = Fastify();
    await registerRoutes(app);
    const created = (await app.inject({ method: "POST", url: "/games" })).json() as {
      gameId: string;
    };

    const res = await app.inject({
      method: "POST",
      url: `/games/${created.gameId}/engine`,
      payload: { engineColor: "b", model: "engine/models/v001.onnx", thinkMs: 500, depth: 3 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      engineColor: "b",
      model: "engine/models/v001.onnx",
      thinkMs: 500,
      depth: 3,
    });
    expect(rooms.get(created.gameId)?.engines?.b?.depth).toBe(3);
    expect(rooms.get(created.gameId)?.engines?.b?.model).toBe(
      "engine/models/v001.onnx"
    );
    await app.close();
  });

  it("stores both sides from a single dual-engine payload", async () => {
    rooms.clear();
    const app = Fastify();
    await registerRoutes(app);
    const created = (await app.inject({ method: "POST", url: "/games" })).json() as {
      gameId: string;
    };

    const res = await app.inject({
      method: "POST",
      url: `/games/${created.gameId}/engine`,
      payload: {
        white: { model: "engine/models/w007.onnx", thinkMs: 100, depth: 3 },
        black: { model: "engine/models/b007.onnx", thinkMs: 200 },
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      white: { model: "engine/models/w007.onnx", thinkMs: 100, depth: 3 },
      black: { model: "engine/models/b007.onnx", thinkMs: 200, depth: 4 },
    });
    const room = rooms.get(created.gameId);
    expect(room?.engines?.w).toEqual({
      model: "engine/models/w007.onnx",
      thinkMs: 100,
      depth: 3,
    });
    expect(room?.engines?.b).toEqual({
      model: "engine/models/b007.onnx",
      thinkMs: 200,
      depth: 4,
    });
    await app.close();
  });

  it("rejects mixing engineColor with white/black", async () => {
    rooms.clear();
    const app = Fastify();
    await registerRoutes(app);
    const created = (await app.inject({ method: "POST", url: "/games" })).json() as {
      gameId: string;
    };

    const res = await app.inject({
      method: "POST",
      url: `/games/${created.gameId}/engine`,
      payload: {
        engineColor: "w",
        white: { model: "w.onnx" },
        black: { model: "b.onnx" },
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({
      error: "use either engineColor or white/black, not both",
    });
    await app.close();
  });

  it("stores independent white and black engine configs", async () => {
    rooms.clear();
    const app = Fastify();
    await registerRoutes(app);
    const created = (await app.inject({ method: "POST", url: "/games" })).json() as {
      gameId: string;
    };

    await app.inject({
      method: "POST",
      url: `/games/${created.gameId}/engine`,
      payload: { engineColor: "w", model: "engine/models/w001.onnx", thinkMs: 100 },
    });
    await app.inject({
      method: "POST",
      url: `/games/${created.gameId}/engine`,
      payload: { engineColor: "b", model: "engine/models/b001.onnx", thinkMs: 200 },
    });

    const room = rooms.get(created.gameId);
    expect(room?.engines?.w).toEqual({
      model: "engine/models/w001.onnx",
      thinkMs: 100,
      depth: 4,
    });
    expect(room?.engines?.b).toEqual({
      model: "engine/models/b001.onnx",
      thinkMs: 200,
      depth: 4,
    });
    await app.close();
  });

  it("rejects an unknown game", async () => {
    const app = Fastify();
    await registerRoutes(app);
    const res = await app.inject({
      method: "POST",
      url: `/games/${randomUUID()}/engine`,
      payload: { engineColor: "b", model: "m.onnx" },
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it("falls back to per-side model env vars", async () => {
    vi.stubEnv("WHITE_MODEL_PATH", "engine/models/w007.onnx");
    vi.stubEnv("BLACK_MODEL_PATH", "engine/models/b007.onnx");
    rooms.clear();
    const app = Fastify();
    await registerRoutes(app);
    const created = (await app.inject({ method: "POST", url: "/games" })).json() as {
      gameId: string;
    };

    const whiteRes = await app.inject({
      method: "POST",
      url: `/games/${created.gameId}/engine`,
      payload: { engineColor: "w", thinkMs: 100 },
    });
    expect(whiteRes.statusCode).toBe(200);
    expect(whiteRes.json()).toEqual({
      engineColor: "w",
      model: "engine/models/w007.onnx",
      thinkMs: 100,
      depth: 4,
    });

    const blackRes = await app.inject({
      method: "POST",
      url: `/games/${created.gameId}/engine`,
      payload: { engineColor: "b", thinkMs: 200 },
    });
    expect(blackRes.statusCode).toBe(200);
    expect(blackRes.json()).toEqual({
      engineColor: "b",
      model: "engine/models/b007.onnx",
      thinkMs: 200,
      depth: 4,
    });
    await app.close();
    vi.unstubAllEnvs();
  });

  it("falls back to MODEL_PATH for black when BLACK_MODEL_PATH is unset", async () => {
    vi.stubEnv("MODEL_PATH", "engine/models/v007.onnx");
    rooms.clear();
    const app = Fastify();
    await registerRoutes(app);
    const created = (await app.inject({ method: "POST", url: "/games" })).json() as {
      gameId: string;
    };

    const res = await app.inject({
      method: "POST",
      url: `/games/${created.gameId}/engine`,
      payload: { engineColor: "b", thinkMs: 500 },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      engineColor: "b",
      model: "engine/models/v007.onnx",
      thinkMs: 500,
      depth: 4,
    });
    await app.close();
    vi.unstubAllEnvs();
  });
});

describe("handleEngineMove", () => {
  it("routes white-only config when it is white's turn", async () => {
    const room = makeRoom({ w: { model: "w.onnx", thinkMs: 1 } });
    const move: Move = { from: { x: 0, y: 1 }, to: { x: 0, y: 3 } };
    const modelsUsed: string[] = [];
    const getMove = async (board: Board, engine: EngineConfig) => {
      modelsUsed.push(engine.model);
      expect(board.sideToMove).toBe(TeamType.OUR);
      return move;
    };

    const messages = await handleEngineMove(room, getMove);

    expect(modelsUsed).toEqual(["w.onnx"]);
    expect(messages.some((m) => m.type === "engineThinking")).toBe(true);
    const state = messages.find((m) => m.type === "state");
    expect((state?.board as { totalTurns: number }).totalTurns).toBe(2);
    expect(room.board.totalTurns).toBe(2);
  });

  it("refuses to move when it is not the engine's turn (black-only)", async () => {
    const room = makeRoom({ b: { model: "b.onnx", thinkMs: 1 } });
    const getMove = async () => {
      throw new Error("should not be called");
    };
    const messages = await handleEngineMove(room, getMove);
    expect(messages).toEqual([{ type: "error", message: "Not the engine's turn" }]);
    expect(room.board.totalTurns).toBe(1);
  });

  it("refuses to move when it is not the engine's turn (white-only)", async () => {
    const whiteMove: Move = { from: { x: 0, y: 1 }, to: { x: 0, y: 3 } };
    const room = makeRoom({ w: { model: "w.onnx", thinkMs: 1 } });
    const afterWhite = applyMove(room.board, whiteMove);
    expect(afterWhite.ok).toBe(true);
    room.board = afterWhite.board;
    expect(room.board.sideToMove).toBe(TeamType.OPPONENT);

    const getMove = async () => {
      throw new Error("should not be called");
    };
    const messages = await handleEngineMove(room, getMove);
    expect(messages).toEqual([{ type: "error", message: "Not the engine's turn" }]);
    expect(room.board.totalTurns).toBe(2);
  });

  it("routes black-only config when it is black's turn", async () => {
    const whiteMove: Move = { from: { x: 0, y: 1 }, to: { x: 0, y: 3 } };
    const room = makeRoom({ b: { model: "b.onnx", thinkMs: 1 } });
    const afterWhite = applyMove(room.board, whiteMove);
    expect(afterWhite.ok).toBe(true);
    room.board = afterWhite.board;
    expect(room.board.sideToMove).toBe(TeamType.OPPONENT);

    const checker = room.board.pieces.find(
      (p) => p.team === TeamType.OPPONENT && p.possibleMoves.length > 0
    );
    expect(checker).toBeDefined();
    const dest = checker!.possibleMoves[0];
    const blackMove: Move = {
      from: { x: checker!.position.x, y: checker!.position.y },
      to: { x: dest.x, y: dest.y },
    };

    const modelsUsed: string[] = [];
    const getMove = async (_board: Board, engine: EngineConfig) => {
      modelsUsed.push(engine.model);
      return blackMove;
    };

    const messages = await handleEngineMove(room, getMove);
    expect(modelsUsed).toEqual(["b.onnx"]);
    expect(room.board.totalTurns).toBe(3);
    expect(messages.some((m) => m.type === "state")).toBe(true);
  });

  it("routes each ply to the side engine matching sideToMove", async () => {
    const room = makeRoom({
      w: { model: "w.onnx", thinkMs: 1 },
      b: { model: "b.onnx", thinkMs: 1 },
    });
    const whiteMove: Move = { from: { x: 0, y: 1 }, to: { x: 0, y: 3 } };
    const afterWhite = applyMove(initialBoard.clone(), whiteMove);
    expect(afterWhite.ok).toBe(true);
    const checker = afterWhite.board.pieces.find(
      (p) => p.team === TeamType.OPPONENT && p.possibleMoves.length > 0
    );
    expect(checker).toBeDefined();
    const dest = checker!.possibleMoves[0];
    const blackMove: Move = {
      from: { x: checker!.position.x, y: checker!.position.y },
      to: { x: dest.x, y: dest.y },
    };

    const modelsUsed: string[] = [];
    const getMove = async (board: Board, engine: EngineConfig) => {
      modelsUsed.push(engine.model);
      if (modelsUsed.length === 1) {
        expect(board.sideToMove).toBe(TeamType.OUR);
        return whiteMove;
      }
      expect(board.sideToMove).toBe(TeamType.OPPONENT);
      delete room.engines!.w;
      delete room.engines!.b;
      return blackMove;
    };

    await handleEngineMove(room, getMove);

    expect(modelsUsed).toEqual(["w.onnx", "b.onnx"]);
    expect(room.board.totalTurns).toBe(3);
  });

  it("ignores a concurrent engine request while busy", async () => {
    const room = makeRoom({ w: { model: "m.onnx", thinkMs: 1 } });
    let release!: (move: Move) => void;
    const gate = new Promise<Move>((resolve) => {
      release = resolve;
    });
    let getMoveCalls = 0;
    const getMove = async () => {
      getMoveCalls += 1;
      return gate;
    };

    const first = handleEngineMove(room, getMove);
    expect(room.engineBusy).toBe(true);

    const second = await handleEngineMove(room, getMove);
    expect(second).toEqual([]);
    expect(getMoveCalls).toBe(1);

    release({ from: { x: 0, y: 1 }, to: { x: 0, y: 3 } });
    await first;
    expect(room.engineBusy).toBe(false);
  });
});
