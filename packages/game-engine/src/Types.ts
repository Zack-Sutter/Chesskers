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
    winningTeam?: TeamType;
}