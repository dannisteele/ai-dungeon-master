import { describe, expect, it } from "vitest";
import { PRESETS, settingLabel } from "../../../src/server/campaigns/presets";

describe("settingLabel", () => {
  it("names presets, prepared adventures and pitches", () => {
    const sciFi = PRESETS.find((p) => p.id === "scifi-derelict")!;
    expect(settingLabel({ setting: sciFi.setting, pitch: "", outline: null })).toBe("Sci-fi Derelict");
    const outline = { id: "x", title: "The Misfiled Petition", setting: "s", pitch: "p", goal: "g", villain: "v", locations: ["l"], beats: ["b"] };
    expect(settingLabel({ setting: "s", pitch: "p", outline })).toBe("Prepared adventure: The Misfiled Petition");
    expect(settingLabel({ setting: "Custom", pitch: "Cats in\nancient Egypt", outline: null })).toBe('Own pitch: "Cats in ancient Egypt"');
    expect(settingLabel({ setting: "Custom", pitch: "x".repeat(200), outline: null })).toMatch(/^Own pitch: "x{120}…"$/);
  });
});
