import { describe, expect, it } from "vitest";
import { buildStory, eventsBeforeRoll, newItemNames } from "../../src/client/lib/story";
import type { Character, StoredEvent } from "../../src/shared/types";

const chars = [{ id: 1, name: "Corvin" }, { id: 2, name: "Wren" }] as Character[];
let n = 0;
const ev = (round: number, e: object) => ({ id: ++n, campaignId: 1, round, createdAt: "", ...e }) as StoredEvent;

describe("buildStory", () => {
  it("turns events into readable entries, hiding bookkeeping", () => {
    const events = [
      ev(0, { type: "narration", text: "Fog." }),
      ev(1, { type: "action", characterId: 1, text: "I kick the door" }),
      ev(1, { type: "skip", characterId: 2, skippedBy: 1 }),
      ev(1, { type: "check_request", characterId: 1, ability: "STR", dc: 14, reason: "door" }),
      ev(1, { type: "roll", characterId: 1, ability: "STR", die: 15, dc: 14, modifier: 2, total: 17, success: true, crit: null }),
      ev(1, { type: "narration", text: "It opens." }),
      ev(1, { type: "op_applied", op: { op: "set_scene", title: "Hall" } }),
      ev(1, { type: "stall", phase: "resolving", error: "x" }),
    ];
    const story = buildStory(events, chars);
    expect(story.map((s) => s.kind)).toEqual(["narration", "action", "skip", "roll", "narration"]);
    expect(story[1]).toMatchObject({ name: "Corvin", text: "I kick the door" });
    expect(story[2]).toMatchObject({ text: "Corvin went ahead without Wren." });
    expect(story[3]).toMatchObject({ name: "Corvin" });
  });

  it("describes a self-skip", () => {
    const story = buildStory([ev(1, { type: "skip", characterId: 2, skippedBy: 2 })], chars);
    expect(story[0]).toMatchObject({ text: "Wren holds back this round." });
  });

  it("shows applied sheet changes as chips, except set_scene", () => {
    const withLevels = [{ id: 1, name: "Corvin", level: 2 }, { id: 2, name: "Wren", level: 2 }] as Character[];
    const events = [
      ev(1, { type: "op_applied", op: { op: "damage", character: "Corvin", amount: 4 } }),
      ev(1, { type: "op_applied", op: { op: "heal", character: "Wren", amount: 2 } }),
      ev(1, { type: "op_applied", op: { op: "add_item", character: "Wren", name: "Rusty Key", description: "", qty: 1 } }),
      ev(1, { type: "op_applied", op: { op: "remove_item", character: "Corvin", name: "Torch", qty: 1 } }),
      ev(1, { type: "op_applied", op: { op: "adjust_stat", character: "Corvin", stat: "STR", delta: 1 } }),
      ev(1, { type: "op_applied", op: { op: "level_up", character: "Wren" } }),
      ev(1, { type: "op_applied", op: { op: "set_scene", title: "Hall" } }),
    ];
    const story = buildStory(events, withLevels);
    expect(story.map((s) => s.kind)).toEqual(["sheet", "sheet", "sheet", "sheet", "sheet", "sheet"]);
    expect(story.map((s) => (s as { text: string }).text)).toEqual([
      "Corvin −4 HP",
      "Wren +2 HP",
      "Wren gains Rusty Key",
      "Corvin loses Torch",
      "Corvin STR +1",
      "Wren reaches level 2",
    ]);
  });
});

describe("NPC story chips", () => {
  it("shows NPC changes as sheet chips", () => {
    const story = buildStory([
      ev(1, { type: "op_applied", op: { op: "npc", name: "Scarred Brute", attitude: "hostile", condition: "wounded" } }),
      ev(1, { type: "op_applied", op: { op: "npc_gone", name: "Scarred Brute" } }),
    ], chars);
    expect(story).toEqual([
      expect.objectContaining({ kind: "sheet", text: "Scarred Brute: hostile, wounded" }),
      expect.objectContaining({ kind: "sheet", text: "Scarred Brute leaves" }),
    ]);
  });
});

describe("party fallen", () => {
  it("adds a fallen entry to the story", () => {
    const story = buildStory([ev(9, { type: "party_fallen" })], chars);
    expect(story).toEqual([expect.objectContaining({ kind: "fallen" })]);
  });
});

describe("newItemNames", () => {
  it("lists items added to a character in the last resolved round", () => {
    const events = [
      ev(1, { type: "op_applied", op: { op: "add_item", character: "Corvin", name: "Old key", description: "", qty: 1 } }),
      ev(2, { type: "op_applied", op: { op: "add_item", character: "corvin", name: "Silver Locket", description: "", qty: 1 } }),
      ev(2, { type: "op_applied", op: { op: "add_item", character: "Wren", name: "Bow", description: "", qty: 1 } }),
    ];
    expect([...newItemNames(events, "Corvin", 3)]).toEqual(["silver locket"]);
  });
});

describe("dice suspense", () => {
  it("hides the roll and everything after it until the die has landed", () => {
    const events = [
      ev(1, { type: "action", characterId: 1, text: "I leap" }),
      ev(1, { type: "roll", characterId: 1, ability: "DEX", die: 15, dc: 12, modifier: 0, total: 15, success: true, crit: null }),
      ev(1, { type: "narration", text: "She clears the gap." }),
    ];
    const roll = events[1];
    expect(eventsBeforeRoll(events, roll.id).map((e) => e.type)).toEqual(["action"]);
    expect(eventsBeforeRoll(events, undefined)).toBe(events);
  });
});
