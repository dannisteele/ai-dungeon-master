import cookie from "@fastify/cookie";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { isPrivateAddress } from "./lan";
import { cookieSecret, LoginRateLimiter, passwordMatches } from "./password";

const COOKIE = "table";
const OPEN_PATHS = new Set(["/api/login", "/api/session"]);

export async function registerAuth(app: FastifyInstance, opts: { password: string }): Promise<void> {
  await app.register(cookie, { secret: cookieSecret(opts.password) });
  const limiter = new LoginRateLimiter();

  const isAuthed = (req: FastifyRequest) => {
    const raw = req.cookies[COOKIE];
    if (!raw) return false;
    const unsigned = req.unsignCookie(raw);
    return unsigned.valid && unsigned.value === "ok";
  };

  app.addHook("onRequest", async (req, reply) => {
    if (!isPrivateAddress(req.ip)) {
      return reply.code(403).send({ error: "This table is only open on the home network." });
    }
    const path = req.url.split("?")[0];
    const needsAuth = (path.startsWith("/api/") && !OPEN_PATHS.has(path)) || path === "/ws";
    if (needsAuth && !isAuthed(req)) {
      return reply.code(401).send({ error: "Enter the table password." });
    }
  });

  app.get("/api/session", async (req) => ({ authed: isAuthed(req) }));

  app.post<{ Body: { password?: unknown } }>("/api/login", async (req, reply) => {
    if (limiter.isBlocked(req.ip)) {
      return reply.code(429).send({ error: "Too many wrong guesses. Try again in a few minutes." });
    }
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!passwordMatches(password, opts.password)) {
      limiter.recordFailure(req.ip);
      return reply.code(401).send({ error: "That's not the password." });
    }
    limiter.reset(req.ip);
    reply.setCookie(COOKIE, "ok", { signed: true, httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
    return { ok: true };
  });
}
