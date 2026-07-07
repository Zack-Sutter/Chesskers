import { spawn } from "node:child_process";
import { serializeBoard, type Board, type Move } from "game-engine";
import type { EngineConfig } from "./routes.js";

// ponytail: spawn the Rust `best-move` binary per request (child process, not
// linked crate — Node can't link a Rust crate without a native addon). Ceiling:
// one process per move; upgrade path is a long-lived engine process or N-API addon.
export function runBestMove(board: Board, engine: EngineConfig): Promise<Move> {
  const binary = process.env.ENGINE_BINARY_PATH || "chesskers-engine";
  const args = [
    "best-move",
    "--model",
    engine.model,
    "--think-ms",
    String(engine.thinkMs),
  ];
  if (engine.depth !== undefined) args.push("--depth", String(engine.depth));

  return new Promise((resolve, reject) => {
    const child = spawn(binary, args);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => {
      let parsed: { move?: Move; error?: string };
      try {
        parsed = JSON.parse(stdout);
      } catch {
        reject(
          new Error(`engine returned invalid JSON (exit ${code}): ${stderr || stdout}`)
        );
        return;
      }
      if (parsed.error || !parsed.move) {
        reject(new Error(parsed.error ?? "engine returned no move"));
        return;
      }
      resolve(parsed.move);
    });
    child.stdin.write(JSON.stringify(serializeBoard(board)));
    child.stdin.end();
  });
}
