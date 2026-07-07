import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { initialBoard, serializeBoard, type Board } from "game-engine";

export interface GameRoom {
  id: string;
  board: Board;
  createdAt: number;
}

// ponytail: in-memory only — lost on redeploy; S1-3 adds WS seats
export const rooms = new Map<string, GameRoom>();

export async function registerRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({ ok: true }));

  app.post("/games", async () => {
    const gameId = randomUUID();
    const board = initialBoard.clone();
    const initialState = serializeBoard(board);
    rooms.set(gameId, { id: gameId, board, createdAt: Date.now() });
    return { gameId, initialState };
  });
}
