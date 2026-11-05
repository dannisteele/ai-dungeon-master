import type { Character, StoredEvent } from "../../shared/types";

export type FeedbackKind = "bug" | "idea";

export interface NewIssue { title: string; body: string; labels: string[] }
export interface FiledIssue { number: number; url: string }

/** Files issues somewhere (GitHub in real life, a fake in tests). */
export interface IssueFiler { file(issue: NewIssue): Promise<FiledIssue> }

export class IssueFilerError extends Error {}

export function createGitHubIssueFiler(opts: { token: string; repo: string; fetch?: typeof fetch }): IssueFiler {
  const doFetch = opts.fetch ?? fetch;
  return {
    async file(issue) {
      let res: Response;
      try {
        res = await doFetch(`https://api.github.com/repos/${opts.repo}/issues`, {
          method: "POST",
          headers: {
            accept: "application/vnd.github+json",
            authorization: `Bearer ${opts.token}`,
            "content-type": "application/json",
            "user-agent": "ai-dungeon-master",
            "x-github-api-version": "2022-11-28",
          },
          body: JSON.stringify(issue),
          signal: AbortSignal.timeout(15_000),
        });
      } catch (e) {
        throw new IssueFilerError(`Couldn't reach GitHub: ${(e as Error).message}`);
      }
      const data = (await res.json().catch(() => ({}))) as { number?: number; html_url?: string; message?: string };
      if (!res.ok || data.number === undefined || !data.html_url) {
        throw new IssueFilerError(`GitHub said ${res.status}: ${data.message ?? "no details"}`);
      }
      return { number: data.number, url: data.html_url };
    },
  };
}

export interface FeedbackContext {
  kind: FeedbackKind;
  details: string;
  screen: string;
  appVersion: string;
  model: string;
  userAgent?: string;
  campaign?: { id: number; title: string; setting: string; sceneTitle: string; round: number };
  character?: Pick<Character, "name">;
  characters: Pick<Character, "id" | "name">[];
  events: StoredEvent[];
  now: Date;
}

const MAX_LINE = 600;
const clip = (s: string) => (s.length > MAX_LINE ? `${s.slice(0, MAX_LINE)}…` : s);

/** The recent story as short lines, oldest first, for a bug report. */
export function storyLines(events: StoredEvent[], characters: Pick<Character, "id" | "name">[]): string[] {
  const name = (id: number) => characters.find((c) => c.id === id)?.name ?? `hero ${id}`;
  return events.flatMap((e): string[] => {
    const at = `[round ${e.round}]`;
    switch (e.type) {
      case "action": return [`${at} **${name(e.characterId)}:** ${clip(e.text)}`];
      case "narration": return [`${at} **DM:** ${clip(e.text)}`];
      case "check_request": return [`${at} _check:_ ${name(e.characterId)} ${e.ability} DC ${e.dc} (${clip(e.reason)})`];
      case "roll": return [`${at} _roll:_ ${name(e.characterId)} ${e.ability} ${e.die}${e.modifier >= 0 ? "+" : ""}${e.modifier}=${e.total} vs DC ${e.dc} → ${e.success ? "success" : "fail"}`];
      case "op_rejected": return [`${at} _rejected change:_ ${clip(e.reason)}`];
      case "stall": return [`${at} _stalled in ${e.phase}:_ ${clip(e.error)}`];
      case "party_fallen": return [`${at} _the party fell_`];
      default: return [];
    }
  });
}

export function buildIssueBody(ctx: FeedbackContext): string {
  const parts = [ctx.details.trim() || "_No details given._", "", "---", "", "<details><summary>Context (added automatically)</summary>", ""];
  const facts: [string, string | undefined][] = [
    ["Sent", ctx.now.toISOString()],
    ["Screen", ctx.screen],
    ["App version", ctx.appVersion],
    ["Model", ctx.model],
    // Never "#2": GitHub would turn it into a link to issue or PR 2 and show that title instead.
    ["Campaign", ctx.campaign && `${ctx.campaign.title} (campaign ${ctx.campaign.id}), ${ctx.campaign.round === 0 ? "not started yet" : `round ${ctx.campaign.round}`}${ctx.campaign.sceneTitle ? `, ${ctx.campaign.sceneTitle}` : ""}`],
    ["Setting", ctx.campaign?.setting],
    ["Playing as", ctx.character?.name],
    ["Device", ctx.userAgent],
  ];
  for (const [label, value] of facts) if (value) parts.push(`- **${label}:** ${value}`);
  if (ctx.kind === "bug" && ctx.events.length) {
    parts.push("", "**Recent story**", "", ...storyLines(ctx.events, ctx.characters).map((l) => `> ${l.replace(/\n+/g, " ")}`));
  }
  parts.push("", "</details>");
  return parts.join("\n");
}
