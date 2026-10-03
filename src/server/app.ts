import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { registerAuth } from "./auth/plugin";
import { loadAdventures } from "./campaigns/adventures";
import type { Config } from "./config";
import type { DungeonMaster } from "./dm/dm";
import type { ChatClient } from "./dm/ollama";
import { Hub } from "./realtime/hub";
import { registerApi } from "./routes/api";
import { registerWs } from "./routes/ws";
import { rollD20, type D20 } from "./rules/dice";
import { lightRules, type RulesEngine } from "./rules/engine";
import type { Store } from "./store/store";
import { TurnService } from "./turns/turns";

export interface AppDeps {
  config: Config; store: Store; dm: DungeonMaster; chat: ChatClient;
  rules?: RulesEngine; dice?: D20; serveClient?: boolean; serverSecret?: string;
}

const CLIENT_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../dist/client");

export async function buildApp(deps: AppDeps): Promise<{ app: FastifyInstance; turns: TurnService; hub: Hub }> {
  const rules = deps.rules ?? lightRules;
  const hub = new Hub();
  const turns = new TurnService({ store: deps.store, rules, dm: deps.dm, hub, dice: deps.dice ?? rollD20 });
  const app = Fastify({ logger: deps.serveClient ? { level: "info" } : false });

  const serverSecret = deps.serverSecret ?? randomBytes(32).toString("hex");
  await registerAuth(app, { password: deps.config.tablePassword, serverSecret });
  await app.register(websocket);
  await registerApi(app, { store: deps.store, rules, dm: deps.dm, chat: deps.chat, turns, adventures: loadAdventures() });
  await registerWs(app, { store: deps.store, rules, turns, hub });

  if (deps.serveClient) {
    if (!existsSync(CLIENT_DIR)) throw new Error("No built client found. Run `npm run build` first.");
    await app.register(fastifyStatic, { root: CLIENT_DIR });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/api/")) return reply.sendFile("index.html");
      return reply.code(404).send({ error: "Not found" });
    });
  }
  return { app, turns, hub };
}
