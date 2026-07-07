import { BOARD_DIM } from "../constants";
import { Piece, Position, wrapCoord } from "../models";
import { TeamType } from "../Types";
import { tileIsOccupied, tileIsOccupiedByOpponent } from "./GeneralRules";

const DIRECTIONS: [number, number][] = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

function torusDelta(from: number, to: number): number {
  let d = to - from;
  if (d > BOARD_DIM / 2) d -= BOARD_DIM;
  if (d < -BOARD_DIM / 2) d += BOARD_DIM;
  return d;
}

export const getKingStepMoves = (
  piece: Piece,
  boardState: Piece[]
): Position[] => {
  const possibleMoves: Position[] = [];

  for (const [dx, dy] of DIRECTIONS) {
    const destination = new Position(
      wrapCoord(piece.position.x + dx),
      wrapCoord(piece.position.y + dy)
    );
    if (!tileIsOccupied(destination, boardState)) {
      possibleMoves.push(destination);
    }
  }

  return possibleMoves;
};

export const getSingleJumpMoves = (
  piece: Piece,
  boardState: Piece[]
): Position[] => {
  const possibleMoves: Position[] = [];

  for (const [dx, dy] of DIRECTIONS) {
    const adjacent = new Position(
      wrapCoord(piece.position.x + dx),
      wrapCoord(piece.position.y + dy)
    );
    const landing = new Position(
      wrapCoord(piece.position.x + 2 * dx),
      wrapCoord(piece.position.y + 2 * dy)
    );
    if (
      tileIsOccupiedByOpponent(adjacent, boardState, piece.team) &&
      !tileIsOccupied(landing, boardState)
    ) {
      possibleMoves.push(landing);
    }
  }

  return possibleMoves;
};

export const getPossibleCheckersMoves = (
  piece: Piece,
  boardState: Piece[],
  hopContinuation: boolean
): Position[] => {
  const jumps = getSingleJumpMoves(piece, boardState);
  if (hopContinuation) return jumps;

  const steps = getKingStepMoves(piece, boardState);
  const seen = new Set<string>();
  const possibleMoves: Position[] = [];

  for (const move of [...steps, ...jumps]) {
    const key = `${move.x},${move.y}`;
    if (!seen.has(key)) {
      seen.add(key);
      possibleMoves.push(move);
    }
  }

  return possibleMoves;
};

export const getJumpedPiece = (
  from: Position,
  to: Position,
  boardState: Piece[]
): Piece | undefined => {
  const dx = torusDelta(from.x, to.x);
  const dy = torusDelta(from.y, to.y);
  const absDx = Math.abs(dx);
  const absDy = Math.abs(dy);
  const isValidJump =
    (absDx === 2 && absDy === 0) ||
    (absDx === 0 && absDy === 2) ||
    (absDx === 2 && absDy === 2);
  if (!isValidJump) return undefined;

  const middle = new Position(
    wrapCoord(from.x + dx / 2),
    wrapCoord(from.y + dy / 2)
  );
  return boardState.find((p) => p.samePosition(middle));
};

export const isCheckersJump = (
  from: Position,
  to: Position,
  boardState: Piece[],
  team: TeamType
): boolean => {
  const jumped = getJumpedPiece(from, to, boardState);
  return jumped !== undefined && jumped.team !== team;
};
