import { useState } from "react";
import { TeamType } from "game-engine";
import { API_URL } from "../../config";
import "./Lobby.css";

interface Props {
  onPlayLocal: () => void;
  onPlayEngine: (gameId: string, engineColor: TeamType) => void;
}

export default function Lobby({ onPlayLocal, onPlayEngine }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startEngineGame() {
    setBusy(true);
    setError(null);
    try {
      const created = await fetch(`${API_URL}/games`, { method: "POST" });
      if (!created.ok) throw new Error("Could not create a game");
      const { gameId } = (await created.json()) as { gameId: string };

      // The human plays White (chess army); the engine plays Black (checkers).
      const engineColor = TeamType.OPPONENT;
      const enabled = await fetch(`${API_URL}/games/${gameId}/engine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ engineColor }),
      });
      if (!enabled.ok) {
        const body = (await enabled.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error ?? "Could not enable the engine");
      }

      onPlayEngine(gameId, engineColor);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lobby">
      <h1>Chesskers</h1>
      <div className="lobby-buttons">
        <button onClick={onPlayLocal} disabled={busy}>
          Play locally (hot-seat)
        </button>
        <button onClick={startEngineGame} disabled={busy}>
          {busy ? "Starting…" : "Play vs Engine (you are White)"}
        </button>
      </div>
      {error && <p className="lobby-error">{error}</p>}
    </div>
  );
}
