import { describe, expect, it } from "vitest";
import type { DmContext } from "../../../src/server/dm/context";
import { adjudicateTask, buildMessages, campaignBlock, estimateTokens, kitMessages, partyBlock, resolveTask, systemPrompt, nearbyBlock, openingTask, reviveTask } from "../../../src/server/dm/prompts";
import { toFormat, resolveFormatSchema, AdjudicateSchema } from "../../../src/server/dm/schemas";
import { lightRules } from "../../../src/server/rules/engine";
import type { Campaign, Character } from "../../../src/shared/types";

const campaign: Campaign = {
  id: 1, title: "The Drowned Chapel", mode: "party", setting: "Gothic fantasy", pitch: "A bell rings at night",
  outline: { id: "dc", title: "The Drowned Chapel", setting: "Gothic", pitch: "p", goal: "Silence the bell", villain: "Sister Ambrel", locations: ["Nave"], beats: ["Arrive"], realism: "fantastical" as const },
  sceneTitle: "Fenwick", summary: "The party arrived in Fenwick.", pinnedSummary: "", realism: "fantastical", dice: "normal", roundState: "collecting", roundNumber: 3, stalledPhase: null, createdAt: "", updatedAt: "",
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
    // The format example must use placeholders: smaller models copy concrete example items into the game.
    expect(r).toContain('"name":"<item name>"');
    expect(r).not.toContain("Rusty Key");
    expect(r).toContain("never the heroes");
    expect(r).toContain('"op":"npc","name":"<npc name>"');
  });

  it("calibrates checks the way 5e tables do: most DCs 10-15, framed on the character's goal", () => {
    const a = adjudicateTask([{ character: "Corvin", text: "I throw a mug at him" }]);
    expect(a).toContain("Most checks should be DC 10-15");
    expect(a).toContain("Use 20 only for feats that would challenge a trained expert");
    expect(a).toContain("what the character is trying to achieve, not what they are trying to avoid");
  });

  it("keeps narration faithful to the dice and the sheet", () => {
    const r = resolveTask({ actions: [{ character: "Corvin", text: "I run" }], skipped: [], rolls: [] });
    expect(r).toContain("Only call a roll a natural 20 or natural 1 when the dice results above say so.");
    expect(systemPrompt(lightRules)).toContain("Only remove items when the story takes, uses up, breaks or loses them");
  });

  it("buildMessages includes outline, summary and recent rounds", () => {
    const ctx: DmContext = { campaign, characters: [corvin], npcs: [], recentRounds: [{ round: 2, lines: ["DM: older"] }] };
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
      campaign, characters: [corvin], npcs: [],
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

  it("shows the DM who is nearby", () => {
    expect(nearbyBlock([])).toBe("Nearby: nobody notable.");
    expect(nearbyBlock([{ name: "Scarred Brute", attitude: "hostile", condition: "wounded" }]))
      .toBe("Nearby (authoritative):\n- Scarred Brute: hostile, wounded");
    const ctx: DmContext = { campaign, characters: [corvin], npcs: [{ name: "Jailer", attitude: "wary", condition: "unhurt" }], recentRounds: [] };
    const [system, user] = buildMessages(ctx, lightRules, "TASK", 12000);
    expect(user.content).toContain("- Jailer: wary, unhurt");
    expect(system.content).toContain("Keep the Nearby list true");
    expect(openingTask()).toContain("npc op for each notable non-player character or group present (never the heroes)");
  });

  it("repeats the follow-up rule in every round's task, where small models actually look", () => {
    const r = resolveTask({ actions: [{ character: "Edith", text: "I ask the groundskeeper some questions" }], skipped: [], rolls: [] });
    expect(r).toContain(
      "If an action says a hero asks, talks or chats without giving their actual words, do not write those words for them: have the other person respond and end your narration with that person asking the hero, in quotes, what they want to say or know.",
    );
  });

  it("asks the player what they say instead of inventing their words", () => {
    expect(systemPrompt(lightRules)).toContain(
      "- When a player's action is vague about what they say or ask (for example \"I ask some questions\" or \"I chat to her\"), don't invent their words. Have the NPC react in character and end by asking that player what exactly they say or ask.",
    );
  });

  it("tells the DM that harm to NPCs is a condition change, not a damage op", () => {
    // A real session had damage ops aimed at "Servant 1" and "Servant 2", rejected as unknown characters.
    const r = resolveTask({ actions: [], skipped: [], rolls: [] });
    expect(r).toContain("damage and heal ops are only for the heroes; when an NPC is hurt or healed, update their condition with an npc op instead.");
  });

  it("asks for a revive twist without HP changes", () => {
    const t = reviveTask();
    expect(t).toContain("The whole party has fallen.");
    expect(t).toContain("Do not add heal ops: the app restores everyone to half health.");
  });
});

describe("grounded or fantastical", () => {
  it("a grounded DM is told nothing impossible happens, except what the players establish", () => {
    const grounded = systemPrompt(lightRules, "grounded");
    expect(grounded).toContain("no magic, no supernatural events");
    expect(grounded).toContain("players' pitch or notes");
    expect(grounded).not.toContain("danger, mystery");
    expect(grounded).not.toContain("Keep magic items");
    expect(grounded).toContain("Items are ordinary, realistic things.");
  });

  it("a fantastical DM gets today's prompt", () => {
    const fantastical = systemPrompt(lightRules, "fantastical");
    expect(fantastical).toContain("with danger, mystery and some humour");
    expect(fantastical).toContain("Keep magic items, adjust_stat and level_up rare");
    expect(fantastical).not.toContain("no magic, no supernatural events");
  });

  it("names the tone in the campaign block", () => {
    expect(campaignBlock({ ...campaign, realism: "grounded" })).toContain("Tone: grounded (realistic, nothing impossible)");
    expect(campaignBlock({ ...campaign, realism: "fantastical" })).toContain("Tone: fantastical");
  });

  it("packs grounded kits with everyday things", () => {
    const user = (r: "grounded" | "fantastical") => kitMessages({ name: "Ann", concept: "barista", setting: "Leeds", realism: r })[1].content;
    expect(user("grounded")).toContain("everyday items");
    expect(user("grounded")).not.toContain("no powerful magic");
    expect(user("fantastical")).toContain("no powerful magic");
  });
});
