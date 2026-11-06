import type { Campaign, Character, Snapshot } from "../../shared/types";
import type { RulesEngine } from "../rules/engine";
import type { Store } from "../store/store";
import { roundStatus } from "./status";

/** Characters who may act. If everyone is downed, everyone may act so the DM can decide their fate. */
export function activeCharacters(chars: Character[], rules: RulesEngine): Character[] {
  const up = chars.filter((c) => !rules.isDowned(c));
  return up.length > 0 ? up : chars;
}

/** Why the latest DM reply can't be tried again right now, or null if it can. */
export function whyNoTryAgain(store: Store, c: Campaign): string | null {
  if (c.roundState !== "collecting" && c.roundState !== "fallen") return "There's no reply to try again right now.";
  const cp = store.getCheckpoint(c.id);
  if (!cp || cp.round !== c.roundNumber - 1) return "Only the Dungeon Master's latest reply can be tried again.";
  const since = store.getEvents(c.id, { fromRound: c.roundNumber });
  if (since.some((e) => e.type === "action" || e.type === "skip")) return "Someone has already acted since that reply, so it can't be tried again. You can still edit it.";
  if (since.some((e) => e.type === "summary" && e.edited)) return "The story so far was edited since that reply, so it can't be tried again. You can still edit it.";
  return null;
}

export function buildSnapshot(store: Store, rules: RulesEngine, campaignId: number): Snapshot {
  const campaign = store.getCampaign(campaignId);
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);
  const characters = store.getCharacters(campaignId);
  return {
    campaign,
    characters,
    npcs: store.getNpcs(campaignId),
    people: store.getPeople(campaignId),
    events: store.getEvents(campaignId, { limit: 300 }),
    round: roundStatus(store.getEvents(campaignId, { fromRound: campaign.roundNumber, toRound: campaign.roundNumber })),
    activeIds: activeCharacters(characters, rules).map((c) => c.id),
    canTryAgain: whyNoTryAgain(store, campaign) === null,
  };
}
