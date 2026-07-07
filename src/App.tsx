import { useState } from "react";
import "./App.css";
import { TeamType } from "game-engine";
import Referee from "./components/Referee/Referee";
import Lobby from "./components/Lobby/Lobby";
import { useGameRoom } from "./hooks/useGameRoom";

type View =
  | { mode: "lobby" }
  | { mode: "local" }
  | { mode: "engine"; gameId: string; engineColor: TeamType };

function EngineGame({
  gameId,
  engineColor,
  onExit,
}: {
  gameId: string;
  engineColor: TeamType;
  onExit: () => void;
}) {
  const room = useGameRoom(gameId, engineColor);
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
          onPlayEngine={(gameId, engineColor) =>
            setView({ mode: "engine", gameId, engineColor })
          }
        />
      )}
      {view.mode === "local" && <Referee onExit={backToLobby} />}
      {view.mode === "engine" && (
        <EngineGame
          gameId={view.gameId}
          engineColor={view.engineColor}
          onExit={backToLobby}
        />
      )}
    </div>
  );
}

export default App;
