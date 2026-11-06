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
  getModel() { return "m"; }
  setModel() {}
  async installedModels() { return ["m"]; }
  async isLoaded() { return true; }
}

const ctx: DmContext = {
  campaign: { id: 1, title: "T", mode: "solo", setting: "S", pitch: "", outline: null, sceneTitle: "", summary: "", pinnedSummary: "", dmNotes: "", realism: "fantastical", dice: "normal", roundState: "resolving", roundNumber: 1, stalledPhase: null, createdAt: "", updatedAt: "" },
  characters: [], people: [], recentRounds: [],
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

  it("retries when the changes were written into the narration instead of the changes list", async () => {
    // Seen from qwen3.5:9b in a real session: ops leaked into the story text, changes left empty.
    const leaked = JSON.stringify({
      narration: 'A shade blocks her path.\n\n[set_scene,title":"Lord Vane\'s Grand Hall"],[npc,name":"Smoking Shade","attitude":"hostile","condition":"unhurt"]',
      changes: [],
    });
    const fixed = JSON.stringify({ narration: "A shade blocks her path.", changes: [{ op: "set_scene", title: "Lord Vane's Grand Hall" }] });
    const { dm, chat } = make([leaked, fixed]);
    const { r, handlers } = recorder();
    const out = await dm.resolve(ctx, { actions: [], skipped: [], rolls: [] }, handlers);
    expect(out).toEqual({ narration: "A shade blocks her path.", changes: [{ op: "set_scene", title: "Lord Vane's Grand Hall" }] });
    expect(r.restarts).toBe(1);
    expect(chat.requests[1].messages.at(-1)!.content).toMatch(/changes/);
  });

  it("does not mistake ordinary story words for leaked changes", async () => {
    const story = "The guard's condition worsens; his attitude sours. She heals the scene of the crime with a damage-control smile.";
    const { dm, chat } = make([JSON.stringify({ narration: story, changes: [] })]);
    const { handlers } = recorder();
    expect((await dm.resolve(ctx, { actions: [], skipped: [], rolls: [] }, handlers)).narration).toBe(story);
    expect(chat.requests).toHaveLength(1);
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
    expect(await dm.startingKit({ name: "Wren", concept: "scout", setting: "S", realism: "fantastical" })).toHaveLength(5);
  });

  it("summarises", async () => {
    const { dm } = make(['{"summary":"They won."}']);
    expect(await dm.summarise("", [{ round: 1, lines: ["DM: x"] }])).toEqual({ summary: "They won.", people: [] });
    const withPeople = make(['{"summary":"They won.","people":[{"name":"Bell","about":"A baker."}]}']).dm;
    expect(await withPeople.summarise("", [], [{ name: "Bell", about: "" }])).toEqual({ summary: "They won.", people: [{ name: "Bell", about: "A baker." }] });
  });

  it("revives with a streamed narration", async () => {
    const { dm } = make(['{"narration":"You wake in a cell.","changes":[{"op":"set_scene","title":"The Cells"}]}']);
    const { r, handlers } = recorder();
    const out = await dm.revive(ctx, handlers);
    expect(out.narration).toBe("You wake in a cell.");
    expect(r.chunks.join("")).toBe("You wake in a cell.");
  });

  it("quotes the DM's last reply back and asks for something new, so a small model can't copy it", async () => {
    const { dm, chat } = make([JSON.stringify({ narration: "He shrugs.", changes: [] })]);
    const looped = { ...ctx, recentRounds: [{ round: 5, lines: ["Bill: Why are you here?", "DM: The accusation hangs heavy. 'I'm standing right here!' he says."] }] };
    await dm.resolve(looped, { actions: [], skipped: [], rolls: [] }, recorder().handlers);
    expect(chat.requests[0].messages[1].content).toContain(
      'Your previous reply began: "The accusation hangs heavy." This round\'s reply must say something new: start differently, don\'t reuse its sentences, and move the story forward.',
    );
  });

  it("asks for nothing extra when the DM hasn't spoken yet", async () => {
    const { dm, chat } = make([JSON.stringify({ narration: "It begins.", changes: [] })]);
    await dm.resolve(ctx, { actions: [], skipped: [], rolls: [] }, recorder().handlers);
    expect(chat.requests[0].messages[1].content).not.toContain("Your previous reply began");
  });

  it("reminds the DM of the players' wishes at the end of every reply's task", async () => {
    const { dm, chat } = make([JSON.stringify({ narration: "Fine.", changes: [] }), JSON.stringify({ narration: "Fine.", changes: [] })]);
    await dm.resolve({ ...ctx, campaign: { ...ctx.campaign, dmNotes: "More dialogue." } }, { actions: [], skipped: [], rolls: [] }, recorder().handlers);
    expect(chat.requests[0].messages[1].content.trimEnd().endsWith("Remember the players' wishes: More dialogue.")).toBe(true);
    await dm.opening({ ...ctx, campaign: { ...ctx.campaign, dmNotes: "More dialogue." } }, recorder().handlers);
    expect(chat.requests[1].messages[1].content.trimEnd().endsWith("Remember the players' wishes: More dialogue.")).toBe(true);
  });
});
