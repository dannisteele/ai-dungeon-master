import type { z } from "zod";
import { validatePointBuy, maxHpFor, SCORE_MAX } from "../../shared/abilities";
import type { Ability, Character, CheckOutcome, Npc, Op, Scores } from "../../shared/types";
import { resolveCheck } from "./dice";
import { applyOps, OpSchema, recalcMaxHp, type ApplyResult } from "./ops";

export interface RulesEngine {
  readonly name: string;
  /** Plain-English rules for the DM system prompt. */
  readonly rulesSummary: string;
  /** One line per op, shown to the DM. */
  readonly opsGuide: string;
  readonly opSchema: z.ZodType<Op>;
  validateNewCharacter(scores: Scores): string | null;
  startingMaxHp(scores: Scores): number;
  check(die: number, scores: Scores, ability: Ability, dc: number): CheckOutcome;
  applyOps(characters: Character[], ops: unknown[], npcs?: Npc[]): ApplyResult;
  spendAbilityPoint(c: Character, ability: Ability): { character: Character } | { error: string };
  isDowned(c: Character): boolean;
  /** HP every hero wakes with after the party is revived. */ reviveHp(c: Character): number;
}

export const lightRules: RulesEngine = {
  name: "light-5e-abilities",
  rulesSummary: [
    "- Six abilities (STR, DEX, CON, INT, WIS, CHA) use D&D 5e scores; modifier = (score - 10) / 2, rounded down.",
    "- Ability check: d20 + modifier vs a DC (10 easy, 12-13 typical, 15 hard, 20 very hard, 25 nearly impossible; most checks are 10-15). Natural 20 always succeeds; natural 1 always fails.",
    "- A character at 0 HP is downed and cannot act until healed.",
    "- There are no classes, spells or armour class: describe magic and combat in the story and use damage/heal ops for harm and recovery. Typical damage: 1-4 minor, 5-8 serious, 9-15 deadly.",
  ].join("\n"),
  opsGuide: [
    '- {"op":"damage","character":NAME,"amount":1-50}',
    '- {"op":"heal","character":NAME,"amount":1-50}',
    '- {"op":"add_item","character":NAME,"name":ITEM,"description":SHORT_TEXT,"qty":1}',
    '- {"op":"remove_item","character":NAME,"name":ITEM,"qty":1}',
    '- {"op":"adjust_stat","character":NAME,"stat":"STR"|"DEX"|"CON"|"INT"|"WIS"|"CHA","delta":1 or -1}  (a permanent change; rare)',
    '- {"op":"level_up","character":NAME}',
    '- {"op":"set_scene","title":SHORT_PLACE_NAME}  (when the party arrives somewhere new)',
    '- {"op":"npc","name":NAME,"attitude":"hostile"|"wary"|"neutral"|"friendly","condition":"unhurt"|"wounded"|"badly hurt"|"down","about":ONE_OR_TWO_SENTENCES}  (add or update someone in the scene; "about" is optional: who they are, included when they first appear or something important changes)',
    '- {"op":"npc_gone","name":NAME}  (they leave or are no longer relevant)',
  ].join("\n"),
  opSchema: OpSchema,
  validateNewCharacter: validatePointBuy,
  startingMaxHp: (scores) => maxHpFor(scores.CON, 1),
  check: (die, scores, ability, dc) => resolveCheck(die, scores[ability], dc),
  applyOps,
  spendAbilityPoint(c, ability) {
    if (c.pendingAbilityPoints <= 0) return { error: "No ability points to spend" };
    if (c.scores[ability] >= SCORE_MAX) return { error: `${ability} is already ${SCORE_MAX}` };
    const next = structuredClone(c);
    next.scores[ability] += 1;
    next.pendingAbilityPoints -= 1;
    if (ability === "CON") recalcMaxHp(next);
    return { character: next };
  },
  isDowned: (c) => c.hp <= 0,
  reviveHp: (c) => Math.ceil(c.maxHp / 2),
};
