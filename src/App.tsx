import { useState } from "react";
import "./App.css";
import { TeamType } from "game-engine";
import Referee from "./components/Referee/Referee";
import Lobby from "./components/Lobby/Lobby";
import { useGameRoom } from "./hooks/useGameRoom";

type View =
  | { mode: "lobby" }
  | { mode: "local" }
  | { mode: "engine"; gameId: string; engineColors: TeamType[] };

function EngineGame({
  gameId,
  engineColors,
  onExit,
}: {
  gameId: string;
  engineColors: TeamType[];
  onExit: () => void;
}) {
  const room = useGameRoom(gameId, engineColors);
  return <Referee room={room} onExit={onExit} />;
}

function App() {
  const [view, setView] = useState<View>({ mode: "lobby" });
  const backToLobby = () => setView({ mode: "lobby" });

  return (
    <div id="app">
      {view.mode === "lobby" && (
        <Lobby
          onPlayLocal={() => setView({ mode: "local" })}
          onPlayEngine={(gameId, engineColors) =>
            setView({ mode: "engine", gameId, engineColors })
          }
        />
      )}
      {view.mode === "local" && <Referee onExit={backToLobby} />}
      {view.mode === "engine" && (
        <EngineGame
          gameId={view.gameId}
          engineColors={view.engineColors}
          onExit={backToLobby}
        />
      )}
    </div>
  );
}

export default App;
