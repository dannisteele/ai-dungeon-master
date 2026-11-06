import { readFileSync } from "node:fs";
import { z } from "zod";
import type { ChatClient, ChatMessage } from "../dm/ollama";
import { toFormat } from "../dm/schemas";

export interface HelpTurn { role: "user" | "assistant"; content: string }

/** Exchanges of earlier conversation kept, so follow-up questions make sense without a long prompt. */
const HISTORY = 6;
const HelpSchema = z.object({ answer: z.string().min(1) });
const FORMAT = toFormat(HelpSchema);

/** The player's manual, docs/manual.md. */
export function loadManual(): string {
  return readFileSync(new URL("../../../docs/manual.md", import.meta.url), "utf8");
}

export function helpMessages(manual: string, question: string, history: HelpTurn[]): ChatMessage[] {
  return [
    {
      role: "system",
      content: [
        "You are the friendly help desk for a storytelling game the player runs on their own laptop. Here is the game's manual:",
        "",
        manual,
        "",
        "Answer only from the manual. Use the exact button names, in bold, and give short step-by-step answers in plain British English.",
        "If the manual doesn't cover the question, say you're not sure and suggest sending it with Feedback. Don't make up buttons or features.",
        'Reply as JSON: {"answer": "<text>"}.',
      ].join("\n"),
    },
    ...history.slice(-HISTORY),
    { role: "user", content: question },
  ];
}

export async function askHelp(chat: ChatClient, manual: string, question: string, history: HelpTurn[]): Promise<string> {
  const raw = await chat.chat({ messages: helpMessages(manual, question, history), format: FORMAT });
  return HelpSchema.parse(JSON.parse(raw)).answer;
}
