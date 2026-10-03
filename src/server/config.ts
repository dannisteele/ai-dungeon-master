export interface Config {
  tablePassword: string;
  port: number;
  host: string;
  ollamaUrl: string;
  ollamaModel: string;
  ollamaKeepAlive: string;
  dbPath: string;
  promptBudgetTokens: number;
}

function intFrom(env: NodeJS.ProcessEnv, key: string, fallback: number, min: number, max: number): number {
  const raw = env[key];
  const value = raw === undefined || raw === "" ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${key} must be a whole number between ${min} and ${max}, got "${raw}"`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const tablePassword = env.TABLE_PASSWORD?.trim();
  if (!tablePassword) {
    throw new Error("TABLE_PASSWORD must be set: it is the shared password for your table (see .env.example)");
  }
  return {
    tablePassword,
    port: intFrom(env, "PORT", 3000, 1, 65535),
    host: env.HOST || "0.0.0.0",
    ollamaUrl: (env.OLLAMA_URL || "http://localhost:11434").replace(/\/+$/, ""),
    ollamaModel: env.OLLAMA_MODEL || "qwen3.6:27b",
    ollamaKeepAlive: env.OLLAMA_KEEP_ALIVE || "30m",
    dbPath: env.DB_PATH || "./data/game.sqlite",
    promptBudgetTokens: intFrom(env, "PROMPT_BUDGET_TOKENS", 12000, 2000, 200000),
  };
}
