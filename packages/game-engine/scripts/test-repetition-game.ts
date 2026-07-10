/**
 * Designed test game: threefold repetition via the kings-shuffle line.
 *
 * Opening line (from compact start):
 *   1. wKe1-g1   (4,0)->(5,0)
 *   2. bKe8-e7   (4,7)->(4,6)
 *   3. wKg1-e1   (5,0)->(4,0)
 * lands on the same keyed position each time the line is played from the start.
 *
 * Run: npx tsx scripts/test-repetition-game.ts
 */
import { applyMove } from "../src/applyMove";
import { Board } from "../src/models/Board";
import { Piece } from "../src/models/Piece";
import { Position } from "../src/models/Position";
import {
  initPositionTracking,
  isTerminalBoard,
  positionKey,
} from "../src/positionKey";
import { PieceType, TeamType } from "../src/Types";

const OPENING: { from: [number, number]; to: [number, number]; label: string }[] = [
  { from: [4, 0], to: [5, 0], label: "wKe1-g1" },
  { from: [4, 7], to: [4, 6], label: "bKe8-e7" },
  { from: [5, 0], to: [4, 0], label: "wKg1-e1" },
];

function startBoard(): Board {
  const b = new Board(
    [
      new Piece(new Position(4, 0), PieceType.KING, TeamType.OUR, false),
      new Piece(new Position(4, 7), PieceType.KING, TeamType.OPPONENT, false),
      new Piece(new Position(0, 6), PieceType.CHECKERS, TeamType.OPPONENT, false),
      new Piece(new Position(7, 6), PieceType.CHECKERS, TeamType.OPPONENT, false),
    ],
    1
  );
  b.calculateAllMoves();
  return b;
}

function playLine(board: Board, cycle: number): Board {
  let current = board;
  for (const [i, mv] of OPENING.entries()) {
    const result = applyMove(current, {
      from: { x: mv.from[0], y: mv.from[1] },
      to: { x: mv.to[0], y: mv.to[1] },
    });
    if (!result.ok || result.pendingPromotion) {
      throw new Error(`cycle ${cycle} move ${i + 1} (${mv.label}) failed`);
    }
    current = result.board;
    const key = positionKey(current);
    const count = current.positionCounts?.get(key) ?? 0;
    console.log(
      `  cycle ${cycle} ply ${i + 1} ${mv.label}: t=${current.totalTurns} keyCount=${count} draw=${!!current.isDraw}`
    );
    if (isTerminalBoard(current)) return current;
  }
  return current;
}

function describe(board: Board): string {
  const wk = board.pieces.find((p) => p.isKing && p.team === TeamType.OUR);
  const bk = board.pieces.find((p) => p.isKing && p.team === TeamType.OPPONENT);
  return `t=${board.totalTurns} wK=(${wk?.position.x},${wk?.position.y}) bK=(${bk?.position.x},${bk?.position.y})`;
}

function main(): void {
  console.log("=== Repetition draw test game ===\n");
  console.log("Start:", describe(startBoard()));

  let board = initPositionTracking(startBoard());
  const targetKey = positionKey(
    (() => {
      let b = startBoard();
      for (const mv of OPENING) {
        b = applyMove(b, {
          from: { x: mv.from[0], y: mv.from[1] },
          to: { x: mv.to[0], y: mv.to[1] },
        }).board;
      }
      return b;
    })()
  );
  console.log(
    `Tracking started; target end-of-line key count: 1 (t=4 kings shuffle)\n`
  );

  for (let cycle = 1; cycle <= 3; cycle++) {
    console.log(`-- Cycle ${cycle} --`);
    if (cycle > 1) {
      // New timeline from start, same repetition memory (one game, three visits).
      const counts = board.positionCounts!;
      board = startBoard();
      board.positionCounts = new Map(counts);
      board.isDraw = false;
      board.calculateAllMoves();
    }
    board = playLine(board, cycle);
    console.log(`  end: ${describe(board)} targetKeyCount=${board.positionCounts!.get(targetKey)}\n`);
    if (board.isDraw) break;
  }

  if (!board.isDraw) {
    throw new Error("expected draw after 3rd repetition");
  }
  console.log("PASS: Draw declared — position repeated three times.");
}

main();
