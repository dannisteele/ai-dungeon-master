import { z } from "zod";
import { maxHpFor, SCORE_MAX, SCORE_MIN } from "../../shared/abilities";
import { ABILITIES, ATTITUDES, CONDITIONS, type Character, type Npc, type Op } from "../../shared/types";

export const MAX_NPCS = 12;

const name = z.string().trim().min(1).max(60);
const amount = z.number().int().min(1).max(50);

export const OpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("damage"), character: name, amount }),
  z.object({ op: z.literal("heal"), character: name, amount }),
  z.object({
    op: z.literal("add_item"), character: name, name,
    description: z.string().trim().max(200).default(""),
    qty: z.number().int().min(1).max(99).default(1),
  }),
  z.object({ op: z.literal("remove_item"), character: name, name, qty: z.number().int().min(1).max(99).default(1) }),
  z.object({ op: z.literal("adjust_stat"), character: name, stat: z.enum(ABILITIES), delta: z.union([z.literal(-1), z.literal(1)]) }),
  z.object({ op: z.literal("level_up"), character: name }),
  z.object({ op: z.literal("set_scene"), title: z.string().trim().min(1).max(80) }),
  z.object({ op: z.literal("npc"), name, attitude: z.enum(ATTITUDES), condition: z.enum(CONDITIONS) }),
  z.object({ op: z.literal("npc_gone"), name }),
]) satisfies z.ZodType<Op>;

export interface ApplyResult {
  characters: Character[];
  npcs: Npc[];
  applied: Op[];
  rejected: { op: unknown; reason: string }[];
  sceneTitle: string | null;
}

export function findCharacterByName(chars: Character[], name: string): Character | undefined {
  const wanted = name.trim().toLowerCase();
  return chars.find((c) => c.name.toLowerCase() === wanted);
}

export function recalcMaxHp(c: Character): void {
  const newMax = maxHpFor(c.scores.CON, c.level);
  const gain = newMax - c.maxHp;
  c.maxHp = newMax;
  c.hp = Math.min(newMax, Math.max(0, gain > 0 ? c.hp + gain : c.hp));
}

function applyOne(c: Character, op: Extract<Op, { character: string }>): string | null {
  switch (op.op) {
    case "damage":
      c.hp = Math.max(0, c.hp - op.amount);
      return null;
    case "heal":
      c.hp = Math.min(c.maxHp, c.hp + op.amount);
      return null;
    case "add_item": {
      const existing = c.items.find((i) => i.name.toLowerCase() === op.name.toLowerCase());
      if (existing) existing.qty += op.qty;
      else c.items.push({ name: op.name, description: op.description, qty: op.qty });
      return null;
    }
    case "remove_item": {
      const existing = c.items.find((i) => i.name.toLowerCase() === op.name.toLowerCase());
      if (!existing) return `${c.name} has no "${op.name}"`;
      if (existing.qty < op.qty) return `${c.name} only has ${existing.qty} × ${existing.name}`;
      existing.qty -= op.qty;
      if (existing.qty === 0) c.items = c.items.filter((i) => i !== existing);
      return null;
    }
    case "adjust_stat": {
      const next = c.scores[op.stat] + op.delta;
      if (next > SCORE_MAX) return `${op.stat} can't go above ${SCORE_MAX}`;
      if (next < SCORE_MIN) return `${op.stat} can't go below ${SCORE_MIN}`;
      c.scores[op.stat] = next;
      if (op.stat === "CON") recalcMaxHp(c);
      return null;
    }
    case "level_up":
      c.level += 1;
      c.pendingAbilityPoints += 2;
      recalcMaxHp(c);
      return null;
  }
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function applyOps(characters: Character[], rawOps: unknown[], npcs: Npc[] = []): ApplyResult {
  const chars = structuredClone(characters);
  const result: ApplyResult = { characters: chars, npcs: structuredClone(npcs), applied: [], rejected: [], sceneTitle: null };
  for (const raw of rawOps) {
    const parsed = OpSchema.safeParse(raw);
    if (!parsed.success) {
      result.rejected.push({ op: raw, reason: `invalid op: ${z.prettifyError(parsed.error)}` });
      continue;
    }
    const op = parsed.data;
    if (op.op === "set_scene") {
      result.sceneTitle = op.title;
      result.npcs = [];
      result.applied.push(op);
      continue;
    }
    if (op.op === "npc") {
      const npc: Npc = { name: op.name, attitude: op.attitude, condition: op.condition };
      const at = result.npcs.findIndex((n) => sameName(n.name, op.name));
      if (at >= 0) result.npcs[at] = npc;
      else if (result.npcs.length >= MAX_NPCS) { result.rejected.push({ op, reason: `too many NPCs in the scene (max ${MAX_NPCS})` }); continue; }
      else result.npcs.push(npc);
      result.applied.push(op);
      continue;
    }
    if (op.op === "npc_gone") {
      const at = result.npcs.findIndex((n) => sameName(n.name, op.name));
      if (at < 0) { result.rejected.push({ op, reason: `no NPC called "${op.name}" is here` }); continue; }
      result.npcs.splice(at, 1);
      result.applied.push(op);
      continue;
    }
    const target = findCharacterByName(chars, op.character);
    if (!target) {
      result.rejected.push({ op, reason: `unknown character "${op.character}"` });
      continue;
    }
    const reason = applyOne(target, op);
    if (reason) result.rejected.push({ op, reason });
    else result.applied.push(op);
  }
  return result;
}
