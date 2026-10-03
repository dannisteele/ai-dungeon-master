import { describe, expect, it } from "vitest";
import type { DmContext } from "../../../src/server/dm/context";
import { adjudicateTask, buildMessages, estimateTokens, partyBlock, resolveTask } from "../../../src/server/dm/prompts";
import { toFormat, resolveFormatSchema, AdjudicateSchema } from "../../../src/server/dm/schemas";
import { lightRules } from "../../../src/server/rules/engine";
import type { Campaign, Character } from "../../../src/shared/types";

const campaign: Campaign = {
  id: 1, title: "The Drowned Chapel", mode: "party", setting: "Gothic fantasy", pitch: "A bell rings at night",
  outline: { id: "dc", title: "The Drowned Chapel", setting: "Gothic", pitch: "p", goal: "Silence the bell", villain: "Sister Ambrel", locations: ["Nave"], beats: ["Arrive"] },
  sceneTitle: "Fenwick", summary: "The party arrived in Fenwick.", roundState: "collecting", roundNumber: 3, stalledPhase: null, createdAt: "", updatedAt: "",
};
const corvin: Character = {
  id: 1, campaignId: 1, name: "Corvin", concept: "disgraced knight", level: 2, hp: 0, maxHp: 25,
  scores: { STR: 15, DEX: 10, CON: 10, INT: 8, WIS: 12, CHA: 8 }, pendingAbilityPoints: 0,
  items: [{ name: "Rope", description: "30ft", qty: 2 }],
};

describe("prompts", () => {
  it("party block shows sheet facts from the database", () => {
    const text = partyBlock([corvin]);
    expect(text).toContain("Corvin (disgraced knight)");
    expect(text).toContain("Level 2");
    expect(text).toContain("HP 0/25");
    expect(text).toContain("STR 15 (+2)");
    expect(text).toContain("Rope ×2");
    expect(text).toContain("DOWNED");
  });

  it("tasks list actions, skips and rolls", () => {
    expect(adjudicateTask([{ character: "Corvin", text: "I climb" }])).toContain("- Corvin: I climb");
    const r = resolveTask({
      actions: [{ character: "Corvin", text: "I climb" }], skipped: ["Wren"],
      rolls: [{ character: "Corvin", ability: "DEX", die: 3, modifier: 0, total: 3, dc: 12, success: false, crit: null, reason: "slick wall" }],
    });
    expect(r).toContain("Wren");
    expect(r).toContain("Corvin DEX check: 3 +0 = 3 vs DC 12 (slick wall): FAILURE");
  });

  it("buildMessages includes outline, summary and recent rounds", () => {
    const ctx: DmContext = { campaign, characters: [corvin], recentRounds: [{ round: 2, lines: ["DM: older"] }] };
    const [system, user] = buildMessages(ctx, lightRules, "TASK", 12000);
    expect(system.role).toBe("system");
    expect(system.content).toContain("Never invent dice results");
    expect(user.content).toContain("Silence the bell");
    expect(user.content).toContain("The party arrived in Fenwick.");
    expect(user.content).toContain("DM: older");
    expect(user.content.endsWith("TASK")).toBe(true);
  });

  it("drops the oldest rounds first to fit the budget", () => {
    const big = "x".repeat(4000);
    const ctx: DmContext = {
      campaign, characters: [corvin],
      recentRounds: Array.from({ length: 10 }, (_, i) => ({ round: i, lines: [`DM: r${i} ${big}`] })),
    };
    const msgs = buildMessages(ctx, lightRules, "TASK", 6000);
    const total = estimateTokens(msgs.map((m) => m.content).join(""));
    expect(total).toBeLessThanOrEqual(6000);
    expect(msgs[1].content).toContain("r9 ");
    expect(msgs[1].content).not.toContain("r0 ");
  });

  it("produces JSON schemas for Ollama's format field", () => {
    const adj = toFormat(AdjudicateSchema) as any;
    expect(adj.type).toBe("object");
    expect(adj.properties.checks.type).toBe("array");
    const res = toFormat(resolveFormatSchema(lightRules)) as any;
    expect(Object.keys(res.properties)).toEqual(["narration", "changes"]);
  });
});
