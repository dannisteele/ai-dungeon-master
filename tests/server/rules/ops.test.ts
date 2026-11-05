import { describe, expect, it } from "vitest";
import { applyOps } from "../../../src/server/rules/ops";
import type { Character } from "../../../src/shared/types";

function hero(over: Partial<Character> = {}): Character {
  return {
    id: 1, campaignId: 1, name: "Corvin Ash", concept: "knight", level: 1, hp: 20, maxHp: 20,
    scores: { STR: 15, DEX: 10, CON: 10, INT: 8, WIS: 12, CHA: 8 }, pendingAbilityPoints: 0,
    items: [{ name: "Rope", description: "30ft", qty: 1 }], ...over,
  };
}

describe("applyOps", () => {
  it("does not mutate its input", () => {
    const chars = [hero()];
    applyOps(chars, [{ op: "damage", character: "Corvin Ash", amount: 5 }]);
    expect(chars[0].hp).toBe(20);
  });

  it("matches names case-insensitively and ignoring surrounding spaces", () => {
    const r = applyOps([hero()], [{ op: "damage", character: "  corvin ash ", amount: 5 }]);
    expect(r.characters[0].hp).toBe(15);
    expect(r.applied).toHaveLength(1);
  });

  it("rejects unknown characters but still applies the rest", () => {
    const r = applyOps([hero()], [
      { op: "damage", character: "Gandalf", amount: 5 },
      { op: "heal", character: "Corvin Ash", amount: 1 },
    ]);
    expect(r.rejected).toEqual([{ op: { op: "damage", character: "Gandalf", amount: 5 }, reason: 'unknown character "Gandalf"' }]);
    expect(r.applied).toHaveLength(1);
  });

  it("rejects malformed ops with a reason", () => {
    const r = applyOps([hero()], [{ op: "damage", character: "Corvin Ash", amount: 500 }, { op: "teleport" }, "nonsense"]);
    expect(r.rejected).toHaveLength(3);
    expect(r.rejected[0].reason).toMatch(/invalid op/);
  });

  it("clamps damage at 0 and healing at max", () => {
    expect(applyOps([hero({ hp: 3 })], [{ op: "damage", character: "Corvin Ash", amount: 10 }]).characters[0].hp).toBe(0);
    expect(applyOps([hero({ hp: 18 })], [{ op: "heal", character: "Corvin Ash", amount: 10 }]).characters[0].hp).toBe(20);
  });

  it("adds items, merging quantities case-insensitively", () => {
    const r = applyOps([hero()], [
      { op: "add_item", character: "Corvin Ash", name: "Silver locket", description: "Cold to the touch" },
      { op: "add_item", character: "Corvin Ash", name: "rope", description: "", qty: 2 },
    ]);
    expect(r.characters[0].items).toEqual([
      { name: "Rope", description: "30ft", qty: 3 },
      { name: "Silver locket", description: "Cold to the touch", qty: 1 },
    ]);
  });

  it("removes items and rejects removing what isn't held", () => {
    const r = applyOps([hero()], [
      { op: "remove_item", character: "Corvin Ash", name: "ROPE" },
      { op: "remove_item", character: "Corvin Ash", name: "Torch" },
    ]);
    expect(r.characters[0].items).toEqual([]);
    expect(r.rejected[0].reason).toBe('Corvin Ash has no "Torch"');
    const r2 = applyOps([hero()], [{ op: "remove_item", character: "Corvin Ash", name: "Rope", qty: 2 }]);
    expect(r2.rejected[0].reason).toBe("Corvin Ash only has 1 × Rope");
  });

  it("adjusts stats within 1..20 and recalculates HP when CON changes", () => {
    const r = applyOps([hero({ scores: { STR: 20, DEX: 10, CON: 11, INT: 8, WIS: 12, CHA: 8 } })], [
      { op: "adjust_stat", character: "Corvin Ash", stat: "STR", delta: 1 },
      { op: "adjust_stat", character: "Corvin Ash", stat: "CON", delta: 1 },
    ]);
    expect(r.rejected[0].reason).toBe("STR can't go above 20");
    expect(r.characters[0].scores.CON).toBe(12);
    expect(r.characters[0].maxHp).toBe(22);
    expect(r.characters[0].hp).toBe(22);
  });

  it("level_up raises level, max HP, heals the gain and grants 2 ability points", () => {
    const r = applyOps([hero({ hp: 10 })], [{ op: "level_up", character: "Corvin Ash" }]);
    expect(r.characters[0]).toMatchObject({ level: 2, maxHp: 25, hp: 15, pendingAbilityPoints: 2 });
  });

  it("set_scene returns the title", () => {
    const r = applyOps([hero()], [{ op: "set_scene", title: "The Drowned Chapel" }]);
    expect(r.sceneTitle).toBe("The Drowned Chapel");
  });
});

describe("NPC ops", () => {
  const brute = { op: "npc", name: "Scarred Brute", attitude: "hostile", condition: "unhurt" };

  it("rejects an npc op that names a hero", () => {
    const r = applyOps([hero()], [{ op: "npc", name: "corvin ash", attitude: "friendly", condition: "unhurt" }]);
    expect(r.rejected).toEqual([{ op: { op: "npc", name: "corvin ash", attitude: "friendly", condition: "unhurt" }, reason: '"corvin ash" is a hero, not an NPC' }]);
    expect(r.npcs).toEqual([]);
  });

  it("keeps the DM's description of an NPC, and rejects one over 300 characters", () => {
    const r = applyOps([hero()], [{ op: "npc", name: "Mrs Bell", attitude: "friendly", condition: "unhurt", about: "Runs the bakery." }]);
    expect(r.npcs).toEqual([{ name: "Mrs Bell", attitude: "friendly", condition: "unhurt", about: "Runs the bakery." }]);
    const long = applyOps([hero()], [{ op: "npc", name: "Bell", attitude: "friendly", condition: "unhurt", about: "x".repeat(301) }]);
    expect(long.rejected).toHaveLength(1);
  });

  it("adds NPCs and updates them case-insensitively, keeping the newest spelling", () => {
    const r = applyOps([hero()], [brute, { op: "npc", name: "  scarred BRUTE ", attitude: "hostile", condition: "wounded" }]);
    expect(r.npcs).toEqual([{ name: "scarred BRUTE", attitude: "hostile", condition: "wounded" }]);
    expect(r.applied).toHaveLength(2);
  });

  it("starts from the NPCs passed in and does not mutate them", () => {
    const before = [{ name: "Barkeep", attitude: "neutral" as const, condition: "unhurt" as const }];
    const r = applyOps([hero()], [brute], before);
    expect(r.npcs.map((n) => n.name)).toEqual(["Barkeep", "Scarred Brute"]);
    expect(before).toHaveLength(1);
  });

  it("npc_gone removes an NPC and rejects unknown names", () => {
    const start = [{ name: "Barkeep", attitude: "neutral" as const, condition: "unhurt" as const }];
    const r = applyOps([hero()], [{ op: "npc_gone", name: "barkeep" }, { op: "npc_gone", name: "Ghost" }], start);
    expect(r.npcs).toEqual([]);
    expect(r.rejected).toEqual([{ op: { op: "npc_gone", name: "Ghost" }, reason: 'no NPC called "Ghost" is here' }]);
  });

  it("set_scene clears the list, and later npc ops repopulate it", () => {
    const start = [{ name: "Barkeep", attitude: "neutral" as const, condition: "unhurt" as const }];
    const r = applyOps([hero()], [{ op: "set_scene", title: "The Cells" }, { op: "npc", name: "Jailer", attitude: "wary", condition: "unhurt" }], start);
    expect(r.sceneTitle).toBe("The Cells");
    expect(r.npcs).toEqual([{ name: "Jailer", attitude: "wary", condition: "unhurt" }]);
  });

  it("caps the scene at 12 NPCs", () => {
    const ops = Array.from({ length: 13 }, (_, i) => ({ op: "npc", name: `Rat ${i}`, attitude: "hostile", condition: "unhurt" }));
    const r = applyOps([hero()], ops);
    expect(r.npcs).toHaveLength(12);
    expect(r.rejected).toEqual([{ op: ops[12], reason: "too many NPCs in the scene (max 12)" }]);
  });

  it("rejects an invalid attitude or condition", () => {
    const r = applyOps([hero()], [{ op: "npc", name: "X", attitude: "angry", condition: "unhurt" }, { op: "npc", name: "Y", attitude: "wary", condition: "dead" }]);
    expect(r.npcs).toEqual([]);
    expect(r.rejected).toHaveLength(2);
    expect(r.rejected[0].reason).toMatch(/invalid op/);
  });
});
