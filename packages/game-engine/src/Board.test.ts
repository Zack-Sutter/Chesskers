import { describe, expect, it } from "vitest";
import { initialBoard } from "./boardConstants";
import { Board } from "./models/Board";
import { Piece } from "./models/Piece";
import { Position } from "./models/Position";
import {
  getKingStepMoves,
  getPossibleCheckersMoves,
  getSingleJumpMoves,
  isCheckersJump,
} from "./rules";
import { PieceType, TeamType } from "./Types";

describe("Board", () => {
  it("allows a single checkers hop and removes the jumped piece", () => {
    const checkers = new Piece(
      new Position(4, 6),
      PieceType.CHECKERS,
      TeamType.OPPONENT,
      false
    );
    const pawn = new Piece(
      new Position(3, 5),
      PieceType.PAWN,
      TeamType.OUR,
      false
    );
    const board = new Board([checkers, pawn], 2);

    const jumps = getSingleJumpMoves(checkers, board.pieces);
    expect(jumps.some((m) => m.samePosition(new Position(2, 4)))).toBe(true);

    const jumped = isCheckersJump(
      checkers.position,
      new Position(2, 4),
      board.pieces,
      TeamType.OPPONENT
    );
    expect(jumped).toBe(true);

    board.playMove(false, true, checkers, new Position(2, 4));

    expect(board.pieces.some((p) => p.isPawn)).toBe(false);
    expect(
      board.pieces.find((p) => p.isCheckers)?.samePosition(new Position(2, 4))
    ).toBe(true);
  });

  it("allows an orthogonal checkers hop and removes the jumped piece", () => {
    const checkers = new Piece(
      new Position(3, 4),
      PieceType.CHECKERS,
      TeamType.OPPONENT,
      false
    );
    const pawn = new Piece(
      new Position(3, 3),
      PieceType.PAWN,
      TeamType.OUR,
      false
    );
    const board = new Board([checkers, pawn], 2);

    expect(
      isCheckersJump(
        checkers.position,
        new Position(3, 2),
        board.pieces,
        TeamType.OPPONENT
      )
    ).toBe(true);

    board.playMove(false, true, checkers, new Position(3, 2));

    expect(board.pieces.some((p) => p.isPawn)).toBe(false);
    expect(
      board.pieces.find((p) => p.isCheckers)?.samePosition(new Position(3, 2))
    ).toBe(true);
  });

  it("does not allow adjacent capture for checkers king-steps", () => {
    const checkers = new Piece(
      new Position(3, 6),
      PieceType.CHECKERS,
      TeamType.OPPONENT,
      false
    );
    const pawn = new Piece(
      new Position(4, 7),
      PieceType.PAWN,
      TeamType.OUR,
      false
    );
    const board = new Board([checkers, pawn], 2);

    const steps = getKingStepMoves(checkers, board.pieces);
    const moves = getPossibleCheckersMoves(checkers, board.pieces, false);

    expect(steps.some((m) => m.samePosition(new Position(4, 7)))).toBe(false);
    expect(moves.some((m) => m.samePosition(new Position(4, 7)))).toBe(false);
  });

  it("exposes only jump moves during hop continuation", () => {
    const movedCheckers = new Piece(
      new Position(2, 4),
      PieceType.CHECKERS,
      TeamType.OPPONENT,
      true
    );
    const checkersB = new Piece(
      new Position(0, 6),
      PieceType.CHECKERS,
      TeamType.OPPONENT,
      false
    );
    const pawnC = new Piece(
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
    const continuationBoard = new Board(
      [movedCheckers, checkersB, pawnC, king],
      2
    );
    continuationBoard.checkersHopPosition = new Position(2, 4);
    continuationBoard.calculateAllMoves();

    const active = continuationBoard.pieces.find((p) =>
      p.samePosition(new Position(2, 4))
    )!;
    const idle = continuationBoard.pieces.find((p) =>
      p.samePosition(new Position(0, 6))
    )!;

    expect(idle.possibleMoves).toEqual([]);
    expect(active.possibleMoves?.some((m) => m.samePosition(new Position(4, 2)))).toBe(
      true
    );
    expect(
      getKingStepMoves(active, continuationBoard.pieces).some((m) =>
        m.samePosition(new Position(3, 5))
      )
    ).toBe(true);
    expect(
      active.possibleMoves?.some((m) => m.samePosition(new Position(3, 5)))
    ).toBe(false);
  });

  it("calculateAllMoves survives black turn with no opponent king", () => {
    const board = initialBoard.clone();
    board.totalTurns = 2;
    expect(() => board.calculateAllMoves()).not.toThrow();
    expect(board.pieces.filter((p) => p.isCheckers).length).toBe(2);
  });

  it("declares white the winner when both checkers are captured", () => {
    const board = new Board(
      [new Piece(new Position(4, 0), PieceType.KING, TeamType.OUR, false)],
      1
    );

    board.calculateAllMoves();

    expect(board.winningTeam).toBe(TeamType.OUR);
  });

  it("declares black the winner when white king is hopped", () => {
    const checkers = new Piece(
      new Position(4, 6),
      PieceType.CHECKERS,
      TeamType.OPPONENT,
      false
    );
    const king = new Piece(
      new Position(3, 5),
      PieceType.KING,
      TeamType.OUR,
      false
    );
    const board = new Board([checkers, king], 2);

    board.playMove(false, true, checkers, new Position(2, 4));

    expect(board.pieces.some((p) => p.isKing)).toBe(false);
    expect(board.winningTeam).toBe(TeamType.OPPONENT);
  });

  it("allows a wrapped checkers step across the left edge", () => {
    const checkers = new Piece(
      new Position(0, 3),
      PieceType.CHECKERS,
      TeamType.OPPONENT,
      false
    );
    const board = new Board([checkers], 2);

    const steps = getKingStepMoves(checkers, board.pieces);
    expect(steps.some((m) => m.samePosition(new Position(7, 3)))).toBe(true);
  });

  it("allows a wrapped orthogonal checkers hop across the left edge", () => {
    const checkers = new Piece(
      new Position(0, 3),
      PieceType.CHECKERS,
      TeamType.OPPONENT,
      false
    );
    const pawn = new Piece(
      new Position(7, 3),
      PieceType.PAWN,
      TeamType.OUR,
      false
    );
    const board = new Board([checkers, pawn], 2);

    const jumps = getSingleJumpMoves(checkers, board.pieces);
    expect(jumps.some((m) => m.samePosition(new Position(6, 3)))).toBe(true);

    expect(
      isCheckersJump(
        checkers.position,
        new Position(6, 3),
        board.pieces,
        TeamType.OPPONENT
      )
    ).toBe(true);

    board.playMove(false, true, checkers, new Position(6, 3));

    expect(board.pieces.some((p) => p.isPawn)).toBe(false);
    expect(
      board.pieces.find((p) => p.isCheckers)?.samePosition(new Position(6, 3))
    ).toBe(true);
  });

  it("allows a wrapped diagonal checkers hop across a corner", () => {
    const checkers = new Piece(
      new Position(0, 0),
      PieceType.CHECKERS,
      TeamType.OPPONENT,
      false
    );
    const pawn = new Piece(
      new Position(7, 7),
      PieceType.PAWN,
      TeamType.OUR,
      false
    );
    const board = new Board([checkers, pawn], 2);

    const jumps = getSingleJumpMoves(checkers, board.pieces);
    expect(jumps.some((m) => m.samePosition(new Position(6, 6)))).toBe(true);

    expect(
      isCheckersJump(
        checkers.position,
        new Position(6, 6),
        board.pieces,
        TeamType.OPPONENT
      )
    ).toBe(true);
  });
});
