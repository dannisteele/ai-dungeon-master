import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/server/config";

describe("loadConfig", () => {
  it("requires TABLE_PASSWORD", () => {
    expect(() => loadConfig({})).toThrow(/TABLE_PASSWORD/);
    expect(() => loadConfig({ TABLE_PASSWORD: "   " })).toThrow(/TABLE_PASSWORD/);
  });

  it("applies defaults", () => {
    expect(loadConfig({ TABLE_PASSWORD: "dragon" })).toEqual({
      tablePassword: "dragon",
      port: 3000,
      host: "0.0.0.0",
      ollamaUrl: "http://localhost:11434",
      ollamaModel: "qwen3.6:27b",
      ollamaKeepAlive: "30m",
      dbPath: "./data/game.sqlite",
      promptBudgetTokens: 12000,
    });
  });

  it("reads overrides and strips a trailing slash from OLLAMA_URL", () => {
    const c = loadConfig({
      TABLE_PASSWORD: "x", PORT: "8080", OLLAMA_URL: "http://192.168.1.20:11434/",
      OLLAMA_MODEL: "qwen3.5:9b", OLLAMA_KEEP_ALIVE: "5m", PROMPT_BUDGET_TOKENS: "8000",
    });
    expect(c.port).toBe(8080);
    expect(c.ollamaUrl).toBe("http://192.168.1.20:11434");
    expect(c.ollamaModel).toBe("qwen3.5:9b");
    expect(c.ollamaKeepAlive).toBe("5m");
    expect(c.promptBudgetTokens).toBe(8000);
  });

  it("rejects a bad port or budget", () => {
    expect(() => loadConfig({ TABLE_PASSWORD: "x", PORT: "abc" })).toThrow(/PORT/);
    expect(() => loadConfig({ TABLE_PASSWORD: "x", PORT: "70000" })).toThrow(/PORT/);
    expect(() => loadConfig({ TABLE_PASSWORD: "x", PROMPT_BUDGET_TOKENS: "100" })).toThrow(/PROMPT_BUDGET_TOKENS/);
  });
});
