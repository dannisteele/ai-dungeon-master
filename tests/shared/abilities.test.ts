import { describe, expect, it } from "vitest";
import {
  baseScores, formatModifier, maxHpFor, modifier, pointBuyCost, validatePointBuy,
} from "../../src/shared/abilities";

describe("modifier", () => {
  it.each([[1, -5], [8, -1], [9, -1], [10, 0], [11, 0], [12, 1], [15, 2], [20, 5]])(
    "score %i → %i", (score, mod) => expect(modifier(score)).toBe(mod),
  );
  it("formats with a sign", () => {
    expect(formatModifier(2)).toBe("+2");
    expect(formatModifier(0)).toBe("+0");
    expect(formatModifier(-1)).toBe("-1");
  });
});

describe("point buy", () => {
  it("base scores cost nothing", () => {
    expect(baseScores()).toEqual({ STR: 8, DEX: 8, CON: 8, INT: 8, WIS: 8, CHA: 8 });
    expect(pointBuyCost(baseScores())).toBe(0);
  });
  it("uses the 5e cost table", () => {
    expect(pointBuyCost({ STR: 15, DEX: 15, CON: 15, INT: 8, WIS: 8, CHA: 8 })).toBe(27);
    expect(pointBuyCost({ STR: 14, DEX: 13, CON: 12, INT: 11, WIS: 10, CHA: 9 })).toBe(7 + 5 + 4 + 3 + 2 + 1);
  });
  it("returns null for scores outside 8–15 or non-integers", () => {
    expect(pointBuyCost({ ...baseScores(), STR: 16 })).toBeNull();
    expect(pointBuyCost({ ...baseScores(), STR: 7 })).toBeNull();
    expect(pointBuyCost({ ...baseScores(), STR: 12.5 })).toBeNull();
  });
  it("validates budget and range with readable messages", () => {
    expect(validatePointBuy({ STR: 15, DEX: 15, CON: 15, INT: 8, WIS: 8, CHA: 8 })).toBeNull();
    expect(validatePointBuy(baseScores())).toBeNull();
    expect(validatePointBuy({ STR: 15, DEX: 15, CON: 15, INT: 9, WIS: 8, CHA: 8 })).toMatch(/28 of 27/);
    expect(validatePointBuy({ ...baseScores(), STR: 16 })).toMatch(/between 8 and 15/);
  });
});

describe("maxHpFor", () => {
  it("is 20 + 2×CON mod at level 1, minimum 10", () => {
    expect(maxHpFor(10, 1)).toBe(20);
    expect(maxHpFor(14, 1)).toBe(24);
    expect(maxHpFor(8, 1)).toBe(18);
    expect(maxHpFor(1, 1)).toBe(10);
  });
  it("adds max(1, 5 + CON mod) per level after the first", () => {
    expect(maxHpFor(14, 3)).toBe(24 + 2 * 7);
    expect(maxHpFor(1, 2)).toBe(10 + 1);
  });
});
