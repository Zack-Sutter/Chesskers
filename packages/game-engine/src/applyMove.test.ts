import { describe, expect, it } from "vitest";
import { applyMove } from "./applyMove";
import { Board } from "./models/Board";
import { Piece } from "./models/Piece";
import { Position } from "./models/Position";
import { PieceType, TeamType } from "./Types";

describe("applyMove", () => {
  it("rejects a move on the wrong turn", () => {
    const pawn = new Piece(
      new Position(0, 1),
      PieceType.PAWN,
      TeamType.OUR,
      false
    );
    const board = new Board([pawn], 2);
    board.calculateAllMoves();

    const result = applyMove(board, { from: { x: 0, y: 1 }, to: { x: 0, y: 2 } });

    expect(result.ok).toBe(false);
    expect(board.totalTurns).toBe(2);
  });

  it("keeps the turn during a checkers hop chain", () => {
    const checkers = new Piece(
      new Position(4, 6),
      PieceType.CHECKERS,
      TeamType.OPPONENT,
      false
    );
    const pawnA = new Piece(
      new Position(3, 5),
      PieceType.PAWN,
      TeamType.OUR,
      false
    );
    const pawnB = new Piece(
      new Position(3, 3),
      PieceType.PAWN,
      TeamType.OUR,
      false
    );
    const king = new Piece(
      new Position(7, 7),
      PieceType.KING,
      TeamType.OUR,
      false
    );
    const board = new Board([checkers, pawnA, pawnB, king], 2);
    board.calculateAllMoves();

    const first = applyMove(board, { from: { x: 4, y: 6 }, to: { x: 2, y: 4 } });

    expect(first.ok).toBe(true);
    expect(first.board.totalTurns).toBe(2);
    expect(first.board.checkersHopPosition?.samePosition(new Position(2, 4))).toBe(
      true
    );
  });

  it("sets pendingPromotion when a pawn reaches the back rank", () => {
    const pawn = new Piece(
      new Position(0, 6),
      PieceType.PAWN,
      TeamType.OUR,
      true
    );
    const king = new Piece(
      new Position(7, 7),
      PieceType.KING,
      TeamType.OUR,
      false
    );
    const checkers = new Piece(
      new Position(3, 6),
      PieceType.CHECKERS,
      TeamType.OPPONENT,
      false
    );
    const board = new Board([pawn, king, checkers], 1);
    board.calculateAllMoves();

    const result = applyMove(board, { from: { x: 0, y: 6 }, to: { x: 0, y: 7 } });

    expect(result.ok).toBe(true);
    expect(result.pendingPromotion).toEqual({
      x: 0,
      y: 7,
      team: TeamType.OUR,
    });
  });
});
