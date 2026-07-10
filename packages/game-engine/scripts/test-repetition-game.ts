/**
 * Sequential threefold repetition via a 4-ply king shuffle (no board reset).
 *
 *   wKd2-d3, bKd5-d6, wKd3-d2, bKd6-d5  → back to start key
 * Play the cycle twice; draw on the 3rd visit to the start position.
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

const CYCLE: { from: [number, number]; to: [number, number]; label: string }[] = [
  { from: [4, 2], to: [4, 3], label: "wKd2-d3" },
  { from: [4, 5], to: [4, 6], label: "bKd5-d6" },
  { from: [4, 3], to: [4, 2], label: "wKd3-d2" },
  { from: [4, 6], to: [4, 5], label: "bKd6-d5" },
];

function startBoard(): Board {
  const b = new Board(
    [
      new Piece(new Position(4, 2), PieceType.KING, TeamType.OUR, true),
      new Piece(new Position(4, 5), PieceType.KING, TeamType.OPPONENT, true),
      new Piece(new Position(0, 6), PieceType.CHECKERS, TeamType.OPPONENT, false),
      new Piece(new Position(7, 6), PieceType.CHECKERS, TeamType.OPPONENT, false),
    ],
    21
  );
  b.calculateAllMoves();
  return b;
}

function describe(board: Board): string {
  const wk = board.pieces.find((p) => p.isKing && p.team === TeamType.OUR);
  const bk = board.pieces.find((p) => p.isKing && p.team === TeamType.OPPONENT);
  return `t=${board.totalTurns} wK=(${wk?.position.x},${wk?.position.y}) bK=(${bk?.position.x},${bk?.position.y})`;
}

function playCycle(board: Board, cycle: number): Board {
  let current = board;
  for (const [i, mv] of CYCLE.entries()) {
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
      `  cycle ${cycle} ply ${i + 1} ${mv.label}: ${describe(current)} keyCount=${count} draw=${!!current.isDraw}`
    );
    if (isTerminalBoard(current)) return current;
  }
  return current;
}

function main(): void {
  console.log("=== Repetition draw test game ===\n");
  const start = startBoard();
  console.log("Start:", describe(start));

  let board = initPositionTracking(start);
  const startKey = positionKey(board);
  console.log(`Start key count: ${board.positionCounts!.get(startKey)}\n`);

  for (let cycle = 1; cycle <= 2; cycle++) {
    console.log(`-- Cycle ${cycle} --`);
    board = playCycle(board, cycle);
    const count = board.positionCounts!.get(startKey) ?? 0;
    console.log(`  end: ${describe(board)} startKeyCount=${count}\n`);
    if (board.isDraw) break;
  }

  if (positionKey(board) !== startKey) {
    throw new Error("final position key does not match start");
  }
  if (!board.isDraw) {
    throw new Error("expected draw after 3rd visit to start position");
  }
  console.log("PASS: Draw declared — position repeated three times.");
}

main();
