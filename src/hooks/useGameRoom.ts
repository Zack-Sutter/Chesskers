import { useEffect, useRef, useState } from "react";
import {
  Board,
  Position,
  TeamType,
  deserializeBoard,
  isTerminalBoard,
  type PromotionChoice,
  type SerializedBoard,
} from "game-engine";
import { wsUrl } from "../config";

export type RoomStatus =
  | "connecting"
  | "playing"
  | "gameOver"
  | "error";

export interface GameRoom {
  board: Board | null;
  myColor: TeamType | null;
  status: RoomStatus;
  error: string | null;
  engineThinking: boolean;
  pendingPromotion: { x: number; y: number } | null;
  isMyTurn: boolean;
  sendMove: (from: Position, to: Position) => boolean;
  sendPromotion: (pieceType: PromotionChoice) => void;
}

interface ServerMessage {
  type: string;
  color?: TeamType;
  board?: SerializedBoard;
  playerToken?: string;
  position?: { x: number; y: number };
  winner?: TeamType;
  draw?: boolean;
  message?: string;
}

/**
 * Connects to the game server for vs-engine or engine-vs-engine. The human takes
 * a socket seat when playing one side; with both colors in `engineColors` the
 * client spectates and auto-chains `requestEngineMove` whenever an engine moves.
 */
export function useGameRoom(gameId: string, engineColors: TeamType[]): GameRoom {
  const isSpectator = engineColors.length > 1;
  const [board, setBoard] = useState<Board | null>(null);
  const [myColor, setMyColor] = useState<TeamType | null>(null);
  const [status, setStatus] = useState<RoomStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [engineThinking, setEngineThinking] = useState(false);
  const [pendingPromotion, setPendingPromotion] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const engineThinkingRef = useRef(false);

  useEffect(() => {
    const ws = new WebSocket(wsUrl());
    wsRef.current = ws;

    const requestEngineIfNeeded = (b: Board) => {
      if (engineThinkingRef.current) return;
      if (!isTerminalBoard(b) && engineColors.includes(b.sideToMove)) {
        ws.send(JSON.stringify({ type: "requestEngineMove" }));
      }
    };

    ws.onopen = () => {
      const token = localStorage.getItem(`chesskers:token:${gameId}`);
      ws.send(
        JSON.stringify({
          type: "join",
          gameId,
          playerToken: token ?? undefined,
        })
      );
    };

    ws.onmessage = (event) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data) as ServerMessage;
      } catch {
        return;
      }

      switch (msg.type) {
        case "joined": {
          if (msg.color) setMyColor(msg.color);
          if (msg.playerToken) {
            localStorage.setItem(`chesskers:token:${gameId}`, msg.playerToken);
          }
          if (msg.board) {
            const b = deserializeBoard(msg.board);
            setBoard(b);
            setStatus("playing");
            requestEngineIfNeeded(b);
          }
          break;
        }
        // "waiting" means the second human seat is empty; vs the engine there is
        // no second human, so we simply keep playing.
        case "waiting":
          setStatus("playing");
          break;
        case "state": {
          if (msg.board) {
            const b = deserializeBoard(msg.board);
            setBoard(b);
            setEngineThinking(false);
            engineThinkingRef.current = false;
            setPendingPromotion(null);
            requestEngineIfNeeded(b);
          }
          break;
        }
        case "promote_required":
          setPendingPromotion(msg.position ?? null);
          break;
        case "engineThinking":
          engineThinkingRef.current = true;
          setEngineThinking(true);
          break;
        case "gameOver":
          setStatus("gameOver");
          break;
        case "error":
          setError(msg.message ?? "Unknown error");
          setEngineThinking(false);
          engineThinkingRef.current = false;
          break;
      }
    };

    ws.onerror = () => {
      setStatus("error");
      setError("Connection error");
    };

    return () => ws.close();
  }, [gameId, engineColors]);

  const isMyTurn =
    !isSpectator &&
    board !== null &&
    myColor !== null &&
    status === "playing" &&
    !engineThinking &&
    pendingPromotion === null &&
    !isTerminalBoard(board) &&
    board.sideToMove === myColor;

  function sendMove(from: Position, to: Position): boolean {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== ws.OPEN || !isMyTurn || !board) return false;
    const piece = board.pieces.find((p) => p.samePosition(from));
    if (!piece || piece.team !== myColor) return false;
    ws.send(
      JSON.stringify({
        type: "move",
        from: { x: from.x, y: from.y },
        to: { x: to.x, y: to.y },
      })
    );
    return true;
  }

  function sendPromotion(pieceType: PromotionChoice) {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== ws.OPEN) return;
    ws.send(JSON.stringify({ type: "promote", pieceType }));
    setPendingPromotion(null);
  }

  return {
    board,
    myColor,
    status,
    error,
    engineThinking,
    pendingPromotion,
    isMyTurn,
    sendMove,
    sendPromotion,
  };
}
