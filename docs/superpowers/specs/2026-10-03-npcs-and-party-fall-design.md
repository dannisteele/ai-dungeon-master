# NPCs in the Scene and the Party Falling: Design

**Date:** 2026-10-03
**Status:** Approved in chat, pending written-spec review
**Builds on:** `2026-10-03-ai-dungeon-master-design.md`

## 1. Purpose

These come from the first real two-player session ("Test fun oh yes", played on `qwen3.5:9b`):

1. **NPC visibility and targeting.** Players couldn't see who was in the scene or who was hostile, and typos in names risked confusing the DM. Players need to see each NPC's attitude and rough condition at a glance, and to tap an NPC to fill an action such as "I attack Scarred Brute".
2. **Party wipe-out.** Both heroes reached 0 HP and the game carried on accepting actions from two corpses. A wiped party needs a clear ending with a way forward: revive at half HP with a story twist, or start a new campaign.

### Decisions made in chat

| Topic | Decision |
|---|---|
| How NPC data reaches the app | The DM reports it through the existing `changes` list, as new ops checked by the rules engine. There is no extra AI call. |
| What is tracked per NPC | Name, attitude (hostile, wary, neutral, friendly) and rough condition (unhurt, wounded, badly hurt, down). No HP or stats. |
| Tapping an NPC | A menu of Attack / Talk to / Watch that fills an editable sentence into the action box. |
| Revive | Every hero wakes at half max HP (rounded up). The DM narrates the twist (captured, rescued, waking somewhere). The campaign continues. |
| Who can press Revive or New campaign | Any player at the table. |

## 2. NPCs

### 2.1 Data

```ts
// src/shared/types.ts
export const ATTITUDES = ["hostile", "wary", "neutral", "friendly"] as const;
export type Attitude = (typeof ATTITUDES)[number];
export const CONDITIONS = ["unhurt", "wounded", "badly hurt", "down"] as const;
export type Condition = (typeof CONDITIONS)[number];
export interface Npc { name: string; attitude: Attitude; condition: Condition }

// added to the Op union
| { op: "npc"; name: string; attitude: Attitude; condition: Condition }
| { op: "npc_gone"; name: string }
```

- **Group NPCs.** A group is a single NPC whose name carries the count, e.g. `"Mercenaries (3)"`.
- **Snapshot.** `Snapshot` gains `npcs: Npc[]`.
- **Storage.** A new table `npcs(id, campaign_id, name, attitude, condition)` with a unique index on `(campaign_id, lower(name))`. The Store gains `getNpcs(campaignId): Npc[]` and `saveNpcs(campaignId, npcs: Npc[])`. `saveNpcs` replaces the campaign's whole list.

### 2.2 Rules (in `applyOps`)

- **Signature.** `applyOps(characters, ops, npcs = [])` takes the current NPC list and returns it updated in `ApplyResult.npcs`. It is pure, like the rest of `applyOps`.
- **Op order.** Ops apply in order.
  - **`set_scene`:** clears the NPC list at that point, so `npc` ops after it repopulate the new scene.
  - **`npc`:** adds or updates by name. Matching is case-insensitive on the trimmed name, and the newest spelling replaces the stored one.
  - **`npc_gone`:** removes an NPC. If no NPC has that name, the op is rejected with `no NPC called "<name>" is here`.
- **Validation.** NPC names are 1–60 characters. Attitude and condition must come from the lists above.
- **Limit.** At most 12 NPCs at once. An `npc` op that would add a 13th is rejected with `too many NPCs in the scene (max 12)`.
- **Persistence.** `commitNarration` saves `result.npcs` inside the same transaction as the round.

### 2.3 What the DM is told

- **NPC list.** A **Nearby** block follows the party block, e.g. `Nearby (authoritative): - Scarred Brute: hostile, wounded`, or `Nearby: nobody notable.`
- **New ops.** `rules.opsGuide` gains:
  - `{"op":"npc","name":NAME,"attitude":"hostile"|"wary"|"neutral"|"friendly","condition":"unhurt"|"wounded"|"badly hurt"|"down"}` (add or update someone in the scene)
  - `{"op":"npc_gone","name":NAME}` (they leave or are no longer relevant)
- **System-prompt bullet** under "Character sheets":
  > Keep the Nearby list true: when a notable NPC or group appears, add them with an npc op; when their attitude or condition changes (an attack lands, they are persuaded, they flee), update them; when they leave, npc_gone them. Put set_scene before npc ops when the party moves.
- **Transcript lines.** `transcriptFromEvents` renders:
  - an applied `npc` op as `[NPC] <name>: <attitude>, <condition>`
  - an applied `npc_gone` op as `[NPC] <name> leaves`

### 2.4 Play screen

- **Nearby strip.**
  - **Placement:** a row of chips directly above the action bar, hidden when the list is empty.
  - **Chip content:** the NPC's name with its condition in small text below. On a phone the strip scrolls sideways, inside its own container.
  - **Colours:** hostile `--danger`, wary `--gold`, neutral `--muted`, friendly `--success`.
  - **Downed NPCs:** the name is struck through and the chip is shown at 50% opacity.
- **Quick actions.**
  - Tapping a chip opens a small menu: **Attack**, **Talk to**, **Watch**.
  - Choosing one puts `I attack <name>`, `I talk to <name>` or `I watch <name> closely` into the action box. An empty box is replaced; text already in the box gets a space and the sentence appended.
  - The menu closes on a choice, on a tap outside it, or on Escape.
  - Chips can only be tapped while the viewer's hero can act, i.e. the round is `collecting`, the hero is active, and the hero hasn't acted yet. At any other time they are display-only.
- **Story tags.** Applied `npc` and `npc_gone` ops appear as the existing `sheet-chip` entries:
  - `npc`: `Scarred Brute: hostile, wounded`
  - `npc_gone`: `Scarred Brute leaves`
- **Pure helpers** (unit-tested) in `src/client/lib/npcs.ts`:
  - `quickActionText(kind: "attack" | "talk" | "watch", name: string): string`
  - `appendAction(current: string, sentence: string): string`

## 3. The party falls

### 3.1 States and events

```ts
export type AiPhase = "opening" | "adjudicating" | "resolving" | "reviving";
export type RoundState = "lobby" | "collecting" | "awaiting_rolls" | "stalled" | "fallen" | AiPhase;
// GameEvent gains:
| { type: "party_fallen" }
// ClientMsg gains:
| { t: "revive" }
```

`AI_PHASES` includes `"reviving"`. Pack-up refuses during it like any other AI phase.

### 3.2 Falling

- **Trigger.** After a resolved round commits, if the campaign has at least one hero and every hero has `hp <= 0`, then in the same transaction:
  - the campaign's `roundState` becomes `"fallen"` instead of `"collecting"`;
  - a `party_fallen` event is appended to the round that just finished;
  - `roundNumber` still advances.
- **No actions while fallen.** `submitAction`, `skip` and `roll` throw `GameError("The party has fallen. Revive or start a new campaign.")`.
- **Existing saves.** `recoverInterrupted()` also moves any campaign that is `collecting` with every hero at 0 HP (and at least one hero) into `"fallen"`. This rescues the existing "Test fun oh yes" campaign.

### 3.3 Reviving

- **Entry.** `TurnService.revive(id)` requires `roundState === "fallen"`. Any other state throws `GameError("Nobody needs reviving.")`. It runs inside the per-campaign lock.
- **The DM call.** It runs `runPhase(id, "reviving", …)`, which calls `dm.revive(ctx, stream)` and gets back a `ResolveOutput`.
- **Revive prompt.** A new prompt `reviveTask()`:
  > The whole party has fallen. Narrate, in 2-3 short paragraphs, how they survive against the odds: they might be captured, rescued by someone unexpected, or wake somewhere strange. Keep consequences: enemies who beat them may still be around, and things may have been taken from them (remove_item those). Do not add heal ops: the app restores everyone to half health. You may use set_scene, npc and npc_gone. End by inviting the players to act.
- **Commit** (one transaction):
  1. Apply the DM's ops. Any `damage` or `heal` op is rejected with `HP is set by the revive`. All other ops apply normally.
  2. Set every hero's HP to `ceil(maxHp / 2)`. This is `rules.reviveHp(c)`, the light rules' implementation.
  3. Append the narration and op events.
  4. Set the campaign to `collecting` with `roundNumber + 1`.
- **Failure.** A failure stalls with `stalledPhase: "reviving"`, and `retry` re-runs the revive.

### 3.4 Play screen

- **Fallen panel.** While the campaign is `fallen`, the action bar shows a panel titled **The party has fallen** with two buttons:
  - **Revive**, which sends `{t:"revive"}`;
  - **Start a new campaign**, which navigates to `#/new`.

  Watchers without a hero see the same panel.
- **During the revive.** `reviving` shows the usual "The Dungeon Master is weaving the tale…".
- **In the story.** `party_fallen` appears as an entry reading *The party has fallen.*, styled like the roll chip but in `--danger`.

## 4. Testing

- **rules:**
  - `npc` adds a new NPC and updates an existing one case-insensitively.
  - `npc_gone` removes an NPC; an unknown name is rejected.
  - `set_scene` clears NPCs, and `npc` ops after it repopulate.
  - The 12-NPC cap is enforced.
  - Invalid attitude or condition is rejected.
  - The input list is not mutated.
- **store:** NPCs round-trip; `saveNpcs` replaces the list; a duplicate name in one save merges to the last one.
- **dm:**
  - The Nearby block appears in prompts.
  - Transcript `[NPC]` lines.
  - `reviveTask` wording.
  - `dm.revive` streams and parses like `opening`.
- **turns:**
  - The party falls when every hero is at 0 HP after a resolve, and actions, skips and rolls are then refused.
  - Revive sets half HP, rejects damage and heal ops, returns to `collecting`, and advances the round.
  - A revive stall can be retried.
  - `recoverInterrupted` converts a `collecting` campaign with every hero at 0 HP.
  - NPCs persist across rounds and appear in the snapshot.
- **client:** `quickActionText`, `appendAction`, and story entries for `npc`, `npc_gone` and `party_fallen`.
- **smoke:** the report adds `npc updates: <count of npc and npc_gone ops>`. A run on `qwen3.5:9b` should show at least one NPC update.

## 5. Out of scope

NPC HP or stats, initiative, targeting fellow heroes from the strip, death saves, and keeping the old "everyone may act when all are downed" behaviour beyond the fall. That behaviour is still in the code, but it is no longer reachable after a resolve, because the round ends in `fallen`.
