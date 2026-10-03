import { describe, expect, it } from "vitest";
import { lightRules } from "../../../src/server/rules/engine";
import type { Character } from "../../../src/shared/types";

const c = (over: Partial<Character> = {}): Character => ({
  id: 1, campaignId: 1, name: "Wren", concept: "scout", level: 2, hp: 10, maxHp: 25,
  scores: { STR: 10, DEX: 19, CON: 10, INT: 8, WIS: 12, CHA: 8 }, pendingAbilityPoints: 2, items: [], ...over,
});

describe("lightRules", () => {
  it("validates new characters with point buy", () => {
    expect(lightRules.validateNewCharacter({ STR: 15, DEX: 15, CON: 15, INT: 8, WIS: 8, CHA: 8 })).toBeNull();
    expect(lightRules.validateNewCharacter({ STR: 16, DEX: 8, CON: 8, INT: 8, WIS: 8, CHA: 8 })).not.toBeNull();
  });

  it("computes starting HP from CON", () => {
    expect(lightRules.startingMaxHp({ STR: 8, DEX: 8, CON: 14, INT: 8, WIS: 8, CHA: 8 })).toBe(24);
  });

  it("uses the ability's score for checks", () => {
    expect(lightRules.check(10, c().scores, "DEX", 14)).toEqual({ modifier: 4, total: 14, success: true, crit: null });
  });

  it("spends ability points up to 20 and returns a copy", () => {
    const orig = c();
    const r = lightRules.spendAbilityPoint(orig, "DEX");
    expect("character" in r && r.character.scores.DEX).toBe(20);
    expect("character" in r && r.character.pendingAbilityPoints).toBe(1);
    expect(orig.scores.DEX).toBe(19);
    const capped = lightRules.spendAbilityPoint(c({ scores: { ...c().scores, DEX: 20 } }), "DEX");
    expect(capped).toEqual({ error: "DEX is already 20" });
    expect(lightRules.spendAbilityPoint(c({ pendingAbilityPoints: 0 }), "STR")).toEqual({ error: "No ability points to spend" });
  });

  it("spending on CON recalculates max HP", () => {
    const r = lightRules.spendAbilityPoint(c({ scores: { ...c().scores, CON: 11 }, maxHp: 25, hp: 25 }), "CON");
    // CON 12 → mod +1: 22 at level 1, + max(1, 5 + 1) = 6 at level 2
    expect("character" in r && r.character.maxHp).toBe(28);
  });

  it("is downed at 0 HP", () => {
    expect(lightRules.isDowned(c({ hp: 0 }))).toBe(true);
    expect(lightRules.isDowned(c({ hp: 1 }))).toBe(false);
  });

  it("revives at half max HP, rounded up", () => {
    expect(lightRules.reviveHp(c({ maxHp: 25 }))).toBe(13);
    expect(lightRules.reviveHp(c({ maxHp: 22 }))).toBe(11);
  });
});
