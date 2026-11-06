import { describe, expect, it } from "vitest";
import { askHelp, helpMessages, loadManual } from "../../../src/server/help/help";
import type { ChatClient, ChatRequest } from "../../../src/server/dm/ollama";

describe("help", () => {
  it("answers from the manual only, with the conversation so far and the question last", () => {
    const msgs = helpMessages("# How to play\n- Press **Act**.", "How do I act?", [
      { role: "user", content: "Hi" }, { role: "assistant", content: "Hello! Ask me about the game." },
    ]);
    expect(msgs[0].role).toBe("system");
    expect(msgs[0].content).toContain("- Press **Act**.");
    expect(msgs[0].content).toContain("Answer only from the manual");
    expect(msgs.slice(1).map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(msgs.at(-1)!.content).toBe("How do I act?");
  });

  it("keeps only the last few exchanges", () => {
    const history = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? "assistant" as const : "user" as const, content: `m${i}` }));
    expect(helpMessages("m", "q", history)).toHaveLength(1 + 6 + 1);
  });

  it("returns the model's answer", async () => {
    const requests: ChatRequest[] = [];
    const chat = { chat: async (r: ChatRequest) => { requests.push(r); return '{"answer":"Press Act."}'; } } as unknown as ChatClient;
    expect(await askHelp(chat, "manual", "How?", [])).toBe("Press Act.");
    expect(requests[0].format).toHaveProperty("type", "object");
  });

  it("ships a manual that covers the new features", () => {
    const manual = loadManual();
    for (const words of ["Try again", "Edit", "Table settings", "Story so far", "People", "Check for Updates"]) expect(manual).toContain(words);
  });
});
