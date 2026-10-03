import { randomInt } from "node:crypto";
import { modifier } from "../../shared/abilities";
import type { CheckOutcome } from "../../shared/types";

export type D20 = () => number;

export const rollD20: D20 = () => randomInt(1, 21);

export function resolveCheck(die: number, score: number, dc: number): CheckOutcome {
  const mod = modifier(score);
  const total = die + mod;
  const crit = die === 20 ? "nat20" : die === 1 ? "nat1" : null;
  const success = crit === "nat20" ? true : crit === "nat1" ? false : total >= dc;
  return { modifier: mod, total, success, crit };
}
