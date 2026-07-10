import { useEffect, useRef, useState } from "react";

import {
  applyMove,
  applyPromotion,
  initialBoard,
  initPositionTracking,
  isTerminalBoard,
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

interface GameSnapshot {
  board: Board;
  promotion: PromotionTarget | null;
}

interface LocalGame extends GameSnapshot {
  past: GameSnapshot[];
  future: GameSnapshot[];
}

function initialLocalGame(): LocalGame {
  return {
    board: initPositionTracking(initialBoard.clone()),
    promotion: null,
    past: [],
    future: [],
  };
}

interface Props {
  room?: GameRoom;
  onExit?: () => void;
}

export default function Referee({ room, onExit }: Props) {
  const online = room != null;

  const [local, setLocal] = useState<LocalGame>(initialLocalGame);
  const soundStateRef = useRef<{
    count: number;
    turns: number;
    winner?: TeamType;
    isDraw?: boolean;
  } | null>(null);

  const board = online ? room!.board : local.board;

  const promotion: PromotionTarget | null = online
    ? room!.pendingPromotion && room!.myColor
      ? { ...room!.pendingPromotion, team: room!.myColor }
      : null
    : local.promotion;

  const gameOver = board ? isTerminalBoard(board) : false;

  // Online mode is server-driven, so play sounds by diffing incoming boards.
  useEffect(() => {
    if (!online || !board) return;
    const count = board.pieces.length;
    const turns = board.totalTurns;
    const prev = soundStateRef.current;
    soundStateRef.current = { count, turns, winner: board.winningTeam, isDraw: board.isDraw };
    if (!prev) return;
    const wasTerminal = prev.winner !== undefined || prev.isDraw === true;
    if (isTerminalBoard(board) && !wasTerminal) {
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

    let played = false;
    let isCapture = false;
    let isGameOver = false;

    setLocal((previous) => {
      const result = applyMove(previous.board, {
        from: { x: playedPiece.position.x, y: playedPiece.position.y },
        to: { x: destination.x, y: destination.y },
      });

      if (!result.ok) {
        return previous;
      }

      played = true;
      isCapture = result.isCapture ?? false;
      isGameOver = isTerminalBoard(result.board);

      let nextPromotion: PromotionTarget | null = null;
      if (result.pendingPromotion) {
        const pawn = result.board.pieces.find(
          (p) =>
            p.isPawn &&
            p.position.x === result.pendingPromotion!.x &&
            p.position.y === result.pendingPromotion!.y
        );
        if (pawn) {
          nextPromotion = {
            x: pawn.position.x,
            y: pawn.position.y,
            team: pawn.team,
          };
        }
      }

      return {
        board: result.board,
        promotion: nextPromotion,
        past: [
          ...previous.past,
          { board: previous.board.clone(), promotion: previous.promotion },
        ],
        future: [],
      };
    });

    if (!played) {
      return false;
    }

    if (isCapture) {
      captureSound.play();
    } else {
      moveSound.play();
    }

    if (isGameOver) {
      checkmateSound.play();
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

    setLocal((previous) => {
      if (!previous.promotion) return previous;

      const choice = PROMOTION_CHOICE[pieceType];
      if (!choice) return previous;

      const nextBoard = applyPromotion(previous.board, previous.promotion, choice);

      return {
        board: nextBoard,
        promotion: null,
        past: [
          ...previous.past,
          { board: previous.board.clone(), promotion: previous.promotion },
        ],
        future: [],
      };
    });
  }

  function undoMove() {
    if (online) return;

    setLocal((previous) => {
      if (previous.past.length === 0) return previous;

      const snapshot = previous.past[previous.past.length - 1];
      return {
        board: snapshot.board.clone(),
        promotion: snapshot.promotion ? { ...snapshot.promotion } : null,
        past: previous.past.slice(0, -1),
        future: [
          { board: previous.board.clone(), promotion: previous.promotion },
          ...previous.future,
        ],
      };
    });
  }

  function redoMove() {
    if (online) return;

    setLocal((previous) => {
      if (previous.future.length === 0) return previous;

      const snapshot = previous.future[0];
      return {
        board: snapshot.board.clone(),
        promotion: snapshot.promotion ? { ...snapshot.promotion } : null,
        past: [
          ...previous.past,
          { board: previous.board.clone(), promotion: previous.promotion },
        ],
        future: previous.future.slice(1),
      };
    });
  }

  function promotionTeamType() {
    return promotion?.team === TeamType.OUR ? "w" : "b";
  }

  function restartGame() {
    if (online) {
      onExit?.();
      return;
    }
    setLocal(initialLocalGame());
  }

  function gameOverMessage(): string {
    if (board?.isDraw) {
      return "Draw — position repeated three times";
    }
    if (board?.winningTeam === TeamType.OPPONENT) {
      return "Black wins — white king jumped!";
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
        {!online && (
          <>
            <button
              className="history-button"
              disabled={local.past.length === 0}
              onClick={undoMove}
            >
              Undo
            </button>
            <button
              className="history-button"
              disabled={local.future.length === 0}
              onClick={redoMove}
            >
              Redo
            </button>
          </>
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
            lastMove={board.lastMove}
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
