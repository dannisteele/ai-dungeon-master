import { formatModifier, modifier } from "../../shared/abilities";
import { ABILITIES, type Ability, type Campaign, type Character, type Crit, type DiceMode, type Npc, type Realism } from "../../shared/types";
import type { RulesEngine } from "../rules/engine";
import type { DmContext, RoundTranscript } from "./context";
import type { ChatMessage } from "./ollama";

export interface ActionInput { character: string; text: string }
export interface RollInput {
  character: string; ability: Ability; die: number; modifier: number; total: number;
  dc: number; success: boolean; crit: Crit; reason: string;
}
export interface ResolveInput { actions: ActionInput[]; skipped: string[]; rolls: RollInput[] }

export const estimateTokens = (s: string) => Math.ceil(s.length / 4);

/** How the DM's story should feel. Grounded stories must stay possible in the real world. */
const TONE: Record<Realism, { story: string[]; danger: string; items: string }> = {
  fantastical: {
    story: ["- Keep the story moving toward the campaign's goal, with danger, mystery and some humour."],
    danger: "- Danger is real. When an enemy attacks, a trap springs or a risky check fails, someone usually gets hurt: narrate the hit and add a damage op (1-4 minor, 5-8 serious, 9-15 deadly). A natural 1 in a dangerous moment always costs HP.",
    items: "- Keep magic items, adjust_stat and level_up rare; level_up only after a major victory or milestone.",
  },
  grounded: {
    story: [
      "- This is a grounded, realistic story. Everything that happens must be possible in the real world of the setting: no magic, no supernatural events, no monsters, no impossible technology, no portals or visions. If something seems strange, it has an ordinary explanation.",
      "- Anything the players' pitch or notes establish is true in this world, even if unusual; add nothing impossible beyond it. If a hero tries something impossible (casting a spell, say), they are a person attempting it: nothing magical happens, and people may react to the odd behaviour. Don't lecture the player.",
      "- Drama comes from people, choices, money, time, relationships and consequences. Keep it lively, specific and sometimes funny; ordinary life is full of small surprises.",
    ],
    danger: "- Harm only happens when the story really involves it (an accident, a fight the heroes start, a dangerous job); then narrate it and add a damage op (1-4 minor, 5-8 serious, 9-15 deadly).",
    items: "- Items are ordinary, realistic things. Keep adjust_stat and level_up rare; level_up only after a major achievement.",
  },
};

export function systemPrompt(rules: RulesEngine, realism: Realism = "fantastical"): string {
  const tone = TONE[realism];
  return [
    "You are the Dungeon Master for a tabletop roleplaying game played by friends at home.",
    "",
    "Storytelling:",
    "- Narrate vividly but concisely: 1-3 short paragraphs per round.",
    "- Give every character who acted a moment in the spotlight.",
    "- Never decide what player characters say, think or choose. Describe the world and how it reacts, then invite the players to act.",
    "- When a player's action is vague about what they say or ask (for example \"I ask some questions\" or \"I chat to her\"), don't invent their words. Have the NPC react in character and end by asking that player what exactly they say or ask.",
    ...tone.story,
    "",
    "Fairness:",
    "- The game app rolls all dice. Never invent dice results. A failed check fails; a successful one succeeds.",
    "",
    "Rules:",
    rules.rulesSummary,
    "",
    "Character sheets (the app's record is the truth):",
    '- You cannot edit sheets directly. Every change to HP or belongings that happens in your narration MUST also appear in "changes", using only these ops:',
    rules.opsGuide,
    "- If it isn't in changes, it didn't happen: a wound narrated without a damage op is lost, and an item picked up without add_item never reaches the pack.",
    tone.danger,
    "- When characters find, loot, buy or are given something they could carry (coins, keys, potions, notes, trophies), add_item it. When they use up, give away, throw, break or lose an item, remove_item it. Rest, potions and healing restore HP with heal.",
    "- Use set_scene whenever the party arrives somewhere new.",
    "- Keep the Nearby list true: when a notable NPC or group appears, add them with an npc op; when their attitude or condition changes (an attack lands, they are persuaded, they flee), update them; when they leave, npc_gone them. Put set_scene before npc ops when the party moves.",
    "- Use characters' exact names. Only remove items a character actually has (see the party sheet).",
    "- Only remove items when the story takes, uses up, breaks or loses them. Downed or dead characters keep their belongings unless someone takes them.",
    tone.items,
    "",
    "Always reply with a single JSON object and nothing else.",
  ].join("\n");
}

export function campaignBlock(c: Campaign): string {
  const lines = [
    `Campaign: ${c.title}`, `Setting: ${c.setting}`,
    c.realism === "grounded" ? "Tone: grounded (realistic, nothing impossible)" : "Tone: fantastical",
  ];
  if (c.pitch) lines.push(`Pitch: ${c.pitch}`);
  if (c.outline) {
    lines.push(
      "Adventure outline (steer toward this, improvise within it):",
      `- Goal: ${c.outline.goal}`,
      `- Villain: ${c.outline.villain}`,
      `- Locations: ${c.outline.locations.join("; ")}`,
      `- Story beats: ${c.outline.beats.join(" → ")}`,
    );
  }
  if (c.sceneTitle) lines.push(`Current scene: ${c.sceneTitle}`);
  return lines.join("\n");
}

export function partyBlock(chars: Character[]): string {
  const lines = chars.map((c) => {
    const abilities = ABILITIES.map((a) => `${a} ${c.scores[a]} (${formatModifier(modifier(c.scores[a]))})`).join(", ");
    const items = c.items.length ? c.items.map((i) => `${i.name}${i.qty > 1 ? ` ×${i.qty}` : ""}`).join(", ") : "nothing";
    return `- ${c.name} (${c.concept}): Level ${c.level}, HP ${c.hp}/${c.maxHp}${c.hp <= 0 ? " [DOWNED]" : ""}. ${abilities}. Carrying: ${items}.`;
  });
  return ["Party (authoritative character sheets):", ...lines].join("\n");
}

export function nearbyBlock(npcs: Npc[]): string {
  if (npcs.length === 0) return "Nearby: nobody notable.";
  return ["Nearby (authoritative):", ...npcs.map((n) => `- ${n.name}: ${n.attitude}, ${n.condition}`)].join("\n");
}

export function adjudicateTask(actions: ActionInput[], dice: DiceMode = "normal"): string {
  return [
    "This round the players declared:",
    ...actions.map((a) => `- ${a.character}: ${a.text}`),
    "",
    "Decide which of these actions are risky or uncertain enough to need an ability check. Ordinary actions need no check.",
    ...(dice === "big"
      ? ["Only call for a check at a genuinely pivotal moment: where failure would change the course of the story (a confrontation, a big gamble, real danger). Everyday actions, conversations and most rounds need no check. At most one check this round."]
      : []),
    "At most one check per character, and only for characters listed above. Choose the most fitting ability (STR, DEX, CON, INT, WIS, CHA).",
    "DC guide: 5 very easy, 10 easy, 12-13 typical, 15 hard, 20 very hard, 25 nearly impossible.",
    "Most checks should be DC 10-15. Use 20 only for feats that would challenge a trained expert, and 25 almost never.",
    "Frame each check on what the character is trying to achieve, not what they are trying to avoid: a SUCCESS should mean they get what they wanted.",
    'Reply as JSON: {"checks": [{"character": "<name>", "ability": "DEX", "dc": 15, "reason": "<short reason>"}]}. Use an empty list if no checks are needed. Do not narrate yet.',
  ].join("\n");
}

export function resolveTask(input: ResolveInput, dice: DiceMode = "normal"): string {
  const lines = ["This round:", ...input.actions.map((a) => `- ${a.character}: ${a.text}`)];
  if (input.skipped.length) lines.push(`(${input.skipped.join(", ")} did not act this round; keep them in the scene but passive.)`);
  if (input.rolls.length) {
    lines.push("", "Dice results (final, do not change them):");
    for (const r of input.rolls) {
      const crit = r.crit === "nat20" ? " (natural 20: make it spectacular)" : r.crit === "nat1" ? " (natural 1: make it go memorably wrong)" : "";
      lines.push(`- ${r.character} ${r.ability} check: ${r.die} ${formatModifier(r.modifier)} = ${r.total} vs DC ${r.dc} (${r.reason}): ${r.success ? "SUCCESS" : "FAILURE"}${crit}`);
    }
  }
  lines.push(
    "",
    ...(dice === "off"
      ? ["There are no dice in this game. Decide outcomes fairly from the situation and the characters' abilities and condition. Plans can fail, people can say no, and actions have consequences; not everything succeeds."]
      : []),
    "Narrate what happens, honouring every result. End by inviting the players to act.",
    "If an action says a hero asks, talks or chats without giving their actual words, do not write those words for them: have the other person respond and end your narration with that person asking the hero, in quotes, what they want to say or know.",
    "Only call a roll a natural 20 or natural 1 when the dice results above say so.",
    'Then check your narration line by line and put every wound, healing, item gained or lost, change of location, and every person or group in the scene who appears, is hurt, changes attitude or leaves into "changes". A FAILURE in a fight or against a hazard normally means a damage op for that character.',
    "damage and heal ops are only for the heroes; when an NPC is hurt or healed, update their condition with an npc op instead.",
    "npc ops are only for non-player characters, never the heroes. Anyone present whom you name and who is not listed under Nearby must be added with an npc op before you can update them; only npc_gone someone who is listed under Nearby.",
    'Reply as JSON: {"narration": "<story text>", "changes": [<ops>]}, e.g. "changes": [{"op":"damage","character":"<name>","amount":4},{"op":"npc","name":"<npc name>","attitude":"hostile","condition":"wounded"},{"op":"add_item","character":"<name>","name":"<item name>","description":"<short description>","qty":1}]. Leave changes empty only if nothing changed for the heroes or the people nearby.',
  );
  return lines.join("\n");
}

export function openingTask(): string {
  return [
    "Begin the adventure. Introduce the party in the opening scene in 2-4 short paragraphs and end with a clear prompt for them to act.",
    "Include a set_scene op naming the opening location, and an npc op for each notable non-player character or group present (never the heroes). Do not add items: the characters already have their starting kits.",
    'Reply as JSON: {"narration": "<story text>", "changes": [<ops>]}.',
  ].join("\n");
}

export function reviveTask(): string {
  return [
    "The whole party has fallen. Narrate, in 2-3 short paragraphs, how they survive against the odds: they might be captured, rescued by someone unexpected, or wake somewhere strange.",
    "Keep consequences: enemies who beat them may still be around, and things may have been taken from them (remove_item those).",
    "Do not add heal ops: the app restores everyone to half health. If they wake somewhere new, put set_scene first, then add an npc op for anyone present. End by inviting the players to act.",
    'Reply as JSON: {"narration": "<story text>", "changes": [<ops>]}.',
  ].join("\n");
}

export function kitMessages(input: { name: string; concept: string; setting: string; realism: Realism }): ChatMessage[] {
  return [
    { role: "system", content: "You help players equip new characters for a tabletop roleplaying game. Always reply with a single JSON object and nothing else." },
    {
      role: "user",
      content: [
        `Setting: ${input.setting}`,
        `Character: ${input.name}, ${input.concept}`,
        input.realism === "grounded"
          ? "Suggest 3 to 5 everyday items a real person like this would carry in this setting: realistic and specific, nothing magical or impossible."
          : "Suggest 3 to 5 practical, flavourful starting items that fit this character. Keep them modest: no powerful magic.",
        'Reply as JSON: {"items": [{"name": "<short item name>", "description": "<one short sentence>"}]}.',
      ].join("\n"),
    },
  ];
}

export function summaryMessages(oldSummary: string, rounds: RoundTranscript[]): ChatMessage[] {
  return [
    { role: "system", content: "You keep the story-so-far notes for a tabletop roleplaying campaign. Always reply with a single JSON object and nothing else." },
    {
      role: "user",
      content: [
        `Story so far:\n${oldSummary || "(nothing yet)"}`,
        "",
        `New events:\n${rounds.map((r) => r.lines.join("\n")).join("\n\n")}`,
        "",
        "Rewrite the story-so-far in at most 300 words. Keep names, places, unresolved threads, promises, debts and important items.",
        'Reply as JSON: {"summary": "<text>"}.',
      ].join("\n"),
    },
  ];
}

export function buildMessages(ctx: DmContext, rules: RulesEngine, task: string, budgetTokens: number): ChatMessage[] {
  const system = systemPrompt(rules, ctx.campaign.realism);
  let rounds = [...ctx.recentRounds];
  const render = () => [
    campaignBlock(ctx.campaign),
    partyBlock(ctx.characters),
    nearbyBlock(ctx.npcs),
    ctx.campaign.summary ? `Story so far:\n${ctx.campaign.summary}` : "",
    rounds.length ? `Recent rounds:\n${rounds.map((r) => r.lines.join("\n")).join("\n\n")}` : "",
    task,
  ].filter(Boolean).join("\n\n");
  let user = render();
  while (rounds.length > 0 && estimateTokens(system + user) > budgetTokens) {
    rounds = rounds.slice(1);
    user = render();
  }
  return [{ role: "system", content: system }, { role: "user", content: user }];
}
