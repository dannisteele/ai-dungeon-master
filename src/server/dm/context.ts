import { formatModifier } from "../../shared/abilities";
import type { Campaign, Character, Person, StoredEvent } from "../../shared/types";
import type { Store } from "../store/store";

export interface RoundTranscript { round: number; lines: string[] }
/** Everything the DM is shown. `people` is everyone met: present ones are Nearby, the rest are remembered. */
export interface DmContext { campaign: Campaign; characters: Character[]; people: Person[]; recentRounds: RoundTranscript[] }

export function transcriptFromEvents(events: StoredEvent[], characters: Character[]): RoundTranscript[] {
  const name = (id: number) => characters.find((c) => c.id === id)?.name ?? "Someone";
  const rounds = new Map<number, string[]>();
  const reasons = new Map<string, string>();
  for (const e of events) {
    const lines = rounds.get(e.round) ?? [];
    switch (e.type) {
      case "action": lines.push(`${name(e.characterId)}: ${e.text}`); break;
      case "skip": lines.push(`${name(e.characterId)} holds back this round.`); break;
      case "check_request": reasons.set(`${e.round}:${e.characterId}`, e.reason); break;
      case "roll": {
        const reason = reasons.get(`${e.round}:${e.characterId}`);
        const crit = e.crit === "nat20" ? " (natural 20)" : e.crit === "nat1" ? " (natural 1)" : "";
        lines.push(`[Roll] ${name(e.characterId)} ${e.ability} check: ${e.die} ${formatModifier(e.modifier)} = ${e.total} vs DC ${e.dc}${reason ? ` (${reason})` : ""}: ${e.success ? "success" : "failure"}${crit}`);
        break;
      }
      case "narration": lines.push(`DM: ${e.text}`); break;
      case "op_applied": {
        const op = e.op;
        switch (op.op) {
          case "damage": lines.push(`[Sheet] ${op.character} takes ${op.amount} damage`); break;
          case "heal": lines.push(`[Sheet] ${op.character} heals ${op.amount}`); break;
          case "add_item": lines.push(`[Sheet] ${op.character} gains ${op.name}${op.qty > 1 ? ` ×${op.qty}` : ""}`); break;
          case "remove_item": lines.push(`[Sheet] ${op.character} loses ${op.name}`); break;
          case "adjust_stat": lines.push(`[Sheet] ${op.character} ${op.stat} ${op.delta > 0 ? "+1" : "-1"}`); break;
          case "level_up": lines.push(`[Sheet] ${op.character} reaches a new level`); break;
          case "set_scene": lines.push(`[Scene] ${op.title}`); break;
          case "npc": lines.push(`[NPC] ${op.name}: ${op.attitude}, ${op.condition}${op.about ? `. ${op.about}` : ""}`); break;
          case "npc_gone": lines.push(`[NPC] ${op.name} leaves`); break;
        }
        break;
      }
      case "party_fallen": lines.push("[The party fell]"); break;
      default: continue;
    }
    rounds.set(e.round, lines);
  }
  return [...rounds.entries()].sort(([a], [b]) => a - b).map(([round, lines]) => ({ round, lines }));
}

/**
 * The DM's memory of the story so far: the players' own words (pinned) first, then the DM's summary
 * of what has happened since.
 */
export function memoryText(c: Pick<Campaign, "pinnedSummary" | "summary">): string {
  if (c.pinnedSummary && c.summary) return `${c.pinnedSummary}\n\nSince then:\n${c.summary}`;
  return c.pinnedSummary || c.summary;
}

/** The last round the players' own edit of the story covers, or null if they've never edited it. */
export function lastEditedThrough(events: StoredEvent[]): number | null {
  let last: number | null = null;
  for (const e of events) if (e.type === "summary" && e.edited) last = e.throughRound;
  return last;
}

export function buildContext(store: Store, campaignId: number, rounds = 10): DmContext {
  const campaign = store.getCampaign(campaignId);
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);
  const characters = store.getCharacters(campaignId);
  const people = store.getPeople(campaignId);
  // After the players rewrite the story so far, their version stands for everything up to the
  // edit: the DM's verbatim rounds start after it, so older rounds can't contradict it.
  const edited = lastEditedThrough(store.getEvents(campaignId));
  const events = campaign.roundNumber === 0 ? [] : store.getEvents(campaignId, {
    fromRound: Math.max(0, campaign.roundNumber - rounds, edited === null ? 0 : edited + 1),
    toRound: campaign.roundNumber - 1,
  });
  return { campaign, characters, people, recentRounds: transcriptFromEvents(events, characters) };
}
