import { useState } from "react";
import { TeamType } from "game-engine";
import { API_URL } from "../../config";
import "./Lobby.css";

interface Props {
  onPlayLocal: () => void;
  onPlayEngine: (gameId: string, engineColor: TeamType) => void;
}

const DEFAULT_THINK_MS = 2000;
const DEFAULT_DEPTH = 4;

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

function oppositeColor(color: TeamType): TeamType {
  return color === TeamType.OUR ? TeamType.OPPONENT : TeamType.OUR;
}

export default function Lobby({ onPlayLocal, onPlayEngine }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [humanColor, setHumanColor] = useState<TeamType>(TeamType.OUR);
  const [thinkMs, setThinkMs] = useState(DEFAULT_THINK_MS);
  const [depth, setDepth] = useState(DEFAULT_DEPTH);

  async function startEngineGame() {
    setBusy(true);
    setError(null);
    try {
      const created = await fetch(`${API_URL}/games`, { method: "POST" });
      if (!created.ok) throw new Error("Could not create a game");
      const { gameId } = (await created.json()) as { gameId: string };

      const engineColor = oppositeColor(humanColor);
      const enabled = await fetch(`${API_URL}/games/${gameId}/engine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          engineColor,
          thinkMs: clamp(thinkMs, 100, 30000),
          depth: clamp(depth, 1, 12),
        }),
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

  const colorLabel = humanColor === TeamType.OUR ? "White" : "Black";

  return (
    <div className="lobby">
      <h1>Chesskers</h1>
      <div className="lobby-buttons">
        <button onClick={onPlayLocal} disabled={busy}>
          Play locally (hot-seat)
        </button>

        <fieldset className="lobby-settings" disabled={busy}>
          <legend>Vs Engine</legend>
          <label className="lobby-field">
            <span>Your color</span>
            <div className="lobby-color-options">
              <label>
                <input
                  type="radio"
                  name="humanColor"
                  checked={humanColor === TeamType.OUR}
                  onChange={() => setHumanColor(TeamType.OUR)}
                />
                White
              </label>
              <label>
                <input
                  type="radio"
                  name="humanColor"
                  checked={humanColor === TeamType.OPPONENT}
                  onChange={() => setHumanColor(TeamType.OPPONENT)}
                />
                Black
              </label>
            </div>
          </label>
          <label className="lobby-field">
            <span>Think time (ms)</span>
            <input
              type="number"
              min={100}
              max={30000}
              value={thinkMs}
              onChange={(e) => setThinkMs(Number(e.target.value))}
            />
          </label>
          <label className="lobby-field">
            <span>Search depth</span>
            <input
              type="number"
              min={1}
              max={12}
              value={depth}
              onChange={(e) => setDepth(Number(e.target.value))}
            />
          </label>
        </fieldset>

        <button onClick={startEngineGame} disabled={busy}>
          {busy ? "Starting…" : `Play vs Engine (you are ${colorLabel})`}
        </button>
      </div>
      {error && <p className="lobby-error">{error}</p>}
    </div>
  );
}
