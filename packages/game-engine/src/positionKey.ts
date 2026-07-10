import { Board } from "./models/Board";
import { Pawn } from "./models/Pawn";
import { Piece } from "./models/Piece";

function pieceKey(piece: Piece): string {
  const enPassant = piece.isPawn && (piece as Pawn).enPassant ? "1" : "0";
  return `${piece.position.x},${piece.position.y}:${piece.type}:${piece.team}:${piece.hasMoved ? "1" : "0"}:${enPassant}`;
}

export function positionKey(board: Board): string {
  const pieces = board.pieces.map(pieceKey).sort();
  const hop = board.checkersHopPosition
    ? `${board.checkersHopPosition.x},${board.checkersHopPosition.y}`
    : "";
  return JSON.stringify({ pieces, sideToMove: board.sideToMove, hop });
}

export function initPositionTracking(board: Board): Board {
  board.positionCounts = new Map();
  board.positionCounts.set(positionKey(board), 1);
  board.isDraw = undefined;
  return board;
}

export function recordPosition(board: Board): void {
  if (board.winningTeam !== undefined || board.isDraw) {
    return;
  }
  if (!board.positionCounts) {
    initPositionTracking(board);
    return;
  }
  const key = positionKey(board);
  const count = (board.positionCounts.get(key) ?? 0) + 1;
  board.positionCounts.set(key, count);
  if (count >= 3) {
    board.isDraw = true;
  }
}

export function isTerminalBoard(board: Board): boolean {
  return board.winningTeam !== undefined || board.isDraw === true;
}
