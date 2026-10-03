import { describe, expect, it } from "vitest";
import { appendAction, clampMenuLeft, quickActionText } from "../../src/client/lib/npcs";

describe("quick actions", () => {
  it("builds the sentence for each action", () => {
    expect(quickActionText("attack", "Scarred Brute")).toBe("I attack Scarred Brute");
    expect(quickActionText("talk", "Barkeep")).toBe("I talk to Barkeep");
    expect(quickActionText("watch", "Mercenaries (3)")).toBe("I watch Mercenaries (3) closely");
  });

  it("fills an empty box and appends to typed text without losing it", () => {
    expect(appendAction("", "I attack Scarred Brute")).toBe("I attack Scarred Brute");
    expect(appendAction("   ", "I attack Scarred Brute")).toBe("I attack Scarred Brute");
    expect(appendAction("I scream and", "I attack Scarred Brute")).toBe("I scream and I attack Scarred Brute");
    expect(appendAction("I scream and  ", "I attack Scarred Brute")).toBe("I scream and I attack Scarred Brute");
  });
});

describe("clampMenuLeft", () => {
  it("leaves it as-is when it fits", () => {
    expect(clampMenuLeft(20, 150, 390)).toBe(20);
  });

  it("clamps to the right edge when it would overflow", () => {
    expect(clampMenuLeft(300, 150, 390)).toBe(240);
  });

  it("pins to the left edge when the container is narrower than the menu", () => {
    expect(clampMenuLeft(50, 200, 150)).toBe(0);
  });

  it("pins to the left edge for a negative desired position", () => {
    expect(clampMenuLeft(-20, 150, 390)).toBe(0);
  });
});
