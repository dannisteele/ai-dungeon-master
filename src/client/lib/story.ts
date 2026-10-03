import type { Character, StoredEvent, StoredRoll } from "../../shared/types";

export type StoryEntry =
  | { kind: "narration"; id: number; text: string }
  | { kind: "action"; id: number; name: string; text: string }
  | { kind: "skip"; id: number; text: string }
  | { kind: "roll"; id: number; name: string; roll: StoredRoll }
  | { kind: "sheet"; id: number; text: string }
  | { kind: "fallen"; id: number };

export const nameOf = (chars: Character[], id: number) => chars.find((c) => c.id === id)?.name ?? "Someone";
export const isRoll = (e: StoredEvent): e is StoredRoll => e.type === "roll";

export function buildStory(events: StoredEvent[], chars: Character[]): StoryEntry[] {
  const out: StoryEntry[] = [];
  const levelUpsSeen = new Map<string, number>();
  for (const e of events) {
    if (e.type === "op_applied" && e.op.op === "level_up") {
      const key = e.op.character.trim().toLowerCase();
      levelUpsSeen.set(key, (levelUpsSeen.get(key) ?? 0) + 1);
    }
  }
  const runningLevel = new Map<string, number>();
  for (const c of chars) runningLevel.set(c.name.trim().toLowerCase(), c.level - (levelUpsSeen.get(c.name.trim().toLowerCase()) ?? 0));

  for (const e of events) {
    switch (e.type) {
      case "narration": out.push({ kind: "narration", id: e.id, text: e.text }); break;
      case "action": out.push({ kind: "action", id: e.id, name: nameOf(chars, e.characterId), text: e.text }); break;
      case "skip":
        out.push({
          kind: "skip", id: e.id,
          text: e.skippedBy === e.characterId
            ? `${nameOf(chars, e.characterId)} holds back this round.`
            : `${nameOf(chars, e.skippedBy)} went ahead without ${nameOf(chars, e.characterId)}.`,
        });
        break;
      case "roll": out.push({ kind: "roll", id: e.id, name: nameOf(chars, e.characterId), roll: e as StoredRoll }); break;
      case "party_fallen": out.push({ kind: "fallen", id: e.id }); break;
      case "op_applied": {
        const op = e.op;
        if (op.op === "set_scene") break;
        let text: string;
        switch (op.op) {
          case "damage": text = `${op.character} −${op.amount} HP`; break;
          case "heal": text = `${op.character} +${op.amount} HP`; break;
          case "add_item": text = `${op.character} gains ${op.name}${op.qty > 1 ? ` ×${op.qty}` : ""}`; break;
          case "remove_item": text = `${op.character} loses ${op.name}`; break;
          case "adjust_stat": text = `${op.character} ${op.stat} ${op.delta > 0 ? "+1" : "-1"}`; break;
          case "level_up": {
            const key = op.character.trim().toLowerCase();
            const next = (runningLevel.get(key) ?? 0) + 1;
            runningLevel.set(key, next);
            text = `${op.character} reaches level ${next}`;
            break;
          }
          case "npc": text = `${op.name}: ${op.attitude}, ${op.condition}`; break;
          case "npc_gone": text = `${op.name} leaves`; break;
        }
        out.push({ kind: "sheet", id: e.id, text });
        break;
      }
    }
  }
  return out;
}

/** Lower-cased names of items given to this character in the most recently resolved round. */
export function newItemNames(events: StoredEvent[], characterName: string, roundNumber: number): Set<string> {
  const who = characterName.toLowerCase();
  const names = new Set<string>();
  for (const e of events) {
    if (e.round === roundNumber - 1 && e.type === "op_applied" && e.op.op === "add_item" && e.op.character.trim().toLowerCase() === who) {
      names.add(e.op.name.toLowerCase());
    }
  }
  return names;
}
