import { describe, expect, it } from "vitest";
import { initialBoard } from "./boardConstants";
import { Board } from "./models/Board";
import { Piece } from "./models/Piece";
import { Position } from "./models/Position";
import { PieceType, TeamType } from "./Types";

describe("Board.sideToMove", () => {
  it("follows turn parity when no hop lock is active", () => {
    expect(initialBoard.totalTurns).toBe(1);
    expect(initialBoard.sideToMove).toBe(TeamType.OUR); // white on odd turns

    const black = initialBoard.clone();
    black.totalTurns = 2;
    expect(black.sideToMove).toBe(TeamType.OPPONENT); // black on even turns
  });

  it("returns the hopping piece's team during a checkers multi-hop, ignoring parity", () => {
    const checkers = new Piece(
      new Position(2, 4),
      PieceType.CHECKERS,
      TeamType.OPPONENT,
      false
    );
    // Odd turn would normally mean white to move, but the hop lock overrides it.
    const board = new Board([checkers], 1);
    board.checkersHopPosition = new Position(2, 4);

    expect(board.currentTeam).toBe(TeamType.OUR);
    expect(board.sideToMove).toBe(TeamType.OPPONENT);
  });
});
