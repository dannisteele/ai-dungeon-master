import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerAuth } from "../../../src/server/auth/plugin";
import { cookieSecret } from "../../../src/server/auth/password";
import { createHmac } from "node:crypto";

async function app(serverSecret: string = "test-server-secret") {
  const a = Fastify();
  await registerAuth(a, { password: "dragon", serverSecret });
  a.get("/api/secret", async () => ({ ok: true }));
  a.get("/", async () => "page");
  return a;
}
const LAN = "192.168.1.10";

describe("auth plugin", () => {
  it("blocks non-LAN addresses everywhere", async () => {
    const a = await app();
    const r = await a.inject({ method: "GET", url: "/", remoteAddress: "8.8.8.8" });
    expect(r.statusCode).toBe(403);
  });

  it("serves non-API pages on the LAN without login", async () => {
    const a = await app();
    expect((await a.inject({ method: "GET", url: "/", remoteAddress: LAN })).statusCode).toBe(200);
  });

  it("requires the cookie for API routes", async () => {
    const a = await app();
    expect((await a.inject({ method: "GET", url: "/api/secret", remoteAddress: LAN })).statusCode).toBe(401);
    expect((await a.inject({ method: "GET", url: "/api/session", remoteAddress: LAN })).json()).toEqual({ authed: false });
  });

  it("logs in with the right password and remembers the device", async () => {
    const a = await app();
    const bad = await a.inject({ method: "POST", url: "/api/login", remoteAddress: LAN, payload: { password: "nope" } });
    expect(bad.statusCode).toBe(401);
    expect(bad.json().error).toMatch(/not the password/);

    const ok = await a.inject({ method: "POST", url: "/api/login", remoteAddress: LAN, payload: { password: "dragon" } });
    expect(ok.statusCode).toBe(200);
    const cookie = ok.cookies.find((c) => c.name === "table")!;
    expect(cookie.httpOnly).toBe(true);
    const headers = { cookie: `table=${cookie.value}` };
    expect((await a.inject({ method: "GET", url: "/api/secret", remoteAddress: LAN, headers })).json()).toEqual({ ok: true });
    expect((await a.inject({ method: "GET", url: "/api/session", remoteAddress: LAN, headers })).json()).toEqual({ authed: true });
  });

  it("rejects a forged cookie", async () => {
    const a = await app();
    const r = await a.inject({ method: "GET", url: "/api/secret", remoteAddress: LAN, headers: { cookie: "table=ok" } });
    expect(r.statusCode).toBe(401);
  });

  it("rate-limits repeated failures", async () => {
    const a = await app();
    for (let i = 0; i < 10; i++) await a.inject({ method: "POST", url: "/api/login", remoteAddress: LAN, payload: { password: "x" } });
    const r = await a.inject({ method: "POST", url: "/api/login", remoteAddress: LAN, payload: { password: "dragon" } });
    expect(r.statusCode).toBe(429);
  });

  it("rejects a cookie forged with a different server secret", async () => {
    const a = await app("correct-secret");
    const wrongSecret = cookieSecret("dragon", "wrong-secret");
    const value = "ok";
    const sig = createHmac("sha256", wrongSecret).update(value).digest("base64").replace(/=+$/, "");
    const forgedCookie = `${value}.${sig}`;
    const r = await a.inject({ method: "GET", url: "/api/secret", remoteAddress: LAN, headers: { cookie: `table=${forgedCookie}` } });
    expect(r.statusCode).toBe(401);
    const session = await a.inject({ method: "GET", url: "/api/session", remoteAddress: LAN, headers: { cookie: `table=${forgedCookie}` } });
    expect(session.json()).toEqual({ authed: false });
  });
});
