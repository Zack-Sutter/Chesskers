import { describe, expect, it } from "vitest";
import { initialBoard } from "./boardConstants";
import { Board } from "./models/Board";
import { Pawn } from "./models/Pawn";
import { Piece } from "./models/Piece";
import { Position } from "./models/Position";
import { deserializeBoard, serializeBoard } from "./serialization";
import { PieceType, SerializedBoard, TeamType } from "./Types";

function pieceKey(p: Piece): string {
  const enPassant = p.isPawn ? (p as Pawn).enPassant : undefined;
  return `${p.position.x},${p.position.y}:${p.type}:${p.team}:${p.hasMoved}:${enPassant ?? ""}`;
}

function expectBoardsEquivalent(a: Board, b: Board): void {
  expect(a.totalTurns).toBe(b.totalTurns);
  expect(a.winningTeam).toBe(b.winningTeam);
  expect(a.isDraw).toBe(b.isDraw);
  if (a.checkersHopPosition === undefined) {
    expect(b.checkersHopPosition).toBeUndefined();
  } else {
    expect(b.checkersHopPosition?.samePosition(a.checkersHopPosition)).toBe(true);
  }
  const aKeys = a.pieces.map(pieceKey).sort();
  const bKeys = b.pieces.map(pieceKey).sort();
  expect(aKeys).toEqual(bKeys);
}

describe("serializeBoard / deserializeBoard", () => {
  it("serializes initialBoard per schema v1", () => {
    const data = serializeBoard(initialBoard);

    expect(data).toEqual({
      schemaVersion: 1,
      totalTurns: 1,
      pieces: [
        { x: 3, y: 6, type: "checkers", team: "b", hasMoved: false },
        { x: 4, y: 6, type: "checkers", team: "b", hasMoved: false },
        { x: 0, y: 0, type: "rook", team: "w", hasMoved: false },
        { x: 1, y: 0, type: "knight", team: "w", hasMoved: false },
        { x: 2, y: 0, type: "bishop", team: "w", hasMoved: false },
        { x: 3, y: 0, type: "queen", team: "w", hasMoved: false },
        { x: 4, y: 0, type: "king", team: "w", hasMoved: false },
        { x: 5, y: 0, type: "bishop", team: "w", hasMoved: false },
        { x: 6, y: 0, type: "knight", team: "w", hasMoved: false },
        { x: 7, y: 0, type: "rook", team: "w", hasMoved: false },
        { x: 0, y: 1, type: "pawn", team: "w", hasMoved: false },
        { x: 1, y: 1, type: "pawn", team: "w", hasMoved: false },
        { x: 2, y: 1, type: "pawn", team: "w", hasMoved: false },
        { x: 3, y: 1, type: "pawn", team: "w", hasMoved: false },
        { x: 4, y: 1, type: "pawn", team: "w", hasMoved: false },
        { x: 5, y: 1, type: "pawn", team: "w", hasMoved: false },
        { x: 6, y: 1, type: "pawn", team: "w", hasMoved: false },
        { x: 7, y: 1, type: "pawn", team: "w", hasMoved: false },
      ],
    });
    expect(data.checkersHopPosition).toBeUndefined();
    expect(data.winningTeam).toBeUndefined();
    expect(data.pieces.every((p) => !("enPassant" in p))).toBe(true);
  });

  it("excludes possibleMoves and image from wire format", () => {
    const data = serializeBoard(initialBoard);
    const json = JSON.stringify(data);
    expect(json).not.toMatch(/possibleMoves|image/);
  });

  it("round-trips initialBoard", () => {
    const restored = deserializeBoard(serializeBoard(initialBoard));
    expectBoardsEquivalent(initialBoard, restored);
  });

  it("round-trips en passant and hop lock", () => {
    const board = new Board(
      [
        new Pawn(new Position(4, 4), TeamType.OUR, true, true),
        new Piece(new Position(4, 0), PieceType.KING, TeamType.OUR, false),
        new Piece(new Position(3, 6), PieceType.CHECKERS, TeamType.OPPONENT, false),
        new Piece(new Position(4, 6), PieceType.CHECKERS, TeamType.OPPONENT, false),
      ],
      5
    );
    board.checkersHopPosition = new Position(3, 6);
    board.calculateAllMoves();

    const data = serializeBoard(board);
    expect(data.pieces.find((p) => p.type === "pawn")?.enPassant).toBe(true);
    expect(data.checkersHopPosition).toEqual({ x: 3, y: 6 });

    const restored = deserializeBoard(data);
    expectBoardsEquivalent(board, restored);
    expect(restored.pieces.find((p) => p.isPawn)?.possibleMoves).toBeDefined();
  });

  it("round-trips winning team from piece state", () => {
    const board = new Board(
      [new Piece(new Position(4, 0), PieceType.KING, TeamType.OUR, false)],
      9
    );
    board.calculateAllMoves();
    expect(board.winningTeam).toBe(TeamType.OUR);

    const restored = deserializeBoard(serializeBoard(board));
    expectBoardsEquivalent(board, restored);
    expect(restored.winningTeam).toBe(TeamType.OUR);
  });

  it("round-trips isDraw", () => {
    const board = new Board(
      [new Piece(new Position(4, 0), PieceType.KING, TeamType.OUR, false)],
      1
    );
    board.isDraw = true;
    const restored = deserializeBoard(serializeBoard(board));
    expect(restored.isDraw).toBe(true);
  });

  it("is stable across serialize → deserialize → serialize", () => {
    const once = serializeBoard(initialBoard);
    const twice = serializeBoard(deserializeBoard(once));
    expect(twice).toEqual(once);
  });

  it("rejects unknown schemaVersion", () => {
    const bad = { schemaVersion: 2, pieces: [], totalTurns: 1 } as unknown as SerializedBoard;
    expect(() => deserializeBoard(bad)).toThrow(/schemaVersion/);
  });
});
