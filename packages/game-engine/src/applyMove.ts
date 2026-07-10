import { Board } from "./models/Board";
import { Pawn } from "./models/Pawn";
import { Piece } from "./models/Piece";
import { Position } from "./models/Position";
import { recordPosition } from "./positionKey";
import { getSingleJumpMoves, isCheckersJump } from "./rules";
import {
  Move,
  PendingPromotion,
  PieceType,
  PromotionChoice,
  TeamType,
} from "./Types";

export interface ApplyMoveResult {
  ok: boolean;
  board: Board;
  pendingPromotion?: PendingPromotion;
  isCapture?: boolean;
}

const PROMOTION_TO_PIECE: Record<PromotionChoice, PieceType> = {
  queen: PieceType.QUEEN,
  rook: PieceType.ROOK,
  bishop: PieceType.BISHOP,
  knight: PieceType.KNIGHT,
};

function isEnPassantMove(
  board: Board,
  initialPosition: Position,
  desiredPosition: Position,
  type: PieceType,
  team: TeamType
): boolean {
  const pawnDirection = team === TeamType.OUR ? 1 : -1;

  if (type !== PieceType.PAWN) {
    return false;
  }

  if (
    (desiredPosition.x - initialPosition.x === -1 ||
      desiredPosition.x - initialPosition.x === 1) &&
    desiredPosition.y - initialPosition.y === pawnDirection
  ) {
    const piece = board.pieces.find(
      (p) =>
        p.position.x === desiredPosition.x &&
        p.position.y === desiredPosition.y - pawnDirection &&
        p.isPawn &&
        (p as Pawn).enPassant
    );
    return piece !== undefined;
  }

  return false;
}

function applyPromotionChoice(
  board: Board,
  position: Position,
  promotion: PromotionChoice
): void {
  const pieceType = PROMOTION_TO_PIECE[promotion];
  board.pieces = board.pieces.map((piece) =>
    piece.samePosition(position)
      ? new Piece(piece.position.clone(), pieceType, piece.team, true)
      : piece
  );
}

export function applyPromotion(
  board: Board,
  pending: PendingPromotion,
  choice: PromotionChoice
): Board {
  const nextBoard = board.clone();
  applyPromotionChoice(
    nextBoard,
    new Position(pending.x, pending.y),
    choice
  );
  nextBoard.calculateAllMoves();
  recordPosition(nextBoard);
  return nextBoard;
}

export function applyMove(board: Board, move: Move): ApplyMoveResult {
  const nextBoard = board.clone();
  const destination = new Position(move.to.x, move.to.y);

  const playedPiece = nextBoard.pieces.find(
    (p) => p.position.x === move.from.x && p.position.y === move.from.y
  );

  if (playedPiece === undefined) {
    return { ok: false, board: nextBoard };
  }

  if (nextBoard.checkersHopPosition) {
    if (!playedPiece.samePosition(nextBoard.checkersHopPosition)) {
      return { ok: false, board: nextBoard };
    }
  } else if (
    playedPiece.team === TeamType.OUR &&
    nextBoard.totalTurns % 2 !== 1
  ) {
    return { ok: false, board: nextBoard };
  } else if (
    playedPiece.team === TeamType.OPPONENT &&
    nextBoard.totalTurns % 2 !== 0
  ) {
    return { ok: false, board: nextBoard };
  }

  if (playedPiece.possibleMoves === undefined) {
    return { ok: false, board: nextBoard };
  }

  const validMove = playedPiece.possibleMoves.some((m) =>
    m.samePosition(destination)
  );

  if (!validMove) {
    return { ok: false, board: nextBoard };
  }

  const enPassantMove = isEnPassantMove(
    nextBoard,
    playedPiece.position,
    destination,
    playedPiece.type,
    playedPiece.team
  );

  const checkersJump =
    playedPiece.isCheckers &&
    isCheckersJump(
      playedPiece.position,
      destination,
      nextBoard.pieces,
      playedPiece.team
    );

  const isCapture =
    enPassantMove ||
    checkersJump ||
    nextBoard.pieces.some(
      (p) => p.samePosition(destination) && p.team !== playedPiece.team
    );

  const playedMoveIsValid = nextBoard.playMove(
    enPassantMove,
    validMove,
    playedPiece,
    destination
  );

  if (!playedMoveIsValid) {
    return { ok: false, board: nextBoard };
  }

  if (nextBoard.winningTeam === undefined) {
    if (playedPiece.isCheckers && checkersJump) {
      const movedCheckers = nextBoard.pieces.find(
        (p) =>
          p.isCheckers &&
          p.team === playedPiece.team &&
          p.samePosition(destination)
      );

      const moreJumps =
        movedCheckers !== undefined &&
        getSingleJumpMoves(movedCheckers, nextBoard.pieces).length > 0;

      if (moreJumps) {
        nextBoard.checkersHopPosition = destination.clone();
      } else {
        nextBoard.checkersHopPosition = undefined;
        nextBoard.totalTurns += 1;
      }
    } else {
      nextBoard.checkersHopPosition = undefined;
      nextBoard.totalTurns += 1;
    }
  }

  nextBoard.calculateAllMoves();

  const promotionRow = playedPiece.team === TeamType.OUR ? 7 : 0;
  let pendingPromotion: PendingPromotion | undefined;

  if (
    destination.y === promotionRow &&
    playedPiece.isPawn &&
    move.promotion === undefined
  ) {
    pendingPromotion = {
      x: destination.x,
      y: destination.y,
      team: playedPiece.team,
    };
  } else if (
    destination.y === promotionRow &&
    playedPiece.isPawn &&
    move.promotion !== undefined
  ) {
    applyPromotionChoice(nextBoard, destination, move.promotion);
    nextBoard.calculateAllMoves();
  }

  recordPosition(nextBoard);

  return {
    ok: true,
    board: nextBoard,
    pendingPromotion,
    isCapture,
  };
}
