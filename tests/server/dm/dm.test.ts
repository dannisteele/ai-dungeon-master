import { describe, expect, it } from "vitest";
import { createDungeonMaster, DmError } from "../../../src/server/dm/dm";
import type { DmContext } from "../../../src/server/dm/context";
import { OllamaError, type ChatClient, type ChatRequest } from "../../../src/server/dm/ollama";
import { lightRules } from "../../../src/server/rules/engine";

class FakeChat implements ChatClient {
  requests: ChatRequest[] = [];
  constructor(private replies: (string | Error)[]) {}
  async chat(req: ChatRequest) {
    this.requests.push(req);
    const next = this.replies.shift();
    if (next === undefined) throw new Error("no more scripted replies");
    if (next instanceof Error) throw next;
    // stream in 3-char pieces to exercise the extractor
    for (let i = 0; i < next.length; i += 3) req.onToken?.(next.slice(i, i + 3));
    return next;
  }
  async unload() {}
}

const ctx: DmContext = {
  campaign: { id: 1, title: "T", mode: "solo", setting: "S", pitch: "", outline: null, sceneTitle: "", summary: "", roundState: "resolving", roundNumber: 1, stalledPhase: null, createdAt: "", updatedAt: "" },
  characters: [], npcs: [], recentRounds: [],
};
const make = (replies: (string | Error)[]) => {
  const chat = new FakeChat(replies);
  return { chat, dm: createDungeonMaster({ chat, rules: lightRules, budgetTokens: 12000 }) };
};
const recorder = () => {
  const r = { chunks: [] as string[], restarts: 0 };
  return { r, handlers: { onChunk: (t: string) => r.chunks.push(t), onRestart: () => { r.restarts++; } } };
};

describe("DungeonMaster", () => {
  it("adjudicates", async () => {
    const { dm, chat } = make(['{"checks":[{"character":"Wren","ability":"DEX","dc":14,"reason":"slippery"}]}']);
    expect(await dm.adjudicate(ctx, [{ character: "Wren", text: "I leap" }])).toEqual([{ character: "Wren", ability: "DEX", dc: 14, reason: "slippery" }]);
    expect(chat.requests[0].format).toHaveProperty("type", "object");
  });

  it("streams narration and returns raw changes for the rules engine to validate", async () => {
    const { dm } = make([JSON.stringify({ narration: "The door gives way.", changes: [{ op: "damage", character: "Wren", amount: 2 }, { op: "bogus" }] })]);
    const { r, handlers } = recorder();
    const out = await dm.resolve(ctx, { actions: [], skipped: [], rolls: [] }, handlers);
    expect(out.narration).toBe("The door gives way.");
    expect(out.changes).toHaveLength(2);
    expect(r.chunks.join("")).toBe("The door gives way.");
  });

  it("retries once with the validation error, signalling a restart", async () => {
    const { dm, chat } = make(['{"narration": "", "changes": []}', '{"narration":"Second try.","changes":[]}']);
    const { r, handlers } = recorder();
    const out = await dm.resolve(ctx, { actions: [], skipped: [], rolls: [] }, handlers);
    expect(out.narration).toBe("Second try.");
    expect(r.restarts).toBe(1);
    expect(chat.requests).toHaveLength(2);
    expect(chat.requests[1].messages.at(-1)!.content).toMatch(/not valid/);
  });

  it("retries on invalid JSON", async () => {
    const { dm } = make(["not json at all", '{"checks":[]}']);
    expect(await dm.adjudicate(ctx, [])).toEqual([]);
  });

  it("gives up with DmError after two bad replies", async () => {
    const { dm } = make(["nope", "still nope"]);
    await expect(dm.adjudicate(ctx, [])).rejects.toThrow(DmError);
  });

  it("does not retry when Ollama is unreachable", async () => {
    const { dm, chat } = make([new OllamaError("Could not reach Ollama"), '{"checks":[]}']);
    await expect(dm.adjudicate(ctx, [])).rejects.toThrow(/Could not reach Ollama/);
    expect(chat.requests).toHaveLength(1);
  });

  it("caps the starting kit at 5 items", async () => {
    const items = Array.from({ length: 7 }, (_, i) => ({ name: `Item ${i}`, description: "d" }));
    const { dm } = make([JSON.stringify({ items })]);
    expect(await dm.startingKit({ name: "Wren", concept: "scout", setting: "S" })).toHaveLength(5);
  });

  it("summarises", async () => {
    const { dm } = make(['{"summary":"They won."}']);
    expect(await dm.summarise("", [{ round: 1, lines: ["DM: x"] }])).toBe("They won.");
  });

  it("revives with a streamed narration", async () => {
    const { dm } = make(['{"narration":"You wake in a cell.","changes":[{"op":"set_scene","title":"The Cells"}]}']);
    const { r, handlers } = recorder();
    const out = await dm.revive(ctx, handlers);
    expect(out.narration).toBe("You wake in a cell.");
    expect(r.chunks.join("")).toBe("You wake in a cell.");
  });
});
