import { randomUUID } from "node:crypto";
import type { WebSocket } from "ws";
import {
  applyMove,
  applyPromotion,
  serializeBoard,
  TeamType,
  type Move,
  type PromotionChoice,
} from "game-engine";
import type { GameRoom } from "./routes.js";

type ClientMessage =
  | { type: "join"; gameId: string; playerToken?: string }
  | { type: "move"; from: { x: number; y: number }; to: { x: number; y: number } }
  | { type: "promote"; pieceType: PromotionChoice };

export type ServerMessage = Record<string, unknown>;

interface SocketMeta {
  gameId?: string;
  color?: TeamType;
}

const socketMeta = new WeakMap<WebSocket, SocketMeta>();

function send(ws: WebSocket, message: ServerMessage) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function broadcast(room: GameRoom, message: ServerMessage) {
  for (const ws of [room.whiteSocket, room.blackSocket]) {
    if (ws) send(ws, message);
  }
}

function seatColor(room: GameRoom, ws: WebSocket): TeamType | undefined {
  if (room.whiteSocket === ws) return TeamType.OUR;
  if (room.blackSocket === ws) return TeamType.OPPONENT;
  return undefined;
}

function assignSeat(
  room: GameRoom,
  ws: WebSocket,
  playerToken?: string
): TeamType | "rejected" {
  if (playerToken && playerToken === room.whiteToken) {
    room.whiteSocket = ws;
    return TeamType.OUR;
  }
  if (playerToken && playerToken === room.blackToken) {
    room.blackSocket = ws;
    return TeamType.OPPONENT;
  }
  if (!room.whiteSocket) {
    room.whiteToken = randomUUID();
    room.whiteSocket = ws;
    return TeamType.OUR;
  }
  if (!room.blackSocket) {
    room.blackToken = randomUUID();
    room.blackSocket = ws;
    return TeamType.OPPONENT;
  }
  return "rejected";
}

export function handleJoin(
  ws: WebSocket,
  room: GameRoom,
  gameId: string,
  playerToken?: string
): ServerMessage[] {
  const out: ServerMessage[] = [];
  const emit = (message: ServerMessage) => {
    out.push(message);
    send(ws, message);
  };

  const seat = assignSeat(room, ws, playerToken);
  if (seat === "rejected") {
    emit({ type: "error", message: "Game is full" });
    return out;
  }

  const token = seat === TeamType.OUR ? room.whiteToken! : room.blackToken!;
  socketMeta.set(ws, { gameId, color: seat });

  emit({
    type: "joined",
    color: seat,
    board: serializeBoard(room.board),
    playerToken: token,
  });

  const other = seat === TeamType.OUR ? room.blackSocket : room.whiteSocket;
  if (!other) {
    emit({ type: "waiting" });
  }
  return out;
}

export function handleMove(
  ws: WebSocket,
  room: GameRoom,
  move: Move
): ServerMessage[] {
  const out: ServerMessage[] = [];
  const emit = (message: ServerMessage) => {
    out.push(message);
    send(ws, message);
  };
  const emitAll = (message: ServerMessage) => {
    out.push(message);
    broadcast(room, message);
  };

  const color = seatColor(room, ws);
  if (!color) {
    emit({ type: "error", message: "Not seated in this game" });
    return out;
  }
  if (room.pendingPromotion) {
    emit({ type: "error", message: "Promotion required before next move" });
    return out;
  }

  const piece = room.board.pieces.find(
    (p) => p.position.x === move.from.x && p.position.y === move.from.y
  );
  if (!piece || piece.team !== color) {
    emit({ type: "error", message: "Cannot move that piece" });
    return out;
  }

  const result = applyMove(room.board, move);
  if (!result.ok) {
    emit({ type: "error", message: "Invalid move" });
    return out;
  }

  room.board = result.board;

  if (result.pendingPromotion) {
    room.pendingPromotion = result.pendingPromotion;
    emitAll({
      type: "promote_required",
      position: { x: result.pendingPromotion.x, y: result.pendingPromotion.y },
    });
    return out;
  }

  emitAll({ type: "state", board: serializeBoard(room.board) });

  if (room.board.winningTeam !== undefined) {
    emitAll({ type: "gameOver", winner: room.board.winningTeam });
  }
  return out;
}

export function handlePromote(
  ws: WebSocket,
  room: GameRoom,
  pieceType: PromotionChoice
): ServerMessage[] {
  const out: ServerMessage[] = [];
  const emit = (message: ServerMessage) => {
    out.push(message);
    send(ws, message);
  };
  const emitAll = (message: ServerMessage) => {
    out.push(message);
    broadcast(room, message);
  };

  const color = seatColor(room, ws);
  if (!color) {
    emit({ type: "error", message: "Not seated in this game" });
    return out;
  }
  if (!room.pendingPromotion) {
    emit({ type: "error", message: "No promotion pending" });
    return out;
  }
  if (room.pendingPromotion.team !== color) {
    emit({ type: "error", message: "Not your promotion" });
    return out;
  }

  room.board = applyPromotion(room.board, room.pendingPromotion, pieceType);
  room.pendingPromotion = undefined;

  emitAll({ type: "state", board: serializeBoard(room.board) });

  if (room.board.winningTeam !== undefined) {
    emitAll({ type: "gameOver", winner: room.board.winningTeam });
  }
  return out;
}

export function handleClientMessage(
  ws: WebSocket,
  rooms: Map<string, GameRoom>,
  msg: ClientMessage
): ServerMessage[] {
  if (msg.type === "join") {
    const room = rooms.get(msg.gameId);
    if (!room) {
      const err = { type: "error", message: "Game not found" };
      send(ws, err);
      return [err];
    }
    return handleJoin(ws, room, msg.gameId, msg.playerToken);
  }

  const meta = socketMeta.get(ws);
  if (!meta?.gameId) {
    const err = { type: "error", message: "Join a game first" };
    send(ws, err);
    return [err];
  }
  const room = rooms.get(meta.gameId);
  if (!room) {
    const err = { type: "error", message: "Game not found" };
    send(ws, err);
    return [err];
  }

  if (msg.type === "move") {
    return handleMove(ws, room, msg);
  }
  if (msg.type === "promote") {
    return handlePromote(ws, room, msg.pieceType);
  }

  const err = { type: "error", message: "Unknown message type" };
  send(ws, err);
  return [err];
}

export function attachWebSocketHandlers(
  wss: import("ws").WebSocketServer,
  rooms: Map<string, GameRoom>
) {
  wss.on("connection", (ws) => {
    ws.on("message", (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString()) as ClientMessage;
      } catch {
        send(ws, { type: "error", message: "Invalid JSON" });
        return;
      }
      handleClientMessage(ws, rooms, msg);
    });

    ws.on("close", () => {
      const meta = socketMeta.get(ws);
      if (!meta?.gameId) return;
      const room = rooms.get(meta.gameId);
      if (!room) return;
      if (room.whiteSocket === ws) room.whiteSocket = undefined;
      if (room.blackSocket === ws) room.blackSocket = undefined;
    });
  });
}
