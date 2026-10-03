import type { PendingCheck, RoundStatus, StoredEvent } from "../../shared/types";

export function roundStatus(events: StoredEvent[]): RoundStatus {
  const status: RoundStatus = { actions: [], skippedIds: [], checks: [] };
  for (const e of events) {
    switch (e.type) {
      case "action": status.actions.push({ characterId: e.characterId, text: e.text }); break;
      case "skip": status.skippedIds.push(e.characterId); break;
      case "check_request":
        status.checks.push({ characterId: e.characterId, ability: e.ability, dc: e.dc, reason: e.reason, roll: null } satisfies PendingCheck);
        break;
      case "roll": {
        const check = status.checks.find((c) => c.characterId === e.characterId && !c.roll);
        if (check) {
          const { type, characterId, ability, die, dc, modifier, total, success, crit } = e;
          check.roll = { type, characterId, ability, die, dc, modifier, total, success, crit };
        }
        break;
      }
    }
  }
  return status;
}
