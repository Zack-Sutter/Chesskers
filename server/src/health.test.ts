import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerRoutes } from "./routes.js";

describe("GET /health", () => {
  it("returns { ok: true }", async () => {
    const app = Fastify();
    await registerRoutes(app);
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    await app.close();
  });
});
