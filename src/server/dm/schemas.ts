import { z } from "zod";
import { ABILITIES } from "../../shared/types";
import type { RulesEngine } from "../rules/engine";

export const AdjudicateSchema = z.object({
  checks: z.array(z.object({
    character: z.string(),
    ability: z.enum(ABILITIES),
    dc: z.number(),
    reason: z.string(),
  })),
});
export type CheckDraft = z.infer<typeof AdjudicateSchema>["checks"][number];

/** Shape we ask Ollama for: narration first so it can stream. */
export const resolveFormatSchema = (rules: RulesEngine) =>
  z.object({ narration: z.string(), changes: z.array(rules.opSchema) });

/**
 * Op markup inside the story text. Small models sometimes write their changes into the narration
 * and leave "changes" empty; the reply is still valid JSON, so without this check the changes are
 * silently lost and the players see raw op text in the story.
 */
const LEAKED_OPS = /\b(set_scene|npc_gone|add_item|remove_item|adjust_stat|level_up)\b|"op"\s*:|\[\s*(npc|damage|heal)\s*,/;

/** Shape we accept: ops are validated one by one by the rules engine, so a bad op can't sink the round. */
export const ResolveParseSchema = z.object({
  narration: z.string().trim().min(1).refine((s) => !LEAKED_OPS.test(s), {
    message: 'the narration contains change ops. Keep the narration as pure story text and put every change in the "changes" list',
  }),
  changes: z.array(z.unknown()).default([]),
});
export type ResolveOutput = z.infer<typeof ResolveParseSchema>;

export const KitSchema = z.object({
  items: z.array(z.object({
    name: z.string().trim().min(1).max(60),
    description: z.string().trim().max(200),
  })).min(1),
});

export const SummarySchema = z.object({ summary: z.string().trim().min(1) });

export const toFormat = (schema: z.ZodType): object => z.toJSONSchema(schema, { io: "input" });
