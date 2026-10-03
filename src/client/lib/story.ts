import type { Character, StoredEvent, StoredRoll } from "../../shared/types";

export type StoryEntry =
  | { kind: "narration"; id: number; text: string }
  | { kind: "action"; id: number; name: string; text: string }
  | { kind: "skip"; id: number; text: string }
  | { kind: "roll"; id: number; name: string; roll: StoredRoll };

export const nameOf = (chars: Character[], id: number) => chars.find((c) => c.id === id)?.name ?? "Someone";
export const isRoll = (e: StoredEvent): e is StoredRoll => e.type === "roll";

export function buildStory(events: StoredEvent[], chars: Character[]): StoryEntry[] {
  const out: StoryEntry[] = [];
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
