import { networkInterfaces } from "node:os";
import { dirname, join } from "node:path";
import { buildApp } from "./app";
import { loadOrCreateServerSecret } from "./auth/password";
import { loadConfig } from "./config";
import { createDungeonMaster } from "./dm/dm";
import { createOllamaClient } from "./dm/ollama";
import { lightRules } from "./rules/engine";
import { MODEL_SETTING } from "./routes/api";
import { createStore } from "./store/store";

try { process.loadEnvFile(); } catch { /* no .env file: rely on the environment */ }

const config = loadConfig();
const store = createStore(config.dbPath);
const serverSecret = loadOrCreateServerSecret(join(dirname(config.dbPath), "cookie-secret"));
// A model picked in the app wins over OLLAMA_MODEL, which is only the starting default.
const model = store.getSetting(MODEL_SETTING) ?? config.ollamaModel;
const chat = createOllamaClient({ url: config.ollamaUrl, model, keepAlive: config.ollamaKeepAlive, numCtx: config.ollamaNumCtx });
const dm = createDungeonMaster({ chat, rules: lightRules, budgetTokens: config.promptBudgetTokens });
const { app, turns } = await buildApp({ config, store, dm, chat, serverSecret, serveClient: process.env.NODE_ENV === "production" || process.argv.includes("--production") });

turns.recoverInterrupted();
await app.listen({ port: config.port, host: config.host });

const lan = Object.values(networkInterfaces()).flat()
  .filter((n) => n && n.family === "IPv4" && !n.internal)
  .map((n) => `  http://${n!.address}:${config.port}`);
console.log(`\n🕯  The table is open.\n  http://localhost:${config.port}\n${lan.join("\n")}\n  Dungeon Master: ${chat.getModel()} at ${config.ollamaUrl}\n`);

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  // Backstop: if something still keeps the server from closing (a leaked socket we didn't
  // anticipate, a stuck background task), don't hang the process forever on Ctrl-C.
  setTimeout(() => process.exit(1), 5000).unref();
  await app.close();
  store.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
