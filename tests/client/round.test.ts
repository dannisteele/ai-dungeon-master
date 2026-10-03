import { describe, expect, it } from "vitest";
import { canSkipAlone } from "../../src/client/lib/round";

describe("canSkipAlone", () => {
  it("2 players: refuses to offer skipping the last one standing", () => {
    // A already skipped; skipping B too would leave nobody to act (server would reject it).
    expect(canSkipAlone([1, 2], [1], 2)).toBe(false);
  });

  it("3 players: both still-pending players can be skipped while the other remains", () => {
    // A already skipped; B and C are both still pending, so either can be skipped alone.
    expect(canSkipAlone([1, 2, 3], [1], 2)).toBe(true);
    expect(canSkipAlone([1, 2, 3], [1], 3)).toBe(true);
  });

  it("nobody skipped yet: any one of several active characters can be skipped", () => {
    expect(canSkipAlone([1, 2], [], 1)).toBe(true);
  });

  it("solo: the only active character can never be skipped alone", () => {
    expect(canSkipAlone([1], [], 1)).toBe(false);
  });
});
