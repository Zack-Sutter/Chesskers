import { useRef, useState } from "react";
import "./Chessboard.css";
import Tile from "../Tile/Tile";
import { BOARD_DIM, GUTTER_HALVES, WRAPPER_DIM } from "../../Constants";
import { Piece, Position } from "game-engine";

interface Props {
  playMove: (piece: Piece, position: Position) => boolean;
  pieces: Piece[];
  hopContinuationPosition?: Position;
  lastMove?: { from: Position; to: Position };
}

interface ResolvedTile {
  file: number;
  rank: number;
  isPlayArea: boolean;
}

interface DragGhost {
  image: string;
  x: number;
  y: number;
}

function boardMetrics(wrapper: HTMLDivElement) {
  const rect = wrapper.getBoundingClientRect();
  const cell = rect.width / WRAPPER_DIM;
  return { rect, cell };
}

function resolveTile(gridCol: number, gridRow: number): ResolvedTile {
  const inPlayCol =
    gridCol >= GUTTER_HALVES && gridCol < GUTTER_HALVES + BOARD_DIM;
  const inPlayRow =
    gridRow >= GUTTER_HALVES && gridRow < GUTTER_HALVES + BOARD_DIM;

  let file: number;
  if (inPlayCol) {
    file = gridCol - GUTTER_HALVES;
  } else if (gridCol < GUTTER_HALVES) {
    file = gridCol + GUTTER_HALVES;
  } else {
    file = gridCol - GUTTER_HALVES - BOARD_DIM;
  }

  let rank: number;
  if (inPlayRow) {
    rank = GUTTER_HALVES + BOARD_DIM - 1 - gridRow;
  } else if (gridRow < GUTTER_HALVES) {
    rank = GUTTER_HALVES - 1 - gridRow;
  } else {
    rank = GUTTER_HALVES + 2 * BOARD_DIM - 1 - gridRow;
  }

  return { file, rank, isPlayArea: inPlayCol && inPlayRow };
}

export default function Chessboard({
  playMove,
  pieces,
  hopContinuationPosition,
  lastMove,
}: Props) {
  const [dragGhost, setDragGhost] = useState<DragGhost | null>(null);
  const [grabPosition, setGrabPosition] = useState<Position>(
    new Position(-1, -1)
  );
  const wrapperRef = useRef<HTMLDivElement>(null);

  function clientToLogical(
    clientX: number,
    clientY: number
  ): { position: Position; isPlayArea: boolean } | null {
    const wrapper = wrapperRef.current;
    if (!wrapper) return null;

    const { rect, cell } = boardMetrics(wrapper);
    const gridCol = Math.floor((clientX - rect.left) / cell);
    const gridRow = Math.floor((clientY - rect.top) / cell);
    if (
      gridCol < 0 ||
      gridCol >= WRAPPER_DIM ||
      gridRow < 0 ||
      gridRow >= WRAPPER_DIM
    ) {
      return null;
    }

    const { file, rank, isPlayArea } = resolveTile(gridCol, gridRow);
    return { position: new Position(file, rank), isPlayArea };
  }

  function dragPosition(
    clientX: number,
    clientY: number
  ): { x: number; y: number } | null {
    const wrapper = wrapperRef.current;
    if (!wrapper) return null;

    const { rect, cell } = boardMetrics(wrapper);
    return {
      x: clientX - rect.left - cell / 2,
      y: clientY - rect.top - cell / 2,
    };
  }

  function clampDragPosition(
    x: number,
    y: number,
    useFullWrapper: boolean
  ): { x: number; y: number } {
    const wrapper = wrapperRef.current;
    if (!wrapper) return { x, y };

    const { rect, cell } = boardMetrics(wrapper);
    const inset = cell * 0.25;
    const playMin = GUTTER_HALVES * cell - inset;
    const playMax = GUTTER_HALVES * cell + BOARD_DIM * cell - cell * 0.75;

    const minX = useFullWrapper ? -inset : playMin;
    const minY = useFullWrapper ? -inset : playMin;
    const maxX = useFullWrapper ? rect.width - cell * 0.75 : playMax;
    const maxY = useFullWrapper ? rect.height - cell * 0.75 : playMax;

    return {
      x: Math.min(Math.max(x, minX), maxX),
      y: Math.min(Math.max(y, minY), maxY),
    };
  }

  function grabPiece(e: React.MouseEvent) {
    const element = e.target as HTMLElement;
    const resolved = clientToLogical(e.clientX, e.clientY);
    if (
      !element.classList.contains("chess-piece") ||
      !resolved ||
      !resolved.isPlayArea
    ) {
      return;
    }

    const { position } = resolved;
    if (
      hopContinuationPosition &&
      (position.x !== hopContinuationPosition.x ||
        position.y !== hopContinuationPosition.y)
    ) {
      return;
    }

    const piece = pieces.find((p) => p.samePosition(position));
    const pos = dragPosition(e.clientX, e.clientY);
    if (!piece || !pos) return;

    setGrabPosition(position);
    setDragGhost({ image: piece.image, ...pos });
  }

  function movePiece(e: React.MouseEvent) {
    if (!dragGhost) return;

    const pos = dragPosition(e.clientX, e.clientY);
    if (!pos) return;

    const dragged = pieces.find((p) => p.samePosition(grabPosition));
    const clamped = clampDragPosition(pos.x, pos.y, dragged?.isCheckers ?? false);
    setDragGhost((prev) => (prev ? { ...prev, ...clamped } : null));
  }

  function dropPiece(e: React.MouseEvent) {
    if (!dragGhost) return;

    const resolved = clientToLogical(e.clientX, e.clientY);
    const currentPiece = pieces.find((p) => p.samePosition(grabPosition));

    if (resolved && currentPiece) {
      playMove(currentPiece.clone(), resolved.position);
    }

    setDragGhost(null);
    setGrabPosition(new Position(-1, -1));
  }

  const currentPiece =
    dragGhost != null
      ? pieces.find((p) => p.samePosition(grabPosition))
      : undefined;

  function isHighlighted(
    logical: Position,
    isPlayArea: boolean
  ): boolean {
    if (!currentPiece?.possibleMoves) return false;
    const isValidMove = currentPiece.possibleMoves.some((p) =>
      p.samePosition(logical)
    );
    if (!isValidMove) return false;
    if (currentPiece.isCheckers) return true;
    return isPlayArea;
  }

  function isLastMoveSquare(logical: Position): boolean {
    if (!lastMove) return false;
    return (
      lastMove.from.samePosition(logical) || lastMove.to.samePosition(logical)
    );
  }

  const tiles = [];
  for (let gridRow = 0; gridRow < WRAPPER_DIM; gridRow++) {
    for (let gridCol = 0; gridCol < WRAPPER_DIM; gridCol++) {
      const { file, rank, isPlayArea } = resolveTile(gridCol, gridRow);
      const logical = new Position(file, rank);
      const piece = pieces.find((p) => p.samePosition(logical));
      const draggingFromHere =
        dragGhost != null && grabPosition.samePosition(logical);
      const image = piece && !draggingFromHere ? piece.image : undefined;
      const number = rank + file + 2;

      tiles.push(
        <Tile
          key={`${gridRow},${gridCol}`}
          image={image}
          number={number}
          highlight={isHighlighted(logical, isPlayArea)}
          moveHighlight={isLastMoveSquare(logical)}
          isPlayArea={isPlayArea}
        />
      );
    }
  }

  const wrapper = wrapperRef.current;
  const cell = wrapper
    ? boardMetrics(wrapper).cell
    : 0;

  return (
    <div
      onMouseMove={(e) => movePiece(e)}
      onMouseDown={(e) => grabPiece(e)}
      onMouseUp={(e) => dropPiece(e)}
      id="board-wrapper"
      ref={wrapperRef}
    >
      {tiles}
      {dragGhost && (
        <div
          className="chess-piece drag-ghost"
          style={{
            backgroundImage: `url(${dragGhost.image})`,
            left: dragGhost.x,
            top: dragGhost.y,
            width: cell,
            height: cell,
            backgroundSize: cell,
          }}
        />
      )}
      <div id="play-area-border" />
    </div>
  );
}
