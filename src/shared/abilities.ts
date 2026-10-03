import { ABILITIES, type Scores } from "./types";

export const POINT_BUY_BUDGET = 27;
export const SCORE_MIN = 1;
export const SCORE_MAX = 20;
const POINT_BUY_COST: Record<number, number> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };

export function modifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function formatModifier(mod: number): string {
  return mod >= 0 ? `+${mod}` : `${mod}`;
}

export function baseScores(): Scores {
  return { STR: 8, DEX: 8, CON: 8, INT: 8, WIS: 8, CHA: 8 };
}

export function pointBuyCost(scores: Scores): number | null {
  let total = 0;
  for (const a of ABILITIES) {
    const cost = POINT_BUY_COST[scores[a]];
    if (cost === undefined) return null;
    total += cost;
  }
  return total;
}

export function validatePointBuy(scores: Scores): string | null {
  const cost = pointBuyCost(scores);
  if (cost === null) return "Each ability must be a whole number between 8 and 15 at creation.";
  if (cost > POINT_BUY_BUDGET) return `Point buy uses ${cost} of ${POINT_BUY_BUDGET} points.`;
  return null;
}

export function maxHpFor(con: number, level: number): number {
  const m = modifier(con);
  return Math.max(10, 20 + 2 * m) + (level - 1) * Math.max(1, 5 + m);
}
