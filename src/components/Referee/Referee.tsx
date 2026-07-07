import { useEffect, useRef, useState } from "react";

import {
  applyMove,
  initialBoard,
  Board,
  Piece,
  Position,
  PieceType,
  TeamType,
} from "game-engine";

import Chessboard from "../Chessboard/Chessboard";
import type { GameRoom } from "../../hooks/useGameRoom";

import { Howl } from "howler";

const moveSound = new Howl({ src: ["/sounds/move-self.mp3"] });
const captureSound = new Howl({ src: ["/sounds/capture.mp3"] });
const checkmateSound = new Howl({ src: ["/sounds/move-check.mp3"] });

const PROMOTION_TYPES: { type: PieceType; label: string }[] = [
  { type: PieceType.ROOK, label: "Rook" },
  { type: PieceType.BISHOP, label: "Bishop" },
  { type: PieceType.KNIGHT, label: "Knight" },
  { type: PieceType.QUEEN, label: "Queen" },
];

const PROMOTION_CHOICE: Record<PieceType, "queen" | "rook" | "bishop" | "knight" | null> = {
  [PieceType.QUEEN]: "queen",
  [PieceType.ROOK]: "rook",
  [PieceType.BISHOP]: "bishop",
  [PieceType.KNIGHT]: "knight",
  [PieceType.PAWN]: null,
  [PieceType.KING]: null,
  [PieceType.CHECKERS]: null,
};

interface PromotionTarget {
  x: number;
  y: number;
  team: TeamType;
}

interface Props {
  room?: GameRoom;
  onExit?: () => void;
}

export default function Referee({ room, onExit }: Props) {
  const online = room != null;

  const [localBoard, setLocalBoard] = useState<Board>(initialBoard.clone());
  const [localPromotion, setLocalPromotion] = useState<PromotionTarget | null>(
    null
  );
  const soundStateRef = useRef<{
    count: number;
    turns: number;
    winner?: TeamType;
  } | null>(null);

  const board = online ? room!.board : localBoard;

  const promotion: PromotionTarget | null = online
    ? room!.pendingPromotion && room!.myColor
      ? { ...room!.pendingPromotion, team: room!.myColor }
      : null
    : localPromotion;

  const gameOver = board?.winningTeam !== undefined;

  // Online mode is server-driven, so play sounds by diffing incoming boards.
  useEffect(() => {
    if (!online || !board) return;
    const count = board.pieces.length;
    const turns = board.totalTurns;
    const prev = soundStateRef.current;
    soundStateRef.current = { count, turns, winner: board.winningTeam };
    if (!prev) return;
    if (board.winningTeam !== undefined && prev.winner === undefined) {
      checkmateSound.play();
    } else if (count < prev.count) {
      captureSound.play();
    } else if (turns !== prev.turns) {
      moveSound.play();
    }
  }, [online, board]);

  function playMove(playedPiece: Piece, destination: Position): boolean {
    if (online) {
      return room!.sendMove(playedPiece.position, destination);
    }

    const result = applyMove(localBoard, {
      from: { x: playedPiece.position.x, y: playedPiece.position.y },
      to: { x: destination.x, y: destination.y },
    });

    if (!result.ok) {
      return false;
    }

    setLocalBoard(result.board);

    if (result.isCapture) {
      captureSound.play();
    } else {
      moveSound.play();
    }

    if (result.board.winningTeam !== undefined) {
      checkmateSound.play();
    }

    if (result.pendingPromotion) {
      const pawn = result.board.pieces.find(
        (p) =>
          p.isPawn &&
          p.position.x === result.pendingPromotion!.x &&
          p.position.y === result.pendingPromotion!.y
      );
      if (pawn) {
        setLocalPromotion({
          x: pawn.position.x,
          y: pawn.position.y,
          team: pawn.team,
        });
      }
    }

    return true;
  }

  function promotePawn(pieceType: PieceType) {
    if (!promotion) return;

    if (online) {
      const choice = PROMOTION_CHOICE[pieceType];
      if (choice) room!.sendPromotion(choice);
      return;
    }

    setLocalBoard((previousBoard) => {
      const clonedBoard = previousBoard.clone();
      clonedBoard.pieces = clonedBoard.pieces.map((piece) =>
        piece.position.x === promotion.x && piece.position.y === promotion.y
          ? new Piece(piece.position.clone(), pieceType, piece.team, true)
          : piece
      );
      clonedBoard.calculateAllMoves();
      return clonedBoard;
    });
    setLocalPromotion(null);
  }

  function promotionTeamType() {
    return promotion?.team === TeamType.OUR ? "w" : "b";
  }

  function restartGame() {
    if (online) {
      onExit?.();
      return;
    }
    setLocalBoard(initialBoard.clone());
    setLocalPromotion(null);
  }

  function gameOverMessage(): string {
    if (board?.winningTeam === TeamType.OPPONENT) {
      return "Black wins — white king jumped and burgled!";
    }
    return "White wins — all black pieces captured!";
  }

  function statusText(): string {
    if (!online) return `Total turns: ${board?.totalTurns ?? 0}`;
    if (room!.status === "connecting") return "Connecting…";
    if (room!.error) return room!.error;
    if (room!.engineThinking) return "Engine thinking…";
    if (!board) return "Waiting for game…";
    return room!.isMyTurn ? "Your move" : "Engine to move";
  }

  return (
    <>
      <div className="game-status">
        {onExit && (
          <button className="exit-button" onClick={onExit}>
            ← Lobby
          </button>
        )}
        <span style={{ color: "white", fontSize: "14px" }}>{statusText()}</span>
      </div>

      <div className={`modal ${promotion ? "" : "hidden"}`}>
        <div className="modal-body">
          {PROMOTION_TYPES.map(({ type, label }) => (
            <img
              key={label}
              alt={`Promote to ${label}`}
              onClick={() => promotePawn(type)}
              src={`/assets/images/${label.toLowerCase()}_${promotionTeamType()}.png`}
            />
          ))}
        </div>
      </div>

      <div className={`modal ${gameOver ? "" : "hidden"}`}>
        <div className="modal-body">
          <div className="checkmate-body">
            <span>{gameOverMessage()}</span>
            <button onClick={restartGame}>
              {online ? "Back to lobby" : "Play again"}
            </button>
          </div>
        </div>
      </div>

      <div className="board-viewport">
        {board ? (
          <Chessboard
            playMove={playMove}
            pieces={board.pieces}
            hopContinuationPosition={board.checkersHopPosition}
          />
        ) : (
          <p style={{ color: "white", textAlign: "center" }}>
            {room?.error ?? "Connecting to game…"}
          </p>
        )}
      </div>
    </>
  );
}
