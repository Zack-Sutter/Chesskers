import { describe, expect, it } from "vitest";
import { Board } from "./models/Board";
import { Piece } from "./models/Piece";
import { Position } from "./models/Position";
import {
  initPositionTracking,
  isTerminalBoard,
  positionKey,
  recordPosition,
} from "./positionKey";
import { deserializeBoard, serializeBoard } from "./serialization";
import { PieceType, TeamType } from "./Types";

function makeBoard(
  pieces: Piece[],
  totalTurns: number,
  hop?: Position
): Board {
  const board = new Board(pieces, totalTurns);
  if (hop) {
    board.checkersHopPosition = hop;
  }
  return board;
}

describe("positionKey", () => {
  it("is stable across piece order", () => {
    const a = makeBoard(
      [
        new Piece(new Position(0, 0), PieceType.KING, TeamType.OUR, false),
        new Piece(new Position(3, 6), PieceType.CHECKERS, TeamType.OPPONENT, false),
      ],
      1
    );
    const b = makeBoard(
      [
        new Piece(new Position(3, 6), PieceType.CHECKERS, TeamType.OPPONENT, false),
        new Piece(new Position(0, 0), PieceType.KING, TeamType.OUR, false),
      ],
      1
    );
    expect(positionKey(a)).toBe(positionKey(b));
  });

  it("distinguishes hop lock from same pieces without hop", () => {
    const withoutHop = makeBoard(
      [new Piece(new Position(3, 6), PieceType.CHECKERS, TeamType.OPPONENT, false)],
      3
    );
    const withHop = makeBoard(
      [new Piece(new Position(3, 6), PieceType.CHECKERS, TeamType.OPPONENT, false)],
      3,
      new Position(3, 6)
    );
    expect(positionKey(withoutHop)).not.toBe(positionKey(withHop));
  });
});

describe("recordPosition", () => {
  it("declares draw on the 3rd identical position", () => {
    const board = initPositionTracking(
      makeBoard(
        [new Piece(new Position(4, 0), PieceType.KING, TeamType.OUR, false)],
        1
      )
    );
    const key = positionKey(board);

    recordPosition(board);
    expect(board.isDraw).toBeUndefined();
    expect(board.positionCounts!.get(key)).toBe(2);

    recordPosition(board);
    expect(board.isDraw).toBe(true);
    expect(board.positionCounts!.get(key)).toBe(3);
    expect(isTerminalBoard(board)).toBe(true);
  });

  it("does not record when already terminal by win", () => {
    const board = initPositionTracking(
      makeBoard(
        [new Piece(new Position(4, 0), PieceType.KING, TeamType.OUR, false)],
        1
      )
    );
    board.winningTeam = TeamType.OUR;
    recordPosition(board);
    expect(board.positionCounts!.size).toBe(1);
    expect(board.isDraw).toBeUndefined();
  });

  it("does not overwrite draw once set", () => {
    const board = initPositionTracking(
      makeBoard(
        [new Piece(new Position(4, 0), PieceType.KING, TeamType.OUR, false)],
        1
      )
    );
    board.isDraw = true;
    recordPosition(board);
    expect(board.positionCounts!.size).toBe(1);
  });
});

describe("initPositionTracking", () => {
  it("seeds the starting position at count 1", () => {
    const board = makeBoard(
      [new Piece(new Position(4, 0), PieceType.KING, TeamType.OUR, false)],
      1
    );
    initPositionTracking(board);
    expect(board.positionCounts!.get(positionKey(board))).toBe(1);
  });
});

describe("serializeBoard isDraw", () => {
  it("round-trips isDraw", () => {
    const board = makeBoard(
      [new Piece(new Position(4, 0), PieceType.KING, TeamType.OUR, false)],
      1
    );
    board.isDraw = true;
    const restored = deserializeBoard(serializeBoard(board));
    expect(restored.isDraw).toBe(true);
    expect(restored.positionCounts).toBeUndefined();
  });
});
