import {

  getPossibleBishopMoves,

  getPossibleKingMoves,

  getPossibleKnightMoves,

  getPossiblePawnMoves,

  getPossibleQueenMoves,

  getPossibleRookMoves,

  getCastlingMoves,

  getPossibleCheckersMoves,

  getJumpedPiece,

  isCheckersJump,

} from "../rules";

import { PieceType, TeamType } from "../Types";

import { Pawn } from "./Pawn";

import { Piece } from "./Piece";

import { Position } from "./Position";



export class Board {

  pieces: Piece[];

  totalTurns: number;

  winningTeam?: TeamType;

  checkersHopPosition?: Position;



  constructor(pieces: Piece[], totalTurns: number) {

    this.pieces = pieces;

    this.totalTurns = totalTurns;

  }



  get currentTeam(): TeamType {

    return this.totalTurns % 2 === 0 ? TeamType.OPPONENT : TeamType.OUR;

  }



  // Side to move, accounting for a checkers hop lock: mid multi-hop only the
  // hopping piece may move, so its team is to move regardless of turn parity.
  get sideToMove(): TeamType {

    if (this.checkersHopPosition) {

      const piece = this.pieces.find((p) =>

        p.samePosition(this.checkersHopPosition!)

      );

      if (piece) return piece.team;

    }

    return this.currentTeam;

  }



  calculateAllMoves() {

    this.winningTeam = undefined;

    if (!this.pieces.some((p) => p.team === TeamType.OPPONENT)) {

      this.winningTeam = TeamType.OUR;

      return;

    }

    if (!this.pieces.some((p) => p.isKing && p.team === TeamType.OUR)) {

      this.winningTeam = TeamType.OPPONENT;

      return;

    }

    // Calculate the moves of all the pieces

    for (const piece of this.pieces) {

      piece.possibleMoves = this.getValidMoves(piece, this.pieces);

    }



    if (this.checkersHopPosition) {

      for (const piece of this.pieces.filter(

        (p) => p.team === this.currentTeam

      )) {

        if (!piece.samePosition(this.checkersHopPosition)) {

          piece.possibleMoves = [];

        }

      }

    }



    // Calculate castling moves

    for (const king of this.pieces.filter((p) => p.isKing)) {

      if (king.possibleMoves === undefined) continue;



      king.possibleMoves = [

        ...king.possibleMoves,

        ...getCastlingMoves(king, this.pieces),

      ];

    }

    // Remove the posibble moves for the team that is not playing

    for (const piece of this.pieces.filter(

      (p) => p.team !== this.currentTeam

    )) {

      piece.possibleMoves = [];

    }

  }

  getValidMoves(piece: Piece, boardState: Piece[]): Position[] {

    switch (piece.type) {

      case PieceType.PAWN:

        return getPossiblePawnMoves(piece, boardState);

      case PieceType.KNIGHT:

        return getPossibleKnightMoves(piece, boardState);

      case PieceType.BISHOP:

        return getPossibleBishopMoves(piece, boardState);

      case PieceType.ROOK:

        return getPossibleRookMoves(piece, boardState);

      case PieceType.QUEEN:

        return getPossibleQueenMoves(piece, boardState);

      case PieceType.KING:

        return getPossibleKingMoves(piece, boardState);

      case PieceType.CHECKERS:

        return getPossibleCheckersMoves(

          piece,

          boardState,

          this.checkersHopPosition !== undefined &&

            piece.samePosition(this.checkersHopPosition)

        );

      default:

        return [];

    }

  }



  playMove(

    enPassantMove: boolean,

    validMove: boolean,

    playedPiece: Piece,

    destination: Position

  ): boolean {

    const pawnDirection = playedPiece.team === TeamType.OUR ? 1 : -1;

    const destinationPiece = this.pieces.find((p) =>

      p.samePosition(destination)

    );



    // If the move is a castling move do this

    if (

      playedPiece.isKing &&

      destinationPiece?.isRook &&

      destinationPiece.team === playedPiece.team

    ) {

      const direction =

        destinationPiece.position.x - playedPiece.position.x > 0 ? 1 : -1;

      const newKingXPosition = playedPiece.position.x + direction * 2;

      this.pieces = this.pieces.map((p) => {

        if (p.samePiecePosition(playedPiece)) {

          p.position.x = newKingXPosition;

        } else if (p.samePiecePosition(destinationPiece)) {

          p.position.x = newKingXPosition - direction;

        }



        return p;

      });



      this.calculateAllMoves();

      return true;

    }



    if (enPassantMove) {

      this.pieces = this.pieces.reduce((results, piece) => {

        if (piece.samePiecePosition(playedPiece)) {

          if (piece.isPawn) (piece as Pawn).enPassant = false;

          piece.position.x = destination.x;

          piece.position.y = destination.y;

          piece.hasMoved = true;

          results.push(piece);

        } else if (

          !piece.samePosition(

            new Position(destination.x, destination.y - pawnDirection)

          )

        ) {

          if (piece.isPawn) {

            (piece as Pawn).enPassant = false;

          }

          results.push(piece);

        }



        return results;

      }, [] as Piece[]);



      this.calculateAllMoves();

    } else if (validMove) {

      const from = playedPiece.position.clone();

      const checkersJump =

        playedPiece.isCheckers &&

        isCheckersJump(from, destination, this.pieces, playedPiece.team);

      const jumped = checkersJump

        ? getJumpedPiece(from, destination, this.pieces)

        : undefined;



      //UPDATES THE PIECE POSITION

      //AND IF A PIECE IS ATTACKED, REMOVES IT

      this.pieces = this.pieces.reduce((results, piece) => {

        // Piece that we are currently moving

        if (piece.samePiecePosition(playedPiece)) {

          //SPECIAL MOVE

          if (piece.isPawn)

            (piece as Pawn).enPassant =

              Math.abs(playedPiece.position.y - destination.y) === 2 &&

              piece.type === PieceType.PAWN;

          piece.position.x = destination.x;

          piece.position.y = destination.y;

          piece.hasMoved = true;

          results.push(piece);

        } else if (jumped !== undefined && piece.samePiecePosition(jumped)) {

          // jumped piece removed by checkers hop

        } else if (!piece.samePosition(destination)) {

          if (piece.isPawn) {

            (piece as Pawn).enPassant = false;

          }

          results.push(piece);

        }



        // The piece at the destination location

        // Won't be pushed in the results

        return results;

      }, [] as Piece[]);



      this.calculateAllMoves();

    } else {

      return false;

    }



    return true;

  }



  clone(): Board {

    const cloned = new Board(

      this.pieces.map((p) => p.clone()),

      this.totalTurns

    );

    cloned.winningTeam = this.winningTeam;

    cloned.checkersHopPosition = this.checkersHopPosition?.clone();

    return cloned;

  }

}


