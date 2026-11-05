// Plays a short solo-party game against your real Ollama model and reports how well it follows the format.
import { loadConfig } from "../src/server/config";
import { createDungeonMaster } from "../src/server/dm/dm";
import { createOllamaClient } from "../src/server/dm/ollama";
import { rollD20 } from "../src/server/rules/dice";
import { lightRules } from "../src/server/rules/engine";
import { createStore } from "../src/server/store/store";
import type { Realism } from "../src/shared/types";
import { TurnService } from "../src/server/turns/turns";

try { process.loadEnvFile(); } catch { /* optional */ }
const config = loadConfig({ TABLE_PASSWORD: "smoke", ...process.env });
const chat = createOllamaClient({ url: config.ollamaUrl, model: config.ollamaModel, keepAlive: config.ollamaKeepAlive, numCtx: config.ollamaNumCtx });
const dm = createDungeonMaster({ chat, rules: lightRules, budgetTokens: config.promptBudgetTokens });
const store = createStore(":memory:");
const turns = new TurnService({ store, rules: lightRules, dm, hub: { broadcast() {} }, dice: rollD20 });

// SMOKE_PITCH plays a player-written pitch instead (with SMOKE_REALISM, default grounded), and
// checks a grounded story's narration for anything impossible.
const pitch = process.env.SMOKE_PITCH?.trim();
const realism = (process.env.SMOKE_REALISM as Realism | undefined) ?? (pitch ? "grounded" : "fantastical");
const campaign = pitch
  ? store.createCampaign({ title: "Smoke", mode: "party", setting: "Custom setting described in the pitch", pitch, outline: null, realism })
  : store.createCampaign({ title: "Smoke", mode: "party", setting: "Classic high fantasy", pitch: "", outline: null });
const scores = { STR: 15, DEX: 14, CON: 13, INT: 12, WIS: 10, CHA: 8 };
const heroes = await Promise.all((pitch ? [["Corvin", "tired night-shift nurse"], ["Wren", "broke university student"]] : [["Corvin", "disgraced knight"], ["Wren", "nimble scout"]]).map(async ([name, concept]) => {
  const t = Date.now();
  const kit = await dm.startingKit({ name, concept, setting: campaign.setting, realism: campaign.realism });
  console.log(`kit for ${name} (${((Date.now() - t) / 1000).toFixed(1)}s): ${kit.map((i) => i.name).join(", ")}`);
  const maxHp = lightRules.startingMaxHp(scores);
  return store.createCharacter({ campaignId: campaign.id, name, concept, scores, hp: maxHp, maxHp, items: kit.map((i) => ({ ...i, qty: 1 })) });
}));

const everyday = [
  ["I count my money and look at the menu board", "I look around for somewhere to sit"],
  ["I order the cheapest decent coffee", "I check the time on my phone"],
  ["I ask the barista what's good here", "I people-watch for a bit"],
  ["I try to make the change last for lunch too", "I chat to whoever is next to me"],
  ["I head out toward work", "I follow, grabbing a free newspaper"],
];
const script = pitch ? everyday : [
  ["I ask the innkeeper about the trouble up the road", "I watch the room for anyone acting suspicious"],
  ["I lead us down the forest path", "I scout ahead, staying in the shadows"],
  ["I try to force open the old gate", "I look for another way in"],
  ["I draw my sword and challenge whatever is inside", "I ready my bow and cover Corvin"],
  ["I search the room for anything valuable", "I check the bodies for clues"],
];

const timed = async (label: string, fn: () => Promise<void>) => {
  const t = Date.now();
  await fn();
  console.log(`  ${label}: ${((Date.now() - t) / 1000).toFixed(1)}s`);
};

await timed("opening", () => turns.begin(campaign.id));
for (const [i, [a, b]] of script.entries()) {
  if (store.getCampaign(campaign.id)!.roundState === "fallen") {
    console.log(`party fell before round ${i + 1}`);
    break;
  }
  console.log(`round ${i + 1}`);
  await turns.submitAction(campaign.id, heroes[0].id, a);
  await timed("actions", () => turns.submitAction(campaign.id, heroes[1].id, b));
  for (let guard = 0; store.getCampaign(campaign.id)!.roundState === "awaiting_rolls" && guard < 4; guard++) {
    const ev = store.getEvents(campaign.id, { fromRound: store.getCampaign(campaign.id)!.roundNumber });
    const pending = ev.filter((e) => e.type === "check_request").map((e) => (e as { characterId: number }).characterId)
      .find((cid) => !ev.some((e) => e.type === "roll" && e.characterId === cid));
    if (pending !== undefined) await timed("roll + resolve", () => turns.roll(campaign.id, pending));
  }
  if (store.getCampaign(campaign.id)!.roundState === "stalled") {
    console.log("  stalled, retrying once");
    await turns.retry(campaign.id);
  }
}
await turns.settle();

const events = store.getEvents(campaign.id);
const count = (t: string) => events.filter((e) => e.type === t).length;
console.log("\n── Story ──");
for (const e of events) if (e.type === "narration") console.log(`\n${e.text}`);
console.log("\n── Report ──");
console.log(`model: ${config.ollamaModel}${pitch ? ` · pitch (${realism}): ${pitch}` : ""}`);
console.log(`narrations: ${count("narration")}, checks: ${count("check_request")}, rolls: ${count("roll")}`);
const dcs = events.flatMap((e) => (e.type === "check_request" ? [e.dc] : []));
console.log(`check DCs: ${dcs.join(", ") || "none"}`);
console.log(`ops applied: ${count("op_applied")}, ops rejected: ${count("op_rejected")}, stalls: ${count("stall")}`);
const opTypes = ["damage", "add_item", "heal", "remove_item", "adjust_stat", "level_up"] as const;
const opCount = (t: string) => events.filter((e) => e.type === "op_applied" && e.op.op === t).length;
const sheetChanges = opTypes.reduce((n, t) => n + opCount(t), 0);
console.log(`sheet changes: ${opTypes.map((t) => `${t} ${opCount(t)}`).join(", ")}`);
if (sheetChanges === 0) console.log("WARNING: the DM made no sheet changes");
const npcUpdates = opCount("npc") + opCount("npc_gone");
console.log(`npc updates: ${npcUpdates}`);
if (npcUpdates === 0) console.log("WARNING: the DM never updated the Nearby list");
for (const e of events) if (e.type === "op_rejected") console.log(`  rejected: ${JSON.stringify(e.op)} (${e.reason})`);
for (const c of store.getCharacters(campaign.id)) console.log(`${c.name}: HP ${c.hp}/${c.maxHp}, items: ${c.items.map((i) => i.name).join(", ")}`);
// A grounded story must contain nothing impossible. Only the DM's narration counts, not the heroes' actions.
const FANTASTICAL = /\b(magic\w*|spells?|portals?|enchant\w*|supernatural|ghosts?|monsters?|wizards?|sorcer\w*|curse[sd]?|visions?|glowing runes?|teleport\w*)\b/gi;
if (realism === "grounded") {
  const found = new Set(events.flatMap((e) => (e.type === "narration" ? e.text.match(FANTASTICAL) ?? [] : [])).map((w) => w.toLowerCase()));
  console.log(found.size ? `WARNING: fantastical words in narration: ${[...found].join(", ")}` : "grounded check: nothing fantastical in the narration");
}
store.close();
process.exit(count("stall") > 0 ? 1 : 0);
