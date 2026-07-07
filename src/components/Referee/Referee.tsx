import { useRef, useState } from "react";

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

    const result = applyMove(board, {

      from: {

        x: playedPiece.position.x,

        y: playedPiece.position.y,

      },

      to: { x: destination.x, y: destination.y },

    });



    if (!result.ok) {

      return false;

    }



    setBoard(result.board);



    if (result.isCapture) {

      captureSound.play();

    } else {

      moveSound.play();

    }



    if (result.board.winningTeam !== undefined) {

      gameOverModalRef.current?.classList.remove("hidden");

      checkmateSound.play();

    }



    if (result.pendingPromotion) {

      modalRef.current?.classList.remove("hidden");

      const promotedSquare = result.pendingPromotion;

      setPromotionPawn(() => {

        const pawn = result.board.pieces.find(

          (p) =>

            p.isPawn &&

            p.position.x === promotedSquare.x &&

            p.position.y === promotedSquare.y

        );

        return pawn?.clone();

      });

    }



    return true;

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
