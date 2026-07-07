import { randomUUID } from "node:crypto";
import Fastify from "fastify";
import { initialBoard, TeamType, type Board, type Move } from "game-engine";
import { describe, expect, it } from "vitest";
import { registerRoutes, rooms, type EngineConfig, type GameRoom } from "./routes.js";
import { handleEngineMove } from "./ws.js";

function makeRoom(engine?: EngineConfig): GameRoom {
  return {
    id: randomUUID(),
    board: initialBoard.clone(),
    engine,
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
      payload: { engineColor: "b", model: "engine/models/v001.onnx", thinkMs: 500 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      engineColor: "b",
      model: "engine/models/v001.onnx",
      thinkMs: 500,
    });
    expect(rooms.get(created.gameId)?.engine?.color).toBe(TeamType.OPPONENT);
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
});

describe("handleEngineMove", () => {
  it("applies the engine's move and broadcasts state", async () => {
    // engine is white so it moves first on totalTurns === 1
    const room = makeRoom({ color: TeamType.OUR, model: "m.onnx", thinkMs: 1 });
    const move: Move = { from: { x: 0, y: 1 }, to: { x: 0, y: 3 } };
    const getMove = async (_b: Board, _e: EngineConfig) => move;

    const messages = await handleEngineMove(room, getMove);

    expect(messages.some((m) => m.type === "engineThinking")).toBe(true);
    const state = messages.find((m) => m.type === "state");
    expect((state?.board as { totalTurns: number }).totalTurns).toBe(2);
    expect(room.board.totalTurns).toBe(2);
  });

  it("refuses to move when it is not the engine's turn", async () => {
    // engine is black but it is white's turn (totalTurns === 1)
    const room = makeRoom({ color: TeamType.OPPONENT, model: "m.onnx", thinkMs: 1 });
    const getMove = async () => {
      throw new Error("should not be called");
    };
    const messages = await handleEngineMove(room, getMove);
    expect(messages).toEqual([{ type: "error", message: "Not the engine's turn" }]);
    expect(room.board.totalTurns).toBe(1);
  });
});
