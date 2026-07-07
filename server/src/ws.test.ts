import { randomUUID } from "node:crypto";
import { initialBoard } from "game-engine";
import { describe, expect, it } from "vitest";
import type { GameRoom } from "./routes.js";
import { handleJoin, handleMove } from "./ws.js";

function mockSocket() {
  return { readyState: 1, send: () => {}, OPEN: 1 } as import("ws").WebSocket;
}

function makeRoom(): GameRoom {
  const board = initialBoard.clone();
  return { id: randomUUID(), board, createdAt: Date.now() };
}

describe("WebSocket move pipeline", () => {
  it("white move advances turn and broadcasts state", () => {
    const room = makeRoom();
    const white = mockSocket();
    const black = mockSocket();
    room.blackSocket = black;

    handleJoin(white, room, room.id);
    const messages = handleMove(white, room, {
      from: { x: 0, y: 1 },
      to: { x: 0, y: 3 },
    });

    expect(room.board.totalTurns).toBe(2);
    expect(messages.some((m) => m.type === "state")).toBe(true);
    const state = messages.find((m) => m.type === "state");
    expect((state?.board as { totalTurns: number }).totalTurns).toBe(2);
  });

  it("rejects a move from the wrong seat", () => {
    const room = makeRoom();
    const white = mockSocket();
    const black = mockSocket();
    handleJoin(white, room, room.id);
    room.blackSocket = black;

    const messages = handleMove(black, room, {
      from: { x: 0, y: 1 },
      to: { x: 0, y: 3 },
    });

    expect(messages).toEqual([
      { type: "error", message: "Cannot move that piece" },
    ]);
    expect(room.board.totalTurns).toBe(1);
  });
});
