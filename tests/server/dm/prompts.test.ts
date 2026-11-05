import { describe, expect, it } from "vitest";
import type { DmContext } from "../../../src/server/dm/context";
import { adjudicateTask, buildMessages, campaignBlock, estimateTokens, kitMessages, metBlock, partyBlock, resolveTask, summaryMessages, systemPrompt, nearbyBlock, openingTask, reviveTask } from "../../../src/server/dm/prompts";
import { toFormat, resolveFormatSchema, AdjudicateSchema } from "../../../src/server/dm/schemas";
import { memoryText } from "../../../src/server/dm/context";
import { lightRules } from "../../../src/server/rules/engine";
import type { Campaign, Character, Person } from "../../../src/shared/types";

const person = (name: string, over: Partial<Person> = {}): Person => ({
  name, about: "", notes: "", attitude: "neutral", condition: "unhurt", present: true, lastSeenRound: 1, aboutEdited: false, ...over,
});

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
    const ctx: DmContext = { campaign, characters: [corvin], people: [], recentRounds: [{ round: 2, lines: ["DM: older"] }] };
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
      campaign, characters: [corvin], people: [],
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
    expect(nearbyBlock([person("Scarred Brute", { attitude: "hostile", condition: "wounded" })]))
      .toBe("Nearby (authoritative):\n- Scarred Brute: hostile, wounded");
    expect(nearbyBlock([person("Gone", { present: false })])).toBe("Nearby: nobody notable.");
    const ctx: DmContext = { campaign, characters: [corvin], people: [person("Jailer", { attitude: "wary" })], recentRounds: [] };
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

describe("dice settings", () => {
  const actions = [{ character: "Corvin", text: "I run" }];
  it("big dice asks for checks only at pivotal moments", () => {
    expect(adjudicateTask(actions, "big")).toContain("genuinely pivotal");
    expect(adjudicateTask(actions, "normal")).not.toContain("genuinely pivotal");
  });
  it("no dice tells the DM to decide outcomes fairly itself", () => {
    const input = { actions, skipped: [], rolls: [] };
    expect(resolveTask(input, "off")).toContain("There are no dice in this game");
    expect(resolveTask(input, "normal")).not.toContain("There are no dice in this game");
  });
});

describe("people cards in the prompt", () => {
  it("shows the DM's description and the player's notes, only when there are some", () => {
    expect(nearbyBlock([person("Bell", { about: "Runs the bakery.", notes: "My aunt." })]))
      .toBe("Nearby (authoritative):\n- Bell: neutral, unhurt. About: Runs the bakery. Player's notes: My aunt.");
    expect(nearbyBlock([person("Bell", { notes: "My aunt." })])).toContain("- Bell: neutral, unhurt. Player's notes: My aunt.");
  });

  it("keeps long cards from crowding out the story", () => {
    const line = nearbyBlock([person("Bell", { notes: "n".repeat(1000) })]).split("\n")[1];
    expect(line.length).toBeLessThanOrEqual(400);
    const many = nearbyBlock(Array.from({ length: 12 }, (_, i) => person(`P${i}`, { about: "a".repeat(300), notes: "n".repeat(300) })));
    expect(many.length).toBeLessThanOrEqual(3000);
  });

  it("lists people met who aren't here, most recent first, capped", () => {
    expect(metBlock([person("Here")])).toBe("");
    const absent = Array.from({ length: 20 }, (_, i) => person(`Gone${i}`, { present: false, about: "x".repeat(150) }));
    const block = metBlock(absent);
    expect(block.startsWith("People you have met (not here now):")).toBe(true);
    expect(block).toContain("- Gone0: ");
    expect(block).not.toContain("Gone12");
    expect(block.length).toBeLessThanOrEqual(2000);
  });

  it("drops old rounds before people when the prompt is too long", () => {
    const ctx: DmContext = {
      campaign, characters: [corvin],
      people: [person("Bell", { about: "Runs the bakery." }), person("Tom", { present: false, about: "Her son, away at sea." })],
      recentRounds: Array.from({ length: 10 }, (_, i) => ({ round: i + 1, lines: [`DM: ${"long story ".repeat(200)}`] })),
    };
    const [system, user] = buildMessages(ctx, lightRules, "TASK", 3000);
    expect(user.content).toContain("- Bell: neutral, unhurt. About: Runs the bakery.");
    expect(user.content).toContain("- Tom: Her son, away at sea.");
    expect(user.content).not.toContain("round 1");
    expect(system.content).toContain("Player's notes are the truth");
  });

  it("asks the DM to describe people, and the summary pass to refresh their cards", () => {
    expect(resolveTask({ actions: [], skipped: [], rolls: [] })).toContain('"about"');
    expect(openingTask()).toContain('"about"');
    const msgs = summaryMessages("", [{ round: 1, lines: ["DM: hi"] }], [{ name: "Bell", about: "Runs the bakery." }]);
    expect(msgs[1].content).toContain("- Bell: Runs the bakery.");
    expect(msgs[1].content).toContain('"people"');
    expect(summaryMessages("", [], [])[1].content).not.toContain('"people"');
  });
});

describe("the players' own story so far", () => {
  it("memory is the pinned text, the DM's summary, or both under 'Since then'", () => {
    expect(memoryText({ pinnedSummary: "", summary: "Auto." })).toBe("Auto.");
    expect(memoryText({ pinnedSummary: "Mine.", summary: "" })).toBe("Mine.");
    expect(memoryText({ pinnedSummary: "Mine.", summary: "Auto." })).toBe("Mine.\n\nSince then:\nAuto.");
    expect(memoryText({ pinnedSummary: "", summary: "" })).toBe("");
  });

  it("the DM is given the pinned text and told to summarise only what's new", () => {
    const msgs = summaryMessages("", [{ round: 4, lines: ["DM: x"] }], [], "Corvin never found the key.");
    expect(msgs[1].content).toContain("The players wrote the earlier story themselves");
    expect(msgs[1].content).toContain("Corvin never found the key.");
    expect(summaryMessages("Old.", [], [])[1].content).not.toContain("The players wrote");
  });

  it("buildMessages shows the DM the players' version", () => {
    const ctx: DmContext = { campaign: { ...campaign, pinnedSummary: "Mine.", summary: "Auto." }, characters: [corvin], people: [], recentRounds: [] };
    expect(buildMessages(ctx, lightRules, "TASK", 12000)[1].content).toContain("Story so far:\nMine.\n\nSince then:\nAuto.");
  });
});
