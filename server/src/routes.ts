import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import {
  initialBoard,
  serializeBoard,
  type Board,
  type PendingPromotion,
} from "game-engine";

export interface GameRoom {
  id: string;
  board: Board;
  whiteSocket?: WebSocket;
  blackSocket?: WebSocket;
  whiteToken?: string;
  blackToken?: string;
  pendingPromotion?: PendingPromotion;
  createdAt: number;
}

// ponytail: in-memory only — lost on redeploy
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
