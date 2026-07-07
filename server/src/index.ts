import Fastify from "fastify";
import { WebSocketServer } from "ws";
import { registerRoutes } from "./routes.js";

const port = Number(process.env.PORT) || 3001;

const app = Fastify({ logger: true });
await registerRoutes(app);
await app.ready();

// ponytail: WS scaffold only — move handlers land in S1-3
const wss = new WebSocketServer({ server: app.server });
wss.on("connection", () => {});

await app.listen({ port, host: "0.0.0.0" });
