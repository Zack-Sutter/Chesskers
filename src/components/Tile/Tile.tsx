import "./Tile.css";
import { OUTSIDE_PLAY_AREA_OPACITY } from "../../Constants";

interface Props {
  image?: string;
  number: number;
  highlight: boolean;
  moveHighlight?: boolean;
  isPlayArea: boolean;
}

export default function Tile({ number, image, highlight, moveHighlight, isPlayArea }: Props) {
  const className: string = ["tile",
    number % 2 === 0 && "black-tile",
    number % 2 !== 0 && "white-tile",
    highlight && "tile-highlight",
    moveHighlight && "tile-last-move",
    image && "chess-piece-tile"].filter(Boolean).join(' ');

  return (
    <div
      className={className}
      style={isPlayArea ? undefined : { opacity: OUTSIDE_PLAY_AREA_OPACITY }}
    >
      {image && <div style={{ backgroundImage: `url(${image})` }} className="chess-piece"></div>}
    </div>
  );
}