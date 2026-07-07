import { useRef, useState } from "react";

import { initialBoard } from "game-engine";

import {
  Board,
  Piece,
  Position,
  Pawn,
  PieceType,
  TeamType,
  getSingleJumpMoves,
  isCheckersJump,
} from "game-engine";

import Chessboard from "../Chessboard/Chessboard";

import { Howl } from "howler";



const moveSound = new Howl({

  src: ["/sounds/move-self.mp3"],

});



const captureSound = new Howl({

  src: ["/sounds/capture.mp3"],

});



const checkmateSound = new Howl({

  src: ["/sounds/move-check.mp3"],

});



export default function Referee() {

  const [board, setBoard] = useState<Board>(initialBoard.clone());

  const [promotionPawn, setPromotionPawn] = useState<Piece>();

  const modalRef = useRef<HTMLDivElement>(null);

  const gameOverModalRef = useRef<HTMLDivElement>(null);



  function playMove(playedPiece: Piece, destination: Position): boolean {

    if (playedPiece.possibleMoves === undefined) return false;



    if (board.checkersHopPosition) {

      if (!playedPiece.samePosition(board.checkersHopPosition)) return false;

    } else if (playedPiece.team === TeamType.OUR && board.totalTurns % 2 !== 1) {

      return false;

    } else if (

      playedPiece.team === TeamType.OPPONENT &&

      board.totalTurns % 2 !== 0

    ) {

      return false;

    }



    let playedMoveIsValid = false;



    const validMove = playedPiece.possibleMoves?.some((m) =>

      m.samePosition(destination)

    );



    if (!validMove) return false;



    const enPassantMove = isEnPassantMove(

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

        board.pieces,

        playedPiece.team

      );

    const isCapture =

      enPassantMove ||

      checkersJump ||

      board.pieces.some(

        (p) =>

          p.samePosition(destination) && p.team !== playedPiece.team

      );



    setBoard((prev) => {

      const clonedBoard = prev.clone();

      playedMoveIsValid = clonedBoard.playMove(

        enPassantMove,

        validMove,

        playedPiece,

        destination

      );



      if (!playedMoveIsValid) return prev;

      if (clonedBoard.winningTeam === undefined) {
        if (playedPiece.isCheckers && checkersJump) {

          const movedCheckers = clonedBoard.pieces.find(

            (p) =>

              p.isCheckers &&

              p.team === playedPiece.team &&

              p.samePosition(destination)

          );

          const moreJumps =

            movedCheckers !== undefined &&

            getSingleJumpMoves(movedCheckers, clonedBoard.pieces).length > 0;



          if (moreJumps) {

            clonedBoard.checkersHopPosition = destination.clone();

          } else {

            clonedBoard.checkersHopPosition = undefined;

            clonedBoard.totalTurns += 1;

          }

        } else {
          clonedBoard.checkersHopPosition = undefined;
          clonedBoard.totalTurns += 1;
        }
      }

      clonedBoard.calculateAllMoves();

      if (isCapture) {

        captureSound.play();

      } else {

        moveSound.play();

      }



      if (clonedBoard.winningTeam !== undefined) {

        gameOverModalRef.current?.classList.remove("hidden");

        checkmateSound.play();

      }



      return clonedBoard;

    });



    const promotionRow = playedPiece.team === TeamType.OUR ? 7 : 0;



    if (destination.y === promotionRow && playedPiece.isPawn) {

      modalRef.current?.classList.remove("hidden");

      setPromotionPawn(() => {

        const clonedPlayedPiece = playedPiece.clone();

        clonedPlayedPiece.position = destination.clone();

        return clonedPlayedPiece;

      });

    }



    return playedMoveIsValid;

  }



  function isEnPassantMove(

    initialPosition: Position,

    desiredPosition: Position,

    type: PieceType,

    team: TeamType

  ) {

    const pawnDirection = team === TeamType.OUR ? 1 : -1;



    if (type === PieceType.PAWN) {

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

        if (piece) {

          return true;

        }

      }

    }



    return false;

  }



  function promotePawn(pieceType: PieceType) {

    if (promotionPawn === undefined) {

      return;

    }



    setBoard((previousBoard) => {

      const clonedBoard = previousBoard.clone();

      clonedBoard.pieces = clonedBoard.pieces.reduce((results, piece) => {

        if (piece.samePiecePosition(promotionPawn)) {

          results.push(

            new Piece(piece.position.clone(), pieceType, piece.team, true)

          );

        } else {

          results.push(piece);

        }

        return results;

      }, [] as Piece[]);



      clonedBoard.calculateAllMoves();



      return clonedBoard;

    });



    modalRef.current?.classList.add("hidden");

  }



  function promotionTeamType() {

    return promotionPawn?.team === TeamType.OUR ? "w" : "b";

  }



  function restartGame() {

    gameOverModalRef.current?.classList.add("hidden");

    setBoard(initialBoard.clone());

  }



  function gameOverMessage(): string {

    if (board.winningTeam === TeamType.OPPONENT) {

      return "Black wins — white king jumped and burgled!";

    }

    return "White wins — all black pieces captured!";

  }



  return (

    <>

      <p style={{ color: "white", fontSize: "14px", textAlign: "center" }}>

        Total turns: {board.totalTurns}

      </p>

      <div className="modal hidden" ref={modalRef}>

        <div className="modal-body">

          <img

            alt="Promote to Rook"

            onClick={() => promotePawn(PieceType.ROOK)}

            src={`/assets/images/rook_${promotionTeamType()}.png`}

          />

          <img

            alt="Promote to Bishop"

            onClick={() => promotePawn(PieceType.BISHOP)}

            src={`/assets/images/bishop_${promotionTeamType()}.png`}

          />

          <img

            alt="Promote to Knight"

            onClick={() => promotePawn(PieceType.KNIGHT)}

            src={`/assets/images/knight_${promotionTeamType()}.png`}

          />

          <img

            alt="Promote to Queen"

            onClick={() => promotePawn(PieceType.QUEEN)}

            src={`/assets/images/queen_${promotionTeamType()}.png`}

          />

        </div>

      </div>

      <div className="modal hidden" ref={gameOverModalRef}>

        <div className="modal-body">

          <div className="checkmate-body">

            <span>{gameOverMessage()}</span>

            <button onClick={restartGame}>Play again</button>

          </div>

        </div>

      </div>

      <div className="board-viewport">
        <Chessboard
          playMove={playMove}
          pieces={board.pieces}
          hopContinuationPosition={board.checkersHopPosition}
        />
      </div>

    </>

  );

}

