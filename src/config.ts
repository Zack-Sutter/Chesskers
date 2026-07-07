// Server endpoints. In dev these stay empty/relative so Vite's proxy
// (see vite.config.ts) forwards to the local server without CORS.
// In production set VITE_API_URL / VITE_WS_URL to the Railway service.
export const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

export function wsUrl(): string {
  const env = import.meta.env.VITE_WS_URL as string | undefined;
  if (env) return env;
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/ws`;
}
