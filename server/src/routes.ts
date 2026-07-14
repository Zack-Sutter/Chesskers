import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { WebSocket } from "ws";
import {
  initialBoard,
  initPositionTracking,
  isTerminalBoard,
  serializeBoard,
  TeamType,
  type Board,
  type PendingPromotion,
} from "game-engine";

export interface EngineConfig {
  model: string;
  thinkMs: number;
  depth?: number;
}

export type EngineSide = "w" | "b";

export interface GameRoom {
  id: string;
  board: Board;
  whiteSocket?: WebSocket;
  blackSocket?: WebSocket;
  whiteToken?: string;
  blackToken?: string;
  pendingPromotion?: PendingPromotion;
  engines?: Partial<Record<EngineSide, EngineConfig>>;
  engineBusy?: boolean;
  createdAt: number;
}

// ponytail: in-memory only — lost on redeploy
export const rooms = new Map<string, GameRoom>();

const DEFAULT_THINK_MS = 2000;
const DEFAULT_DEPTH = 4;

export interface EngineSideInput {
  model?: string;
  thinkMs?: number;
  depth?: number;
}

type EnginePostBody = {
  engineColor?: string;
  model?: string;
  thinkMs?: number;
  depth?: number;
  white?: EngineSideInput;
  black?: EngineSideInput;
};

function resolveThinkMs(thinkMs?: number): number | string {
  const resolved = thinkMs ?? DEFAULT_THINK_MS;
  if (!Number.isInteger(resolved) || resolved < 1) {
    return "thinkMs must be a positive integer";
  }
  return resolved;
}

function resolveDepth(depth?: number): number | string {
  const resolved = depth ?? DEFAULT_DEPTH;
  if (!Number.isInteger(resolved) || resolved < 1) {
    return "depth must be a positive integer";
  }
  return resolved;
}

function resolveModel(model: string | undefined, side: EngineSide): string | null {
  if (model) return model;
  if (side === "w") return process.env.WHITE_MODEL_PATH ?? null;
  return process.env.BLACK_MODEL_PATH ?? process.env.MODEL_PATH ?? null;
}

function resolveEngineConfig(
  input: EngineSideInput,
  side: EngineSide
): EngineConfig | { error: string } {
  const thinkMs = resolveThinkMs(input.thinkMs);
  if (typeof thinkMs === "string") return { error: thinkMs };
  const depth = resolveDepth(input.depth);
  if (typeof depth === "string") return { error: depth };
  const model = resolveModel(input.model, side);
  if (!model) {
    return {
      error:
        side === "w"
          ? "model required (body.model or WHITE_MODEL_PATH env)"
          : "model required (body.model, BLACK_MODEL_PATH, or MODEL_PATH env)",
    };
  }
  return { model, thinkMs, depth };
}

function isSideInput(value: unknown): value is EngineSideInput {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDualEngineBody(body: EnginePostBody): boolean {
  return body.white !== undefined || body.black !== undefined;
}

export async function registerRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({ ok: true }));

  app.post("/games", async () => {
    const gameId = randomUUID();
    const board = initPositionTracking(initialBoard.clone());
    const initialState = serializeBoard(board);
    rooms.set(gameId, { id: gameId, board, createdAt: Date.now() });
    return { gameId, initialState };
  });

  app.post<{
    Params: { id: string };
    Body: EnginePostBody;
  }>("/games/:id/engine", async (req, reply) => {
    const room = rooms.get(req.params.id);
    if (!room) return reply.code(404).send({ error: "Game not found" });

    const body = req.body ?? {};

    if (isDualEngineBody(body)) {
      if (body.engineColor !== undefined) {
        return reply
          .code(400)
          .send({ error: "use either engineColor or white/black, not both" });
      }
      if (!isSideInput(body.white) || !isSideInput(body.black)) {
        return reply.code(400).send({ error: "white and black must be objects" });
      }

      const white = resolveEngineConfig(body.white, "w");
      if ("error" in white) return reply.code(400).send({ error: white.error });
      const black = resolveEngineConfig(body.black, "b");
      if ("error" in black) return reply.code(400).send({ error: black.error });

      room.engines = { w: white, b: black };
      return { white, black };
    }

    const { engineColor, model, thinkMs, depth } = body;
    if (engineColor !== TeamType.OUR && engineColor !== TeamType.OPPONENT) {
      return reply.code(400).send({ error: "engineColor must be 'w' or 'b'" });
    }

    const config = resolveEngineConfig({ model, thinkMs, depth }, engineColor);
    if ("error" in config) return reply.code(400).send({ error: config.error });

    if (!room.engines) room.engines = {};
    room.engines[engineColor] = config;
    return { engineColor, ...config };
  });
}
