import { describe, expect, it } from "vitest";
import { loadAdventures } from "../../../src/server/campaigns/adventures";
import { campaignInputFrom, PRESETS, settingLabel } from "../../../src/server/campaigns/presets";

describe("settingLabel", () => {
  it("names presets, prepared adventures and pitches", () => {
    const sciFi = PRESETS.find((p) => p.id === "scifi-derelict")!;
    expect(settingLabel({ setting: sciFi.setting, pitch: "", outline: null })).toBe("Sci-fi Derelict");
    const outline = { id: "x", title: "The Misfiled Petition", setting: "s", pitch: "p", goal: "g", villain: "v", locations: ["l"], beats: ["b"], realism: "fantastical" as const };
    expect(settingLabel({ setting: "s", pitch: "p", outline })).toBe("Prepared adventure: The Misfiled Petition");
    expect(settingLabel({ setting: "Custom", pitch: "Cats in\nancient Egypt", outline: null })).toBe('Own pitch: "Cats in ancient Egypt"');
    expect(settingLabel({ setting: "Custom", pitch: "Cats in ancient Egypt", outline: null }, { includePitch: false })).toBe("Own pitch");
    expect(settingLabel({ setting: sciFi.setting, pitch: "", outline: null }, { includePitch: false })).toBe("Sci-fi Derelict");
    expect(settingLabel({ setting: "Custom", pitch: "x".repeat(200), outline: null })).toMatch(/^Own pitch: "x{120}…"$/);
  });
});

describe("realism and dice at creation", () => {
  const adventures = loadAdventures();
  const make = (source: Parameters<typeof campaignInputFrom>[0]["source"]) => {
    const input = campaignInputFrom({ mode: "solo", source }, adventures);
    if ("error" in input) throw new Error(input.error);
    return { realism: input.realism, dice: input.dice };
  };

  it("grounded campaigns start with dice for big moments only", () => {
    expect(make({ kind: "preset", presetId: "victorian-civil-service" })).toEqual({ realism: "grounded", dice: "big" });
    expect(make({ kind: "adventure", adventureId: "misfiled-petition" })).toEqual({ realism: "grounded", dice: "big" });
    expect(make({ kind: "pitch", pitch: "I have £14 and want a coffee" })).toEqual({ realism: "grounded", dice: "big" });
  });

  it("fantastical campaigns keep every-risky-moment dice", () => {
    expect(make({ kind: "preset", presetId: "gothic-horror" })).toEqual({ realism: "fantastical", dice: "normal" });
    expect(make({ kind: "adventure", adventureId: "drowned-chapel" })).toEqual({ realism: "fantastical", dice: "normal" });
    expect(make({ kind: "pitch", pitch: "A wizard's tower in the clouds", realism: "fantastical" })).toEqual({ realism: "fantastical", dice: "normal" });
  });

  it("every preset and adventure says which it is", () => {
    for (const p of PRESETS) expect(["grounded", "fantastical"]).toContain(p.realism);
    for (const a of adventures) expect(["grounded", "fantastical"]).toContain(a.realism);
  });
});
