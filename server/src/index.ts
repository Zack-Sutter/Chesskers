import Fastify from "fastify";
import { WebSocketServer } from "ws";
import { registerRoutes, rooms } from "./routes.js";
import { attachWebSocketHandlers } from "./ws.js";

const port = Number(process.env.PORT) || 3001;

const app = Fastify({ logger: true });
await registerRoutes(app);
await app.ready();

const wss = new WebSocketServer({ server: app.server });
attachWebSocketHandlers(wss, rooms);

await app.listen({ port, host: "0.0.0.0" });
