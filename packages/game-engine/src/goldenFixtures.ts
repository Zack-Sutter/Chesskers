import { applyMove } from "./applyMove";
import { initialBoard } from "./boardConstants";
import { Board } from "./models/Board";
import { Position } from "./models/Position";
import { deserializeBoard, serializeBoard } from "./serialization";
import {
  Move,
  PendingPromotion,
  PieceType,
  SerializedBoard,
  TeamType,
} from "./Types";

export interface LegalMovesExpect {
  from: { x: number; y: number };
  include?: { x: number; y: number }[];
  exclude?: { x: number; y: number }[];
  exact?: { x: number; y: number }[];
}

export interface FixtureExpect {
  winningTeam?: TeamType | null;
  pieceCount?: number;
  legalMovesFrom?: LegalMovesExpect[] | null;
  applyOk?: boolean;
  totalTurns?: number;
  checkersHopPosition?: { x: number; y: number } | null;
  pendingPromotion?: PendingPromotion | null;
  pieceAt?: { x: number; y: number; type: PieceType }[];
  noPieceAt?: { x: number; y: number }[];
  noPieceType?: PieceType;
}

export interface GoldenFixture {
  name: string;
  board: SerializedBoard;
  action?: { move: Move };
  expect: FixtureExpect;
}

function p(
  x: number,
  y: number,
  type: PieceType,
  team: TeamType,
  hasMoved = false,
  enPassant?: boolean
) {
  const piece = { x, y, type, team, hasMoved };
  return enPassant ? { ...piece, enPassant: true } : piece;
}

function boardFromSerialized(data: SerializedBoard): Board {
  return deserializeBoard(data);
}

export const goldenFixtures: GoldenFixture[] = [
  {
    name: "initial_board",
    board: serializeBoard(initialBoard),
    expect: { pieceCount: 20 },
  },
  {
    name: "checkers_single_hop_removes_pawn",
    board: {
      schemaVersion: 1,
      totalTurns: 2,
      pieces: [
        p(4, 6, PieceType.CHECKERS, TeamType.OPPONENT),
        p(3, 5, PieceType.PAWN, TeamType.OUR),
        p(7, 7, PieceType.KING, TeamType.OUR),
      ],
    },
    action: { move: { from: { x: 4, y: 6 }, to: { x: 2, y: 4 } } },
    expect: {
      applyOk: true,
      pieceCount: 2,
      noPieceType: PieceType.PAWN,
      pieceAt: [{ x: 2, y: 4, type: PieceType.CHECKERS }],
    },
  },
  {
    name: "checkers_orthogonal_hop_removes_pawn",
    board: {
      schemaVersion: 1,
      totalTurns: 2,
      pieces: [
        p(3, 4, PieceType.CHECKERS, TeamType.OPPONENT),
        p(3, 3, PieceType.PAWN, TeamType.OUR),
        p(7, 7, PieceType.KING, TeamType.OUR),
      ],
    },
    action: { move: { from: { x: 3, y: 4 }, to: { x: 3, y: 2 } } },
    expect: {
      applyOk: true,
      pieceCount: 2,
      noPieceType: PieceType.PAWN,
      pieceAt: [{ x: 3, y: 2, type: PieceType.CHECKERS }],
    },
  },
  {
    name: "checkers_no_adjacent_king_step_capture",
    board: {
      schemaVersion: 1,
      totalTurns: 2,
      pieces: [
        p(3, 6, PieceType.CHECKERS, TeamType.OPPONENT),
        p(4, 7, PieceType.PAWN, TeamType.OUR),
        p(0, 0, PieceType.KING, TeamType.OUR),
      ],
    },
    expect: {
      legalMovesFrom: [
        { from: { x: 3, y: 6 }, exclude: [{ x: 4, y: 7 }] },
      ],
    },
  },
  {
    name: "checkers_hop_continuation_jump_only",
    board: {
      schemaVersion: 1,
      totalTurns: 2,
      checkersHopPosition: { x: 2, y: 4 },
      pieces: [
        p(2, 4, PieceType.CHECKERS, TeamType.OPPONENT, true),
        p(0, 6, PieceType.CHECKERS, TeamType.OPPONENT),
        p(3, 3, PieceType.PAWN, TeamType.OUR),
        p(7, 7, PieceType.KING, TeamType.OUR),
      ],
    },
    expect: {
      legalMovesFrom: [
        { from: { x: 0, y: 6 }, exact: [] },
        { from: { x: 2, y: 4 }, include: [{ x: 4, y: 2 }], exclude: [{ x: 3, y: 5 }] },
      ],
    },
  },
  {
    name: "declares_white_winner_when_no_black_pieces",
    board: {
      schemaVersion: 1,
      totalTurns: 1,
      pieces: [p(4, 0, PieceType.KING, TeamType.OUR)],
    },
    expect: { winningTeam: TeamType.OUR },
  },
  {
    name: "declares_black_winner_when_white_king_hopped",
    board: {
      schemaVersion: 1,
      totalTurns: 2,
      pieces: [
        p(4, 6, PieceType.CHECKERS, TeamType.OPPONENT),
        p(3, 5, PieceType.KING, TeamType.OUR),
      ],
    },
    action: { move: { from: { x: 4, y: 6 }, to: { x: 2, y: 4 } } },
    expect: {
      winningTeam: TeamType.OPPONENT,
      pieceCount: 1,
      noPieceType: PieceType.KING,
    },
  },
  {
    name: "checkers_wrapped_step_left_edge",
    board: {
      schemaVersion: 1,
      totalTurns: 2,
      pieces: [
        p(0, 3, PieceType.CHECKERS, TeamType.OPPONENT),
        p(7, 7, PieceType.KING, TeamType.OUR),
      ],
    },
    expect: {
      legalMovesFrom: [{ from: { x: 0, y: 3 }, include: [{ x: 7, y: 3 }] }],
    },
  },
  {
    name: "checkers_wrapped_orthogonal_hop_left_edge",
    board: {
      schemaVersion: 1,
      totalTurns: 2,
      pieces: [
        p(0, 3, PieceType.CHECKERS, TeamType.OPPONENT),
        p(7, 3, PieceType.PAWN, TeamType.OUR),
        p(7, 7, PieceType.KING, TeamType.OUR),
      ],
    },
    action: { move: { from: { x: 0, y: 3 }, to: { x: 6, y: 3 } } },
    expect: {
      applyOk: true,
      pieceCount: 2,
      noPieceType: PieceType.PAWN,
      pieceAt: [{ x: 6, y: 3, type: PieceType.CHECKERS }],
    },
  },
  {
    name: "checkers_wrapped_diagonal_hop_corner",
    board: {
      schemaVersion: 1,
      totalTurns: 2,
      pieces: [
        p(0, 0, PieceType.CHECKERS, TeamType.OPPONENT),
        p(7, 7, PieceType.PAWN, TeamType.OUR),
        p(4, 0, PieceType.KING, TeamType.OUR),
      ],
    },
    expect: {
      legalMovesFrom: [{ from: { x: 0, y: 0 }, include: [{ x: 6, y: 6 }] }],
    },
  },
  {
    name: "rejects_move_on_wrong_turn",
    board: {
      schemaVersion: 1,
      totalTurns: 2,
      pieces: [
        p(0, 1, PieceType.PAWN, TeamType.OUR),
        p(4, 0, PieceType.KING, TeamType.OUR),
        p(3, 6, PieceType.CHECKERS, TeamType.OPPONENT),
      ],
    },
    action: { move: { from: { x: 0, y: 1 }, to: { x: 0, y: 2 } } },
    expect: { applyOk: false, totalTurns: 2 },
  },
  {
    name: "checkers_hop_chain_keeps_turn",
    board: {
      schemaVersion: 1,
      totalTurns: 2,
      pieces: [
        p(4, 6, PieceType.CHECKERS, TeamType.OPPONENT),
        p(3, 5, PieceType.PAWN, TeamType.OUR),
        p(3, 3, PieceType.PAWN, TeamType.OUR),
        p(7, 7, PieceType.KING, TeamType.OUR),
      ],
    },
    action: { move: { from: { x: 4, y: 6 }, to: { x: 2, y: 4 } } },
    expect: {
      applyOk: true,
      totalTurns: 2,
      checkersHopPosition: { x: 2, y: 4 },
    },
  },
  {
    name: "pawn_reaches_back_rank_pending_promotion",
    board: {
      schemaVersion: 1,
      totalTurns: 1,
      pieces: [
        p(0, 6, PieceType.PAWN, TeamType.OUR, true),
        p(7, 7, PieceType.KING, TeamType.OUR),
        p(3, 6, PieceType.CHECKERS, TeamType.OPPONENT),
      ],
    },
    action: { move: { from: { x: 0, y: 6 }, to: { x: 0, y: 7 } } },
    expect: {
      applyOk: true,
      pendingPromotion: { x: 0, y: 7, team: TeamType.OUR },
    },
  },
];

export function fixtureToJson(fixture: GoldenFixture): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: fixture.name,
    board: fixture.board,
    expect: fixture.expect,
  };
  if (fixture.action) {
    out.action = fixture.action;
  }
  return out;
}

function posEq(a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  return a.x === b.x && a.y === b.y;
}

function legalMovesOf(board: Board, from: { x: number; y: number }): Position[] {
  const piece = board.pieces.find((p) => p.position.x === from.x && p.position.y === from.y);
  return piece?.possibleMoves ?? [];
}

export function assertFixture(fixture: GoldenFixture): void {
  const board = boardFromSerialized(fixture.board);
  let resultBoard = board;
  let applyOk: boolean | undefined;
  let pendingPromotion: PendingPromotion | undefined;

  if (fixture.action) {
    const result = applyMove(board, fixture.action.move);
    applyOk = result.ok;
    resultBoard = result.board;
    pendingPromotion = result.pendingPromotion;
  }

  const { expect } = fixture;

  if (expect.applyOk !== undefined) {
    if (applyOk !== expect.applyOk) {
      throw new Error(`${fixture.name}: applyOk expected ${expect.applyOk}, got ${applyOk}`);
    }
  }

  if (expect.totalTurns !== undefined) {
    const turns = fixture.action && applyOk === false ? board.totalTurns : resultBoard.totalTurns;
    if (turns !== expect.totalTurns) {
      throw new Error(`${fixture.name}: totalTurns expected ${expect.totalTurns}, got ${turns}`);
    }
  }

  if (expect.checkersHopPosition !== undefined) {
    const hop = resultBoard.checkersHopPosition;
    const exp = expect.checkersHopPosition;
    if (exp === null) {
      if (hop !== undefined) {
        throw new Error(`${fixture.name}: expected no checkersHopPosition`);
      }
    } else if (!hop?.samePosition(new Position(exp.x, exp.y))) {
      throw new Error(
        `${fixture.name}: checkersHopPosition expected (${exp.x},${exp.y}), got (${hop?.x},${hop?.y})`
      );
    }
  }

  if (expect.pendingPromotion !== undefined) {
    if (expect.pendingPromotion === null) {
      if (pendingPromotion !== undefined) {
        throw new Error(`${fixture.name}: expected no pendingPromotion`);
      }
    } else if (
      !pendingPromotion ||
      pendingPromotion.x !== expect.pendingPromotion.x ||
      pendingPromotion.y !== expect.pendingPromotion.y ||
      pendingPromotion.team !== expect.pendingPromotion.team
    ) {
      throw new Error(`${fixture.name}: pendingPromotion mismatch`);
    }
  }

  if (expect.winningTeam !== undefined) {
    if (resultBoard.winningTeam !== expect.winningTeam) {
      throw new Error(
        `${fixture.name}: winningTeam expected ${expect.winningTeam}, got ${resultBoard.winningTeam}`
      );
    }
  }

  if (expect.pieceCount !== undefined && resultBoard.pieces.length !== expect.pieceCount) {
    throw new Error(
      `${fixture.name}: pieceCount expected ${expect.pieceCount}, got ${resultBoard.pieces.length}`
    );
  }

  if (expect.noPieceType !== undefined) {
    if (resultBoard.pieces.some((p) => p.type === expect.noPieceType)) {
      throw new Error(`${fixture.name}: expected no piece of type ${expect.noPieceType}`);
    }
  }

  if (expect.pieceAt) {
    for (const want of expect.pieceAt) {
      const found = resultBoard.pieces.find(
        (p) => p.position.x === want.x && p.position.y === want.y && p.type === want.type
      );
      if (!found) {
        throw new Error(`${fixture.name}: missing ${want.type} at (${want.x},${want.y})`);
      }
    }
  }

  if (expect.noPieceAt) {
    for (const at of expect.noPieceAt) {
      if (resultBoard.pieces.some((p) => p.position.x === at.x && p.position.y === at.y)) {
        throw new Error(`${fixture.name}: unexpected piece at (${at.x},${at.y})`);
      }
    }
  }

  if (expect.legalMovesFrom) {
    for (const spec of expect.legalMovesFrom) {
      const moves = legalMovesOf(resultBoard, spec.from).map((m) => ({ x: m.x, y: m.y }));
      if (spec.exact) {
        const a = [...moves].sort((x, y) => x.x - y.x || x.y - y.y);
        const b = [...spec.exact].sort((x, y) => x.x - y.x || x.y - y.y);
        if (JSON.stringify(a) !== JSON.stringify(b)) {
          throw new Error(`${fixture.name}: legal moves from (${spec.from.x},${spec.from.y}) mismatch`);
        }
      }
      if (spec.include) {
        for (const inc of spec.include) {
          if (!moves.some((m) => posEq(m, inc))) {
            throw new Error(
              `${fixture.name}: expected move to (${inc.x},${inc.y}) from (${spec.from.x},${spec.from.y})`
            );
          }
        }
      }
      if (spec.exclude) {
        for (const exc of spec.exclude) {
          if (moves.some((m) => posEq(m, exc))) {
            throw new Error(
              `${fixture.name}: unexpected move to (${exc.x},${exc.y}) from (${spec.from.x},${spec.from.y})`
            );
          }
        }
      }
    }
  }
}
