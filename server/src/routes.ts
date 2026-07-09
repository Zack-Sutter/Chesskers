import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import {
  initialBoard,
  serializeBoard,
  TeamType,
  type Board,
  type PendingPromotion,
} from "game-engine";

export interface EngineConfig {
  color: TeamType;
  model: string;
  thinkMs: number;
  depth?: number;
}

export interface GameRoom {
  id: string;
  board: Board;
  whiteSocket?: WebSocket;
  blackSocket?: WebSocket;
  whiteToken?: string;
  blackToken?: string;
  pendingPromotion?: PendingPromotion;
  engine?: EngineConfig;
  engineBusy?: boolean;
  createdAt: number;
}

// ponytail: in-memory only — lost on redeploy
export const rooms = new Map<string, GameRoom>();

const DEFAULT_THINK_MS = 2000;
const DEFAULT_DEPTH = 4;

export async function registerRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({ ok: true }));

  app.post("/games", async () => {
    const gameId = randomUUID();
    const board = initialBoard.clone();
    const initialState = serializeBoard(board);
    rooms.set(gameId, { id: gameId, board, createdAt: Date.now() });
    return { gameId, initialState };
  });

  app.post<{
    Params: { id: string };
    Body: { engineColor?: string; model?: string; thinkMs?: number; depth?: number };
  }>("/games/:id/engine", async (req, reply) => {
    const room = rooms.get(req.params.id);
    if (!room) return reply.code(404).send({ error: "Game not found" });

    const { engineColor, model, thinkMs, depth } = req.body ?? {};
    if (engineColor !== TeamType.OUR && engineColor !== TeamType.OPPONENT) {
      return reply.code(400).send({ error: "engineColor must be 'w' or 'b'" });
    }

    const resolvedThinkMs = thinkMs ?? DEFAULT_THINK_MS;
    if (!Number.isInteger(resolvedThinkMs) || resolvedThinkMs < 1) {
      return reply.code(400).send({ error: "thinkMs must be a positive integer" });
    }

    const resolvedDepth = depth ?? DEFAULT_DEPTH;
    if (!Number.isInteger(resolvedDepth) || resolvedDepth < 1) {
      return reply.code(400).send({ error: "depth must be a positive integer" });
    }

    const resolvedModel = model ?? process.env.MODEL_PATH;
    if (!resolvedModel) {
      return reply
        .code(400)
        .send({ error: "model required (body.model or MODEL_PATH env)" });
    }

    room.engine = {
      color: engineColor,
      model: resolvedModel,
      thinkMs: resolvedThinkMs,
      depth: resolvedDepth,
    };
    return {
      engineColor,
      model: resolvedModel,
      thinkMs: room.engine.thinkMs,
      depth: room.engine.depth,
    };
  });
}
