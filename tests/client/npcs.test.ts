import { describe, expect, it } from "vitest";
import { appendAction, quickActionText } from "../../src/client/lib/npcs";

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
