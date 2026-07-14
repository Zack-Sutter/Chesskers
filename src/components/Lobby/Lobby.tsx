import { useState } from "react";
import { TeamType } from "game-engine";
import { API_URL } from "../../config";
import "./Lobby.css";

type EngineMode = "human" | "engine";

interface Props {
  onPlayLocal: () => void;
  onPlayEngine: (gameId: string, engineColors: TeamType[]) => void;
}

const DEFAULT_THINK_MS = 2000;
const DEFAULT_DEPTH = 4;

function clamp(n: number, min: number, max: number): number {
  return Math.min(Math.max(n, min), max);
}

function oppositeColor(color: TeamType): TeamType {
  return color === TeamType.OUR ? TeamType.OPPONENT : TeamType.OUR;
}

function sideConfig(
  model: string,
  thinkMs: number,
  depth: number
): Record<string, unknown> {
  const cfg: Record<string, unknown> = {
    thinkMs: clamp(thinkMs, 100, 30000),
    depth: clamp(depth, 1, 12),
  };
  if (model.trim()) cfg.model = model.trim();
  return cfg;
}

export default function Lobby({ onPlayLocal, onPlayEngine }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [engineMode, setEngineMode] = useState<EngineMode>("human");
  const [humanColor, setHumanColor] = useState<TeamType>(TeamType.OUR);
  const [thinkMs, setThinkMs] = useState(DEFAULT_THINK_MS);
  const [depth, setDepth] = useState(DEFAULT_DEPTH);
  const [whiteModel, setWhiteModel] = useState("");
  const [blackModel, setBlackModel] = useState("");

  async function startEngineGame() {
    setBusy(true);
    setError(null);
    try {
      const created = await fetch(`${API_URL}/games`, { method: "POST" });
      if (!created.ok) throw new Error("Could not create a game");
      const { gameId } = (await created.json()) as { gameId: string };

      const resolvedThinkMs = clamp(thinkMs, 100, 30000);
      const resolvedDepth = clamp(depth, 1, 12);
      const body =
        engineMode === "human"
          ? {
              engineColor: oppositeColor(humanColor),
              ...sideConfig(
                humanColor === TeamType.OUR ? blackModel : whiteModel,
                resolvedThinkMs,
                resolvedDepth
              ),
            }
          : {
              white: sideConfig(whiteModel, resolvedThinkMs, resolvedDepth),
              black: sideConfig(blackModel, resolvedThinkMs, resolvedDepth),
            };

      const enabled = await fetch(`${API_URL}/games/${gameId}/engine`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!enabled.ok) {
        const resBody = (await enabled.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(resBody.error ?? "Could not enable the engine");
      }

      const engineColors =
        engineMode === "human"
          ? [oppositeColor(humanColor)]
          : [TeamType.OUR, TeamType.OPPONENT];
      onPlayEngine(gameId, engineColors);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const colorLabel = humanColor === TeamType.OUR ? "White" : "Black";
  const engineModel =
    engineMode === "human"
      ? humanColor === TeamType.OUR
        ? blackModel
        : whiteModel
      : null;
  const setEngineModel = (value: string) => {
    if (engineMode === "human") {
      if (humanColor === TeamType.OUR) setBlackModel(value);
      else setWhiteModel(value);
    }
  };

  return (
    <div className="lobby">
      <h1>Chesskers</h1>
      <div className="lobby-buttons">
        <button onClick={onPlayLocal} disabled={busy}>
          Play locally (hot-seat)
        </button>

        <fieldset className="lobby-settings" disabled={busy}>
          <legend>Engine game</legend>
          <label className="lobby-field">
            <span>Mode</span>
            <div className="lobby-color-options">
              <label>
                <input
                  type="radio"
                  name="engineMode"
                  checked={engineMode === "human"}
                  onChange={() => setEngineMode("human")}
                />
                Vs Engine
              </label>
              <label>
                <input
                  type="radio"
                  name="engineMode"
                  checked={engineMode === "engine"}
                  onChange={() => setEngineMode("engine")}
                />
                Engine vs Engine
              </label>
            </div>
          </label>
          {engineMode === "human" && (
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
          )}
          {engineMode === "human" ? (
            <label className="lobby-field">
              <span>Engine model (optional)</span>
              <input
                type="text"
                placeholder="server default"
                value={engineModel ?? ""}
                onChange={(e) => setEngineModel(e.target.value)}
              />
            </label>
          ) : (
            <>
              <label className="lobby-field">
                <span>White model (optional)</span>
                <input
                  type="text"
                  placeholder="WHITE_MODEL_PATH"
                  value={whiteModel}
                  onChange={(e) => setWhiteModel(e.target.value)}
                />
              </label>
              <label className="lobby-field">
                <span>Black model (optional)</span>
                <input
                  type="text"
                  placeholder="BLACK_MODEL_PATH"
                  value={blackModel}
                  onChange={(e) => setBlackModel(e.target.value)}
                />
              </label>
            </>
          )}
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
          {busy
            ? "Starting…"
            : engineMode === "human"
              ? `Play vs Engine (you are ${colorLabel})`
              : "Watch Engine vs Engine"}
        </button>
      </div>
      {error && <p className="lobby-error">{error}</p>}
    </div>
  );
}
