import Fastify from "fastify";
import { initialBoard, serializeBoard } from "game-engine";
import { describe, expect, it } from "vitest";
import { registerRoutes, rooms } from "./routes.js";

describe("POST /games", () => {
  it("returns { gameId, initialState }", async () => {
    rooms.clear();
    const app = Fastify();
    await registerRoutes(app);
    const res = await app.inject({ method: "POST", url: "/games" });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { gameId: string; initialState: unknown };
    expect(body.gameId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );
    expect(body.initialState).toEqual(serializeBoard(initialBoard));
    expect(rooms.get(body.gameId)?.board.totalTurns).toBe(1);
    await app.close();
  });
});
