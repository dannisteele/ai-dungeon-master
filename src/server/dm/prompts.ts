import { formatModifier, modifier } from "../../shared/abilities";
import { ABILITIES, type Ability, type Campaign, type Character, type Crit } from "../../shared/types";
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

export function systemPrompt(rules: RulesEngine): string {
  return [
    "You are the Dungeon Master for a tabletop roleplaying game played by friends at home.",
    "",
    "Storytelling:",
    "- Narrate vividly but concisely: 1-3 short paragraphs per round.",
    "- Give every character who acted a moment in the spotlight.",
    "- Never decide what player characters say, think or choose. Describe the world and how it reacts, then invite the players to act.",
    "- Keep the story moving toward the campaign's goal, with danger, mystery and some humour.",
    "",
    "Fairness:",
    "- The game app rolls all dice. Never invent dice results. A failed check fails; a successful one succeeds.",
    "",
    "Rules:",
    rules.rulesSummary,
    "",
    "Changing character sheets:",
    '- You cannot edit sheets directly. List every change in "changes" using only these ops:',
    rules.opsGuide,
    "- Use characters' exact names. Only remove items a character actually has (see the party sheet).",
    "- Award items and level_up sparingly; level_up only after a major victory or milestone.",
    "",
    "Always reply with a single JSON object and nothing else.",
  ].join("\n");
}

export function campaignBlock(c: Campaign): string {
  const lines = [`Campaign: ${c.title}`, `Setting: ${c.setting}`];
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

export function adjudicateTask(actions: ActionInput[]): string {
  return [
    "This round the players declared:",
    ...actions.map((a) => `- ${a.character}: ${a.text}`),
    "",
    "Decide which of these actions are risky or uncertain enough to need an ability check. Ordinary actions need no check.",
    "At most one check per character, and only for characters listed above. Choose the most fitting ability (STR, DEX, CON, INT, WIS, CHA).",
    "DC guide: 10 easy, 15 moderate, 20 hard, 25 nearly impossible.",
    'Reply as JSON: {"checks": [{"character": "<name>", "ability": "DEX", "dc": 15, "reason": "<short reason>"}]}. Use an empty list if no checks are needed. Do not narrate yet.',
  ].join("\n");
}

export function resolveTask(input: ResolveInput): string {
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
    "Narrate what happens, honouring every result. End by inviting the players to act.",
    'Reply as JSON: {"narration": "<story text>", "changes": [<ops>]}. Use an empty changes list if nothing on the sheets changes.',
  );
  return lines.join("\n");
}

export function openingTask(): string {
  return [
    "Begin the adventure. Introduce the party in the opening scene in 2-4 short paragraphs and end with a clear prompt for them to act.",
    "Include a set_scene op naming the opening location. Do not add items: the characters already have their starting kits.",
    'Reply as JSON: {"narration": "<story text>", "changes": [<ops>]}.',
  ].join("\n");
}

export function kitMessages(input: { name: string; concept: string; setting: string }): ChatMessage[] {
  return [
    { role: "system", content: "You help players equip new characters for a tabletop roleplaying game. Always reply with a single JSON object and nothing else." },
    {
      role: "user",
      content: [
        `Setting: ${input.setting}`,
        `Character: ${input.name}, ${input.concept}`,
        "Suggest 3 to 5 practical, flavourful starting items that fit this character. Keep them modest: no powerful magic.",
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
  const system = systemPrompt(rules);
  let rounds = [...ctx.recentRounds];
  const render = () => [
    campaignBlock(ctx.campaign),
    partyBlock(ctx.characters),
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
