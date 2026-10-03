import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createStore, NameTakenError, type Store } from "../../../src/server/store/store";

const scores = { STR: 15, DEX: 10, CON: 14, INT: 8, WIS: 12, CHA: 8 };
let store: Store;
afterEach(() => store?.close());

function seed(s: Store) {
  const campaign = s.createCampaign({ title: "Test", mode: "party", setting: "Fantasy", pitch: "", outline: null });
  const corvin = s.createCharacter({
    campaignId: campaign.id, name: "Corvin", concept: "knight", scores, hp: 24, maxHp: 24,
    items: [{ name: "Rope", description: "30ft", qty: 1 }],
  });
  return { campaign, corvin };
}

describe("store", () => {
  it("creates campaigns with lobby defaults", () => {
    store = createStore(":memory:");
    const { campaign } = seed(store);
    expect(campaign).toMatchObject({ title: "Test", mode: "party", roundState: "lobby", roundNumber: 0, sceneTitle: "", summary: "", stalledPhase: null, outline: null });
    expect(store.getCampaign(campaign.id)).toEqual(campaign);
  });

  it("round-trips an adventure outline", () => {
    store = createStore(":memory:");
    const outline = { id: "x", title: "X", setting: "s", pitch: "p", goal: "g", villain: "v", locations: ["a"], beats: ["b"] };
    const c = store.createCampaign({ title: "X", mode: "solo", setting: "s", pitch: "p", outline });
    expect(store.getCampaign(c.id)?.outline).toEqual(outline);
  });

  it("updates campaign fields and bumps updatedAt", () => {
    store = createStore(":memory:");
    const { campaign } = seed(store);
    store.updateCampaign(campaign.id, { roundState: "stalled", stalledPhase: "resolving", roundNumber: 3, sceneTitle: "Gate" });
    expect(store.getCampaign(campaign.id)).toMatchObject({ roundState: "stalled", stalledPhase: "resolving", roundNumber: 3, sceneTitle: "Gate" });
  });

  it("stores characters with items and lists them by campaign", () => {
    store = createStore(":memory:");
    const { campaign, corvin } = seed(store);
    expect(corvin).toMatchObject({ name: "Corvin", level: 1, hp: 24, maxHp: 24, scores, pendingAbilityPoints: 0, items: [{ name: "Rope", description: "30ft", qty: 1 }] });
    expect(store.getCharacters(campaign.id).map((c) => c.name)).toEqual(["Corvin"]);
    expect(store.listCampaigns()).toEqual([expect.objectContaining({ id: campaign.id, characterNames: ["Corvin"] })]);
  });

  it("rejects duplicate character names in a campaign, case-insensitively", () => {
    store = createStore(":memory:");
    const { campaign } = seed(store);
    expect(() => store.createCharacter({ campaignId: campaign.id, name: "corvin", concept: "x", scores, hp: 20, maxHp: 20, items: [] })).toThrow(NameTakenError);
  });

  it("saves characters, replacing items", () => {
    store = createStore(":memory:");
    const { corvin } = seed(store);
    store.saveCharacter({ ...corvin, hp: 3, level: 2, pendingAbilityPoints: 2, scores: { ...scores, STR: 16 }, items: [{ name: "Locket", description: "silver", qty: 1 }] });
    expect(store.getCharacter(corvin.id)).toMatchObject({ hp: 3, level: 2, pendingAbilityPoints: 2, scores: { STR: 16 }, items: [{ name: "Locket", description: "silver", qty: 1 }] });
  });

  it("appends and queries events by round and limit", () => {
    store = createStore(":memory:");
    const { campaign, corvin } = seed(store);
    store.appendEvent(campaign.id, 0, { type: "narration", text: "Once" });
    const a = store.appendEvent(campaign.id, 1, { type: "action", characterId: corvin.id, text: "I knock" });
    store.appendEvent(campaign.id, 2, { type: "narration", text: "Later" });
    expect(a).toMatchObject({ type: "action", text: "I knock", round: 1, campaignId: campaign.id });
    expect(store.getEvents(campaign.id).map((e) => e.round)).toEqual([0, 1, 2]);
    expect(store.getEvents(campaign.id, { fromRound: 1, toRound: 1 }).map((e) => e.type)).toEqual(["action"]);
    expect(store.getEvents(campaign.id, { limit: 2 }).map((e) => e.round)).toEqual([1, 2]);
  });

  it("rolls back a failed transaction", () => {
    store = createStore(":memory:");
    const { campaign } = seed(store);
    expect(() => store.transaction(() => {
      store.appendEvent(campaign.id, 1, { type: "narration", text: "lost" });
      throw new Error("boom");
    })).toThrow("boom");
    expect(store.getEvents(campaign.id)).toEqual([]);
  });

  it("persists to disk across reopen", () => {
    const dir = mkdtempSync(join(tmpdir(), "adm-"));
    const path = join(dir, "nested", "game.sqlite");
    try {
      store = createStore(path);
      const { campaign } = seed(store);
      store.appendEvent(campaign.id, 0, { type: "narration", text: "Saved" });
      store.close();
      store = createStore(path);
      expect(store.getEvents(campaign.id)[0]).toMatchObject({ type: "narration", text: "Saved" });
      expect(store.getCharacters(campaign.id)).toHaveLength(1);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("merges case-insensitive duplicate items in a kit", () => {
    store = createStore(":memory:");
    const campaign = store.createCampaign({ title: "Test", mode: "party", setting: "Fantasy", pitch: "", outline: null });
    const character = store.createCharacter({
      campaignId: campaign.id, name: "Hero", concept: "adventurer", scores, hp: 24, maxHp: 24,
      items: [
        { name: "Rope", description: "30ft", qty: 1 },
        { name: "rope", description: "different", qty: 2 },
      ],
    });
    expect(character.items).toEqual([{ name: "Rope", description: "30ft", qty: 3 }]);
  });

  it("still rejects duplicate character names even after item merging", () => {
    store = createStore(":memory:");
    const campaign = store.createCampaign({ title: "Test", mode: "party", setting: "Fantasy", pitch: "", outline: null });
    store.createCharacter({
      campaignId: campaign.id, name: "Corvin", concept: "knight", scores, hp: 24, maxHp: 24,
      items: [{ name: "Rope", description: "30ft", qty: 1 }],
    });
    expect(() => store.createCharacter({
      campaignId: campaign.id, name: "corvin", concept: "x", scores, hp: 20, maxHp: 20,
      items: [{ name: "Rope", description: "30ft", qty: 1 }],
    })).toThrow(NameTakenError);
  });

  it("saves and replaces a campaign's NPCs", () => {
    store = createStore(":memory:");
    const { campaign } = seed(store);
    expect(store.getNpcs(campaign.id)).toEqual([]);
    store.saveNpcs(campaign.id, [
      { name: "Scarred Brute", attitude: "hostile", condition: "unhurt" },
      { name: "Barkeep", attitude: "neutral", condition: "unhurt" },
      { name: "scarred brute", attitude: "hostile", condition: "wounded" },
    ]);
    expect(store.getNpcs(campaign.id)).toEqual([
      { name: "scarred brute", attitude: "hostile", condition: "wounded" },
      { name: "Barkeep", attitude: "neutral", condition: "unhurt" },
    ]);
    store.saveNpcs(campaign.id, []);
    expect(store.getNpcs(campaign.id)).toEqual([]);
  });
});
