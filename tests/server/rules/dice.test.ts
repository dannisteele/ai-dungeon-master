import { describe, expect, it } from "vitest";
import { resolveCheck, rollD20 } from "../../../src/server/rules/dice";

describe("rollD20", () => {
  it("only produces 1..20 and eventually all of them", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) {
      const r = rollD20();
      expect(Number.isInteger(r) && r >= 1 && r <= 20).toBe(true);
      seen.add(r);
    }
    expect(seen.size).toBe(20);
  });
});

describe("resolveCheck", () => {
  it("adds the ability modifier and compares to DC", () => {
    expect(resolveCheck(12, 15, 14)).toEqual({ modifier: 2, total: 14, success: true, crit: null });
    expect(resolveCheck(11, 15, 14)).toEqual({ modifier: 2, total: 13, success: false, crit: null });
  });
  it("natural 20 always succeeds", () => {
    expect(resolveCheck(20, 1, 25)).toEqual({ modifier: -5, total: 15, success: true, crit: "nat20" });
  });
  it("natural 1 always fails", () => {
    expect(resolveCheck(1, 20, 5)).toEqual({ modifier: 5, total: 6, success: false, crit: "nat1" });
  });
});
