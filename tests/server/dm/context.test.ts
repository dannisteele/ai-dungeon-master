import { describe, expect, it } from "vitest";
import { buildContext, transcriptFromEvents } from "../../../src/server/dm/context";
import { createStore } from "../../../src/server/store/store";

const scores = { STR: 15, DEX: 10, CON: 10, INT: 8, WIS: 12, CHA: 8 };

describe("transcripts", () => {
  it("renders actions, skips, rolls and narration per round", () => {
    const store = createStore(":memory:");
    const c = store.createCampaign({ title: "T", mode: "party", setting: "S", pitch: "", outline: null });
    const corvin = store.createCharacter({ campaignId: c.id, name: "Corvin", concept: "knight", scores, hp: 20, maxHp: 20, items: [] });
    const wren = store.createCharacter({ campaignId: c.id, name: "Wren", concept: "scout", scores, hp: 20, maxHp: 20, items: [] });
    store.appendEvent(c.id, 0, { type: "narration", text: "Fog rolls in." });
    store.appendEvent(c.id, 1, { type: "action", characterId: corvin.id, text: "I kick the door" });
    store.appendEvent(c.id, 1, { type: "skip", characterId: wren.id, skippedBy: corvin.id });
    store.appendEvent(c.id, 1, { type: "check_request", characterId: corvin.id, ability: "STR", dc: 14, reason: "heavy door" });
    store.appendEvent(c.id, 1, { type: "roll", characterId: corvin.id, ability: "STR", die: 20, dc: 14, modifier: 2, total: 22, success: true, crit: "nat20" });
    store.appendEvent(c.id, 1, { type: "narration", text: "It bursts open." });

    const t = transcriptFromEvents(store.getEvents(c.id), store.getCharacters(c.id));
    expect(t).toEqual([
      { round: 0, lines: ["DM: Fog rolls in."] },
      { round: 1, lines: [
        "Corvin: I kick the door",
        "Wren holds back this round.",
        "[Roll] Corvin STR check: 20 +2 = 22 vs DC 14 (heavy door): success (natural 20)",
        "DM: It bursts open.",
      ] },
    ]);
  });

  it("renders op_applied events as sheet/scene lines", () => {
    const store = createStore(":memory:");
    const c = store.createCampaign({ title: "T", mode: "party", setting: "S", pitch: "", outline: null });
    store.appendEvent(c.id, 1, { type: "op_applied", op: { op: "damage", character: "Corvin", amount: 4 } });
    store.appendEvent(c.id, 1, { type: "op_applied", op: { op: "heal", character: "Corvin", amount: 2 } });
    store.appendEvent(c.id, 1, { type: "op_applied", op: { op: "add_item", character: "Corvin", name: "Rusty Key", description: "", qty: 1 } });
    store.appendEvent(c.id, 1, { type: "op_applied", op: { op: "add_item", character: "Corvin", name: "Torch", description: "", qty: 3 } });
    store.appendEvent(c.id, 1, { type: "op_applied", op: { op: "remove_item", character: "Corvin", name: "Torch", qty: 1 } });
    store.appendEvent(c.id, 1, { type: "op_applied", op: { op: "adjust_stat", character: "Corvin", stat: "STR", delta: 1 } });
    store.appendEvent(c.id, 1, { type: "op_applied", op: { op: "adjust_stat", character: "Corvin", stat: "STR", delta: -1 } });
    store.appendEvent(c.id, 1, { type: "op_applied", op: { op: "level_up", character: "Corvin" } });
    store.appendEvent(c.id, 1, { type: "op_applied", op: { op: "set_scene", title: "The Old Gate" } });

    const t = transcriptFromEvents(store.getEvents(c.id), store.getCharacters(c.id));
    expect(t).toEqual([
      { round: 1, lines: [
        "[Sheet] Corvin takes 4 damage",
        "[Sheet] Corvin heals 2",
        "[Sheet] Corvin gains Rusty Key",
        "[Sheet] Corvin gains Torch ×3",
        "[Sheet] Corvin loses Torch",
        "[Sheet] Corvin STR +1",
        "[Sheet] Corvin STR -1",
        "[Sheet] Corvin reaches a new level",
        "[Scene] The Old Gate",
      ] },
    ]);
  });

  it("buildContext includes only completed rounds within the window", () => {
    const store = createStore(":memory:");
    const c = store.createCampaign({ title: "T", mode: "solo", setting: "S", pitch: "", outline: null });
    for (let r = 0; r <= 14; r++) store.appendEvent(c.id, r, { type: "narration", text: `round ${r}` });
    store.updateCampaign(c.id, { roundNumber: 14 });
    const ctx = buildContext(store, c.id, 10);
    expect(ctx.recentRounds.map((r) => r.round)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(ctx.campaign.id).toBe(c.id);
  });

  it("renders NPC ops as [NPC] lines", () => {
    const store = createStore(":memory:");
    const c = store.createCampaign({ title: "T", mode: "solo", setting: "S", pitch: "", outline: null });
    store.appendEvent(c.id, 1, { type: "op_applied", op: { op: "npc", name: "Scarred Brute", attitude: "hostile", condition: "badly hurt" } });
    store.appendEvent(c.id, 1, { type: "op_applied", op: { op: "npc_gone", name: "Scarred Brute" } });
    expect(transcriptFromEvents(store.getEvents(c.id), [])).toEqual([
      { round: 1, lines: ["[NPC] Scarred Brute: hostile, badly hurt", "[NPC] Scarred Brute leaves"] },
    ]);
  });
});
