import type { Character, Snapshot } from "../../shared/types";
import type { RulesEngine } from "../rules/engine";
import type { Store } from "../store/store";
import { roundStatus } from "./status";

/** Characters who may act. If everyone is downed, everyone may act so the DM can decide their fate. */
export function activeCharacters(chars: Character[], rules: RulesEngine): Character[] {
  const up = chars.filter((c) => !rules.isDowned(c));
  return up.length > 0 ? up : chars;
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
  };
}
