export interface Config {
  tablePassword: string;
  port: number;
  host: string;
  ollamaUrl: string;
  ollamaModel: string;
  ollamaKeepAlive: string;
  dbPath: string;
  /** Ollama's context window (num_ctx). Smaller uses less graphics memory, so more of the model fits on the card. */
  ollamaNumCtx: number;
  promptBudgetTokens: number;
  /** Fine-grained token with Issues: write on githubRepo. Unset hides the feedback button. */
  githubToken?: string;
  githubRepo: string;
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
  const ollamaNumCtx = intFrom(env, "OLLAMA_NUM_CTX", 16384, 4096, 262144);
  // The prompt must leave room in the context for the DM's reply. Unless set, it scales with
  // the context: 12000 of the default 16384, 6144 of 8192.
  const promptBudgetTokens = intFrom(env, "PROMPT_BUDGET_TOKENS", Math.min(12000, Math.floor(ollamaNumCtx * 0.75)), 2000, 200000);
  if (promptBudgetTokens > ollamaNumCtx - 2048) {
    throw new Error(`PROMPT_BUDGET_TOKENS (${promptBudgetTokens}) must be at least 2048 below OLLAMA_NUM_CTX (${ollamaNumCtx}), to leave room for the reply`);
  }
  return {
    tablePassword,
    port: intFrom(env, "PORT", 3000, 1, 65535),
    host: env.HOST || "0.0.0.0",
    ollamaUrl: (env.OLLAMA_URL || "http://localhost:11434").replace(/\/+$/, ""),
    ollamaModel: env.OLLAMA_MODEL || "qwen3.6:27b",
    ollamaKeepAlive: env.OLLAMA_KEEP_ALIVE || "30m",
    dbPath: env.DB_PATH || "./data/game.sqlite",
    ollamaNumCtx,
    promptBudgetTokens,
    githubToken: env.GITHUB_TOKEN?.trim() || undefined,
    githubRepo: env.GITHUB_REPO?.trim() || "dannisteele/ai-dungeon-master",
  };
}
