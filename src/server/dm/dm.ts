import { z } from "zod";
import type { KitItem } from "../../shared/types";
import type { RulesEngine } from "../rules/engine";
import type { DmContext, RoundTranscript } from "./context";
import { NarrationExtractor } from "./narrationStream";
import { OllamaError, type ChatClient, type ChatMessage } from "./ollama";
import {
  adjudicateTask, buildMessages, kitMessages, openingTask, resolveTask, summaryMessages,
  type ActionInput, type ResolveInput,
} from "./prompts";
import {
  AdjudicateSchema, KitSchema, ResolveParseSchema, SummarySchema, resolveFormatSchema, toFormat,
  type CheckDraft, type ResolveOutput,
} from "./schemas";

export class DmError extends Error {}

export interface StreamHandlers { onChunk(text: string): void; onRestart(): void }

export interface DungeonMaster {
  adjudicate(ctx: DmContext, actions: ActionInput[]): Promise<CheckDraft[]>;
  resolve(ctx: DmContext, input: ResolveInput, stream: StreamHandlers): Promise<ResolveOutput>;
  opening(ctx: DmContext, stream: StreamHandlers): Promise<ResolveOutput>;
  startingKit(input: { name: string; concept: string; setting: string }): Promise<KitItem[]>;
  summarise(oldSummary: string, rounds: RoundTranscript[]): Promise<string>;
}

export function createDungeonMaster(deps: { chat: ChatClient; rules: RulesEngine; budgetTokens: number }): DungeonMaster {
  const { chat, rules, budgetTokens } = deps;
  const adjudicateFormat = toFormat(AdjudicateSchema);
  const resolveFormat = toFormat(resolveFormatSchema(rules));
  const kitFormat = toFormat(KitSchema);
  const summaryFormat = toFormat(SummarySchema);

  async function callStructured<T>(messages: ChatMessage[], parser: z.ZodType<T>, format: object, stream?: StreamHandlers): Promise<T> {
    let lastError = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const msgs: ChatMessage[] = attempt === 0 ? messages : [
        ...messages,
        { role: "user", content: `Your previous reply was not valid: ${lastError}\nReply again with valid JSON only, in the required format.` },
      ];
      if (attempt > 0) stream?.onRestart();
      const extractor = new NarrationExtractor();
      let raw: string;
      try {
        raw = await chat.chat({
          messages: msgs, format,
          onToken: stream ? (t) => { const s = extractor.push(t); if (s) stream.onChunk(s); } : undefined,
        });
      } catch (e) {
        if (e instanceof OllamaError) throw new DmError(e.message);
        throw e;
      }
      let json: unknown;
      try { json = JSON.parse(raw); } catch { lastError = "it was not valid JSON"; continue; }
      const parsed = parser.safeParse(json);
      if (parsed.success) return parsed.data;
      lastError = z.prettifyError(parsed.error);
    }
    throw new DmError(`The Dungeon Master gave an unusable reply twice (${lastError})`);
  }

  return {
    async adjudicate(ctx, actions) {
      const out = await callStructured(buildMessages(ctx, rules, adjudicateTask(actions), budgetTokens), AdjudicateSchema, adjudicateFormat);
      return out.checks;
    },
    resolve(ctx, input, stream) {
      return callStructured(buildMessages(ctx, rules, resolveTask(input), budgetTokens), ResolveParseSchema, resolveFormat, stream);
    },
    opening(ctx, stream) {
      return callStructured(buildMessages(ctx, rules, openingTask(), budgetTokens), ResolveParseSchema, resolveFormat, stream);
    },
    async startingKit(input) {
      const out = await callStructured(kitMessages(input), KitSchema, kitFormat);
      return out.items.slice(0, 5);
    },
    async summarise(oldSummary, rounds) {
      const out = await callStructured(summaryMessages(oldSummary, rounds), SummarySchema, summaryFormat);
      return out.summary;
    },
  };
}
