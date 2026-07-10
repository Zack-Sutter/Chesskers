export enum PieceType {
    PAWN = 'pawn',
    BISHOP = 'bishop',
    KNIGHT = 'knight',
    ROOK = 'rook',
    QUEEN = 'queen',
    KING = 'king',
    CHECKERS = 'checkers',
}

export enum TeamType {
    OPPONENT = 'b',
    OUR = 'w',
}

export interface SerializedPiece {
    x: number;
    y: number;
    type: PieceType;
    team: TeamType;
    hasMoved: boolean;
    enPassant?: boolean;
}

export interface SerializedBoard {
    schemaVersion: 1;
    pieces: SerializedPiece[];
    totalTurns: number;
    checkersHopPosition?: { x: number; y: number };
    lastMove?: { from: { x: number; y: number }; to: { x: number; y: number } };
    winningTeam?: TeamType;
    isDraw?: boolean;
}

export type PromotionChoice = "queen" | "rook" | "bishop" | "knight";

export interface Move {
    from: { x: number; y: number };
    to: { x: number; y: number };
    promotion?: PromotionChoice;
}

export interface PendingPromotion {
    x: number;
    y: number;
    team: TeamType;
}