import { Board } from "./models/Board";
import { Pawn } from "./models/Pawn";
import { Piece } from "./models/Piece";
import { Position } from "./models/Position";
import { PieceType, SerializedBoard, SerializedPiece } from "./Types";

function serializePiece(piece: Piece): SerializedPiece {
  const serialized: SerializedPiece = {
    x: piece.position.x,
    y: piece.position.y,
    type: piece.type,
    team: piece.team,
    hasMoved: piece.hasMoved,
  };
  if (piece.isPawn && (piece as Pawn).enPassant) {
    serialized.enPassant = true;
  }
  return serialized;
}

function deserializePiece(data: SerializedPiece): Piece {
  const position = new Position(data.x, data.y);
  if (data.type === PieceType.PAWN) {
    return new Pawn(position, data.team, data.hasMoved, data.enPassant);
  }
  return new Piece(position, data.type, data.team, data.hasMoved);
}

export function serializeBoard(board: Board): SerializedBoard {
  const serialized: SerializedBoard = {
    schemaVersion: 1,
    pieces: board.pieces.map(serializePiece),
    totalTurns: board.totalTurns,
  };
  if (board.checkersHopPosition) {
    serialized.checkersHopPosition = {
      x: board.checkersHopPosition.x,
      y: board.checkersHopPosition.y,
    };
  }
  if (board.lastMove) {
    serialized.lastMove = {
      from: { x: board.lastMove.from.x, y: board.lastMove.from.y },
      to: { x: board.lastMove.to.x, y: board.lastMove.to.y },
    };
  }
  if (board.winningTeam !== undefined) {
    serialized.winningTeam = board.winningTeam;
  }
  if (board.isDraw === true) {
    serialized.isDraw = true;
  }
  return serialized;
}

export function deserializeBoard(data: SerializedBoard): Board {
  if (data.schemaVersion !== 1) {
    throw new Error(`Unsupported schemaVersion: ${data.schemaVersion}`);
  }
  const board = new Board(data.pieces.map(deserializePiece), data.totalTurns);
  if (data.checkersHopPosition) {
    board.checkersHopPosition = new Position(
      data.checkersHopPosition.x,
      data.checkersHopPosition.y
    );
  }
  if (data.lastMove) {
    board.lastMove = {
      from: new Position(data.lastMove.from.x, data.lastMove.from.y),
      to: new Position(data.lastMove.to.x, data.lastMove.to.y),
    };
  }
  if (data.winningTeam !== undefined) {
    board.winningTeam = data.winningTeam;
  }
  if (data.isDraw === true) {
    board.isDraw = true;
  }
  board.calculateAllMoves();
  return board;
}
