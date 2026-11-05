# Grounded Stories, Dice Settings, People Cards and Editable Memory: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Rach play realistic stories, with dice turned down or off, with people who persist as cards she can read and correct, and with a DM memory she can rewrite. Feedback reports carry story text only if she asks.

**Architecture:**
- **Storage.** The SQLite store gains versioned migrations (`PRAGMA user_version`). Campaigns get `realism`, `dice` and `pinned_summary`, and NPCs move into a persistent `people` table. The Nearby list is the present subset of that table, so `applyOps` keeps working on `Npc[]`.
- **Prompts.** Prompt builders read the campaign's realism and dice mode.
- **Turn flow.** `TurnService` skips or limits adjudication based on the dice mode.
- **Interface.** New routes and React panels: settings, people, and a memory editor.

**Tech Stack:** TypeScript, Node 24, Fastify 5, better-sqlite3, zod 4, React, vitest. Windows scripts are not touched.

**Spec:** `docs/superpowers/specs/2026-11-05-grounded-dice-people-memory-design.md`

## Global Constraints

- One PR per task. PR titles are player-facing release notes, so write them for Rach. Commits use `feat:`/`fix:` so the release job bumps the version. Merge only once CI (Linux and Windows) is green.
- Existing saves must upgrade in place. Never drop data except the old `npcs` table, after it's copied.
- Realism values: `"grounded" | "fantastical"`. Dice values: `"normal" | "big" | "off"`. Existing campaigns default to `fantastical` / `normal`. New grounded campaigns default to dice `big`, and fantastical ones to `normal`.
- Character limits:
  - DM-written `about`: 300 characters (op schema)
  - player `about` and `notes`: 500 each
  - pinned summary: 1–4000
  - per present person in the prompt: 400
  - Nearby block: 3000
  - absent-people block: 12 people and 2000 characters
- Anything that edits the game (settings, people, summary) is refused with 409 while `roundState` is in `AI_PHASES`. Summary edits are also refused while a summary is being generated.
- No story text in feedback unless `includeStory` is true. Without it, own-pitch campaigns show "Own pitch" and the scene title is omitted.
- UI follows existing patterns: panels reuse `.recap-backdrop`/`.recap-panel`, header buttons reuse `.header-btn` with `label-long`/`label-short`.

## Review Focus

1. **A save from today, mid-game.** Campaigns at various round states with NPCs present should upgrade, keep their NPCs as present people, and stay playable. Reopening must not re-run the migration. → Task 1.
2. **One person named two ways.** "Mrs Bell" and " mrs bell" must be the same card, whether written by an op, the summariser or the PATCH route. → Tasks 1 and 5.
3. **Dice switched to Off while rolls are pending.** The current round still accepts its rolls and resolves; the new mode applies from the next adjudication. → Task 4.
4. **Editing memory before anything has happened.** Editing in the lobby or at round 1, with an empty summary, should pin the text and not narrow the DM's rounds wrongly (`throughRound` 0). → Task 7.
5. **Feedback from the lobby with the story box ticked.** There's no campaign, so no story is attached and nothing crashes. → Task 2.

---

### Task 1: Store migrations, the new columns, and persistent people

**Files:**
- Modify: `src/server/store/store.ts`
- Modify: `src/shared/types.ts`
- Modify: `src/server/turns/snapshot.ts`
- Modify: `src/server/turns/turns.ts` (`commitNarration` passes the round)
- Test: `tests/server/store/store.test.ts`
- Test: `tests/server/store/migrations.test.ts` (new)

**Interfaces:**
- Produces in `types.ts`:
  - `export const REALISMS = ["grounded", "fantastical"] as const; export type Realism`
  - `export const DICE_MODES = ["normal", "big", "off"] as const; export type DiceMode`
  - `Campaign` gains `realism: Realism; dice: DiceMode; pinnedSummary: string`
  - `export interface Person { name: string; about: string; notes: string; attitude: Attitude; condition: Condition; present: boolean; lastSeenRound: number; aboutEdited: boolean }`
  - `Npc` gains an optional `about?: string`
  - `Snapshot` gains `people: Person[]`
  - The `summary` GameEvent gains `edited?: boolean`
- Produces in the store:
  - `NewCampaignInput` gains optional `realism?: Realism; dice?: DiceMode` (defaults fantastical/normal)
  - `CampaignPatch` gains `realism | dice | pinnedSummary`
  - `getPeople(campaignId): Person[]`: present first, then `last_seen_round DESC`, then `id`
  - `updatePerson(campaignId, name, patch: { about?: string; notes?: string; aboutEdited?: boolean }): boolean`: false if there's no such person. Matching is case- and trim-insensitive.
  - `setPersonAbout(campaignId, name, about): void`: a no-op if there's no such person or `about_edited` is set
  - `saveNpcs(campaignId, npcs: Npc[], round = 0)`, with new semantics: upsert each into `people` as present, with that attitude and condition and `last_seen_round = round`. Set `about` from `npc.about` when it's given and the card isn't `about_edited`. Mark everyone else present = 0. **Never delete.**
  - `getNpcs` keeps its signature and returns present people as `Npc` (name, attitude, condition).
  - `export const SCHEMA_VERSION = 1`

- [ ] **Step 1: Write the failing migration tests** in `tests/server/store/migrations.test.ts`. Build a version-0 database file in a temp dir by running the *old* schema SQL. Copy it into the test as a `V0_SCHEMA` string from the current `SCHEMA` constant: campaigns, characters, items, events, npcs, settings. Insert a campaign at `round_state='collecting', round_number=3` and two npcs. Then `createStore(path)` and assert:
  - `getCampaign(id)` has `realism: "fantastical", dice: "normal", pinnedSummary: ""`
  - `getNpcs(id)` returns both npcs
  - `getPeople(id)` returns both, with `present: true, about: "", notes: "", aboutEdited: false`
  - `db.pragma("user_version", { simple: true })` is 1
  - Closing and reopening keeps the same people and doesn't throw. This proves the migration doesn't re-run.

- [ ] **Step 2: Write the failing people tests** in `store.test.ts`:
  - `saveNpcs` then `saveNpcs` without one person keeps that person, with `present: false`
  - names that differ only by case or spaces upsert one card
  - `last_seen_round` is updated when a round is passed
  - `about` from an `Npc` is stored, but not when `aboutEdited`
  - `updatePerson` returns false for unknown names and updates `notes`/`about`/`aboutEdited`
  - `setPersonAbout` respects `aboutEdited`
  - `deleteCampaign` cascades to people
  - `createCampaign({..., realism: "grounded", dice: "big"})` round-trips
  - `updateCampaign(id, { dice: "off", realism: "grounded", pinnedSummary: "x" })` round-trips

- [ ] **Step 3: Run the tests and check they fail.** `npx vitest run tests/server/store` should fail (unknown columns or methods).

- [ ] **Step 4: Implement the changes in `store.ts`.**
  - **Migrations:** `const MIGRATIONS: ((db) => void)[]`. Index 0 is migration 1:
    - `ALTER TABLE campaigns ADD COLUMN` realism, dice and pinned_summary, with the spec's CHECKs and defaults
    - `CREATE TABLE people` (spec §2, plus `about_edited INTEGER NOT NULL DEFAULT 0` and `UNIQUE (campaign_id, name COLLATE NOCASE)`)
    - `INSERT INTO people (campaign_id, name, attitude, condition, present) SELECT campaign_id, name, attitude, condition, 1 FROM npcs ORDER BY id`
    - `DROP TABLE npcs`
  - After `db.exec(SCHEMA)`, run each migration whose index is ≥ `user_version`, in its own `db.transaction`, then set `user_version`.
  - Remove the `npcs` table from `SCHEMA`. New databases get `people` from migration 1 too, so there's one path.
  - Store trimmed names. Match with `lower(trim(name))`.
  - Update `toCampaign`/`CampaignRow`/`PATCH_COLUMNS`, and `createCampaign` for realism and dice.

- [ ] **Step 5: Pass the round and fill the snapshot.** In `turns.ts` `commitNarration`, call `store.saveNpcs(id, result.npcs, c.roundNumber)`. In `buildSnapshot`, add `people: store.getPeople(campaignId)`. In `ops.ts`, the `npc` op handling keeps `about` on the `Npc` it pushes, once Task 5 adds the field. For now `Npc.about` is just carried through if present.

- [ ] **Step 6: Run everything.** `npm test && npm run typecheck`: everything passes, including the existing "NPCs persist across rounds" turns test.

- [ ] **Step 7: Commit and open the PR** "Behind the scenes: save files can now be upgraded safely" (commit `feat: versioned save upgrades, and people who persist between scenes`). Merge once CI passes.

### Task 2: Feedback attaches the story only when asked

**Files:**
- Modify: `src/server/feedback/github.ts`
- Modify: `src/server/routes/api.ts` (FeedbackSchema and route)
- Modify: `src/server/campaigns/presets.ts` (`settingLabel`)
- Modify: `src/client/components/FeedbackPanel.tsx`
- Modify: `src/client/lib/api.ts` (`FeedbackRequest`)
- Test: `tests/server/feedback/github.test.ts`
- Test: `tests/server/app.test.ts`
- Test: `tests/server/campaigns/presets.test.ts`

**Interfaces:**
- `settingLabel(c, { includePitch: boolean })`: when `includePitch` is false, an own pitch returns `"Own pitch"`.
- `FeedbackContext` gains `includeStory: boolean; summary?: string`.
  - `campaign.sceneTitle` is printed only when `includeStory`.
  - The "Recent story" block is printed only when `includeStory` (for **both** kinds).
  - A "Story so far" block shows `summary` when `includeStory` and the summary is non-empty. Once Task 7 lands, the summary is the pinned text and the "since" text joined by a blank line.
- `FeedbackSchema` gains `includeStory: z.boolean().default(false)`.
- `FeedbackRequest` (client) gains `includeStory: boolean`.

- [ ] **Step 1: Write the failing tests.**
  - `github.test.ts`: `buildIssueBody` with `includeStory: false` and events contains no `Recent story` and no scene title. With `true` it contains both, plus a `**Story so far**` block when a summary is given.
  - `presets.test.ts`: `settingLabel(pitchCampaign, { includePitch: false })` is `"Own pitch"`.
  - `app.test.ts`:
    - Update "files a bug report with the recent story attached": send `includeStory: true` and expect the story; send another without it and expect `not.toContain("I open the crypt")`.
    - A lobby report (no campaignId) with `includeStory: true` succeeds with no story section (Review Focus 5).

- [ ] **Step 2: Run them and check they fail.** `npx vitest run tests/server/feedback tests/server/app.test.ts tests/server/campaigns` should fail.

- [ ] **Step 3: Implement the changes in the server files listed.** The route passes `summary: campaign.summary` and `includeStory`.

- [ ] **Step 4: Change the client panel.**
  - `FeedbackPanel` gets a tick box, shown only when `campaignId !== undefined`, labelled exactly: `Include the story so far (this will be public on GitHub)`. It is unticked by default.
  - Remove the old "The last few moments of the story are sent along too…" line.

- [ ] **Step 5: Run everything.** `npm test && npm run typecheck && npm run build` should all pass.

- [ ] **Step 6: Commit and open the PR** "Feedback reports only include your story if you tick the box" (commit `fix: feedback reports include story text only when asked`). Merge.

### Task 3: Grounded or Fantastical

**Files:**
- Modify: `src/shared/types.ts`
- Modify: `src/server/campaigns/presets.ts`
- Modify: `src/server/campaigns/adventures.ts`
- Modify: both adventure JSON files
- Modify: `src/server/routes/api.ts` (NewCampaignSchema)
- Modify: `src/server/dm/prompts.ts`
- Modify: `src/server/dm/dm.ts`
- Modify: `src/client/screens/NewCampaign.tsx`
- Test: `tests/server/dm/prompts.test.ts`
- Test: `tests/server/campaigns/presets.test.ts`
- Test: `tests/server/app.test.ts`

**Interfaces:**
- `Preset` and `AdventureOutline` gain `realism: Realism`. The adventure schema uses `z.enum(REALISMS).default("fantastical")`. `AdventureInfo` gains `realism`.
- `CampaignSource` pitch variant gains `realism?: Realism` (server default `"grounded"`).
- `campaignInputFrom` returns `realism` and `dice` (`grounded → "big"`, `fantastical → "normal"`).
- `systemPrompt(rules, realism: Realism)` and `buildMessages` pass `ctx.campaign.realism`.
- `campaignBlock` adds `Tone: grounded (realistic, nothing impossible)` / `Tone: fantastical`.
- `kitMessages(input: { name; concept; setting; realism: Realism })`. `DungeonMaster.startingKit` input gains `realism`, and the kit route passes `campaign.realism`.

- [ ] **Step 1: Write the failing tests.**
  - `prompts.test.ts`:
    - `systemPrompt(lightRules, "grounded")` contains `"no magic, no supernatural events"` and the "players' pitch or notes" exception, and does **not** contain `"danger, mystery"` or `"Keep magic items"`
    - the `"fantastical"` prompt equals today's text
    - `campaignBlock` contains the right Tone line
    - grounded `kitMessages` contains `"everyday items"` and not `"no powerful magic"`
  - `presets.test.ts`: `campaignInputFrom` gives:
    - victorian-civil-service → grounded/big
    - gothic-horror → fantastical/normal
    - misfiled-petition → grounded/big
    - drowned-chapel → fantastical/normal
    - a pitch with no realism → grounded/big
    - a pitch with `realism: "fantastical"` → fantastical/normal
  - `app.test.ts`: `/api/presets` returns `realism` on presets and adventures.

- [ ] **Step 2: Run them and check they fail.**

- [ ] **Step 3: Implement the changes.** Grounded system prompt lines: use the four bullets from spec §3.2 and the pitch/notes exception from the same section, worded as the spec gives them. Other preset realisms are as in spec §3.1.

- [ ] **Step 4: Add the choice to the new-campaign screen.** When `kind === "pitch"`, show a two-button choice under the pitch (`aria-pressed` buttons, as with the mode choice):
  - "Grounded: real life, no magic"
  - "Fantastical: magic and the impossible allowed"

  Grounded is pre-selected. Send `realism` in the pitch source.

- [ ] **Step 5: Run everything.** `npm test && npm run typecheck && npm run build`.

- [ ] **Step 6: Check against the real model (local Ollama, qwen3.5:9b).**
  - Extend `scripts/smoke.ts` with `SMOKE_PITCH` and `SMOKE_REALISM` env options. When `SMOKE_PITCH` is set, it creates the campaign from that pitch and realism, uses everyday actions, and prints `WARNING: fantastical words in narration: …`. The check runs over narration events only, against the word list `magic, spell, portal, enchant, supernatural, ghost, monster, wizard, sorcer, curse, vision, glowing rune, teleport`.
  - Run `SMOKE_PITCH="I have £14 and want a decent coffee in Leeds before my shift" SMOKE_REALISM=grounded npm run smoke`.
  - Expected: no warning. If the warning appears, tune the grounded wording and rerun.

- [ ] **Step 7: Commit and open the PR** "Choose Grounded (real life, no magic) or Fantastical for each story" (commit `feat: grounded or fantastical stories`). Merge.

### Task 4: Dice settings and the table settings panel

**Files:**
- Modify: `src/server/turns/turns.ts`
- Modify: `src/server/dm/prompts.ts`
- Modify: `src/server/dm/dm.ts`
- Modify: `src/server/routes/api.ts`
- Create: `src/client/components/SettingsPanel.tsx`
- Modify: `src/client/screens/Play.tsx`
- Modify: `src/client/lib/api.ts`
- Test: `tests/server/turns/turns.test.ts`
- Test: `tests/server/dm/prompts.test.ts`
- Test: `tests/server/app.test.ts`

**Interfaces:**
- `adjudicateTask(actions, dice: DiceMode)`: for `big` it adds the spec §4.1 line.
- `resolveTask(input, dice: DiceMode)`: for `off` it adds the spec §4.1 no-dice line.
- `dm.adjudicate`/`dm.resolve` read `ctx.campaign.dice`. The `DungeonMaster` interface doesn't change.
- `TurnService.runAdjudicate`:
  - `dice === "off"`: go straight to `runResolve`
  - `dice === "big"`: keep only the first valid draft
- `PATCH /api/campaigns/:id/settings` with `{ dice?: DiceMode; realism?: Realism }` (at least one) returns `{ campaign }`. It broadcasts a snapshot, and returns 404 or 409 per the global constraints.
- Client: `api.updateSettings(id, patch)`.

- [ ] **Step 1: Write the failing tests.**
  - `turns.test.ts`:
    - "dice off: resolves without adjudicating": `FakeDm.adjudicateCalls` stays empty and the round resolves
    - "dice big: keeps one check": `nextChecks` has two valid drafts for two acting characters, and only one `check_request` event is written
    - "switching dice to off while rolls are pending still takes the rolls": create checks under `normal`, set `dice: "off"`, then `roll`; the round resolves with that roll included (Review Focus 3)
  - `prompts.test.ts`: the `big` adjudicate text contains `"genuinely pivotal"`, and the `off` resolve text contains `"There are no dice in this game"`.
  - `app.test.ts`: the settings route updates and broadcasts; returns 400 on `{}` or bad values, 404 on an unknown campaign, and 409 while `resolving`.

- [ ] **Step 2: Run them and check they fail.**

- [ ] **Step 3: Implement the server changes.**

- [ ] **Step 4: Add the settings panel.**
  - `SettingsPanel({ campaign, onClose })` uses the recap panel's styling and has two `aria-pressed` button groups:
    - Dice: "Every risky moment" / "Only big moments" / "Off (story mode)"
    - Story: "Grounded" / "Fantastical"
  - Each click calls `api.updateSettings` and shows errors inline.
  - In `Play.tsx` the header button is long label "Settings", short label "⚙".

- [ ] **Step 5: Run everything.** `npm test && npm run typecheck && npm run build`. Then take a phone-width screenshot of the play header and settings panel with the scratchpad Playwright setup, and check nothing overflows at 390px.

- [ ] **Step 6: Commit and open the PR** "Turn dice down or off: every risky moment, only big moments, or story mode" (commit `feat: dice settings and a table settings panel`). Merge.

### Task 5: People cards: the DM keeps them and reads them

**Files:**
- Modify: `src/server/rules/ops.ts`
- Modify: `src/server/rules/engine.ts` (opsGuide)
- Modify: `src/server/dm/context.ts`
- Modify: `src/server/dm/prompts.ts`
- Modify: `src/server/dm/schemas.ts`
- Modify: `src/server/dm/dm.ts`
- Modify: `src/server/turns/turns.ts`
- Test: `tests/server/rules/ops.test.ts`
- Test: `tests/server/dm/prompts.test.ts`
- Test: `tests/server/dm/context.test.ts`
- Test: `tests/server/turns/turns.test.ts`

**Interfaces:**
- The `npc` op gains `about: z.string().trim().max(300).optional()`. `applyOps` copies it onto the present `Npc`. The opsGuide `npc` line gains `,"about":ONE_OR_TWO_SENTENCES (optional: who they are; include when they first appear or something important changes)`.
- `DmContext` gains `people: Person[]`. `buildContext` fills it from `store.getPeople`.
- `nearbyBlock(people: Person[])` renders present people as `- Name: attitude, condition. About: … Player's notes: …`, each line cut to 400 characters and the block to 3000.
- New `metBlock(people: Person[])`: absent people, already sorted by the store, the first 12, as `- Name: about. Player's notes: …`, cut to 2000 characters in total. It returns `""` when there's nobody.
- `buildMessages` renders `nearbyBlock`, then `metBlock`, and the budget loop still drops rounds only.
- The system prompt gains: "People you have met must stay consistent with their cards. Player's notes are the truth: never contradict them." The resolve and opening tasks gain the spec §5.1 `about` instruction.
- `SummarySchema` gains `people: z.array(z.object({ name: z.string(), about: z.string().trim().min(1).max(300) })).default([])`.
- `summaryMessages(oldSummary, rounds, people: { name: string; about: string }[])`. When `people` is non-empty, it asks for the `people` array in the reply.
- `DungeonMaster.summarise` returns `{ summary: string; people: { name: string; about: string }[] }`. Update `turns.ts` and `FakeDm`.
- `summariseRange` passes the people named in `npc` ops within the range (from `op_applied` events), and calls `store.setPersonAbout` for each one returned.

- [ ] **Step 1: Write the failing tests.**
  - `ops.test.ts`: an `npc` op with `about` keeps it, and one over 300 characters is rejected.
  - `prompts.test.ts`:
    - `nearbyBlock` shows About and Player's notes only when non-empty
    - a 1000-character note is cut to 400
    - `metBlock` caps at 12 people and 2000 characters, and is `""` when empty
    - `buildMessages` with many long rounds keeps both people blocks and drops rounds
  - `turns.test.ts`:
    - "npc_gone keeps the card": after an `npc` then `npc_gone`, `getPeople` has them with `present: false`, and the next prompt's context lists them as met
    - "set_scene clears presence but keeps cards"
    - "an npc op's about is ignored for a player-edited card": use `updatePerson(..., { about: "Mine", aboutEdited: true })`
    - "summary refresh updates about, except for edited cards, and ignores unknown names": the FakeDm summarise returns people

- [ ] **Step 2: Run them and check they fail.**

- [ ] **Step 3: Implement the changes.**

- [ ] **Step 4: Run everything.** `npm test && npm run typecheck`.

- [ ] **Step 5: Real-model check.** Run `npm run smoke` (fantastical) and the grounded smoke from Task 3. Then check `about` with `sqlite3`, or add a smoke report line: `people with about: N/M`. Expected: most people have an `about`. If none do, tune the instruction.

- [ ] **Step 6: Commit and open the PR** "The DM now remembers the people you meet, and keeps them in character" (commit `feat: people cards the DM writes, updates and reads back`). Merge.

### Task 6: The People panel, and editing cards

**Files:**
- Modify: `src/server/routes/api.ts`
- Create: `src/client/components/PeoplePanel.tsx`
- Modify: `src/client/screens/Play.tsx`
- Modify: `src/client/components/NearbyStrip.tsx`
- Modify: `src/client/components/ActionBar.tsx` (pass the open-card callback)
- Modify: `src/client/lib/api.ts`
- Modify: `src/client/theme.css`
- Test: `tests/server/app.test.ts`

**Interfaces:**
- `PATCH /api/campaigns/:id/people/:name` takes `{ about?: string (≤500), notes?: string (≤500), letDmUpdate?: true }`. Setting `about` sets `aboutEdited: true`, and `letDmUpdate` clears it. It returns `{ people: Person[] }` and broadcasts a snapshot. It returns 404 for an unknown campaign or person, 400 for validation, and 409 while the DM is writing.
- Client: `api.updatePerson(campaignId, name, patch)`.
- `PeoplePanel({ campaignId, people, focus?: string, onClose })` lists cards in store order. Each card has:
  - the name, an attitude chip (reusing the `npc-<attitude>` colours), condition, and "Here now" or "Last seen in round N"
  - About, and Your notes
  - Edit (textareas with `maxLength={500}` and a counter) and Save/Cancel
  - "Let the DM update this", shown when `aboutEdited`

  When `focus` is set, the panel scrolls to that card. Empty state: "Nobody yet. People you meet will appear here."
- `NearbyStrip` gains `onAbout(name)`, which adds the action `["about", "ℹ About"]`. The About action works even when `canAct` is false.
- Play header button: long label "People", short label "👥".

- [ ] **Step 1: Write the failing API tests** for the people route: update notes; update about (which sets aboutEdited); `letDmUpdate`; 501 characters → 400; unknown name → 404; busy → 409; and name matching that ignores case.

- [ ] **Step 2: Run them and check they fail.**

- [ ] **Step 3: Implement the route and the client parts.**

- [ ] **Step 4: Run everything.** `npm test && npm run typecheck && npm run build`. Then take Playwright screenshots at 390px and 1200px of:
  - the panel with two cards, one being edited
  - the Nearby menu with About
  - the header at 390px, which must not overflow with Recap, People, Settings, Feedback and Sheet. If it does, move Feedback and Settings into a "⋯" menu. That's a builder's call; record it in the PR.

- [ ] **Step 5: Commit and open the PR** "See and edit the people you've met" (commit `feat: people panel with editable cards`). Merge.

### Task 7: Editable story so far

**Files:**
- Modify: `src/server/turns/turns.ts`
- Modify: `src/server/dm/context.ts`
- Modify: `src/server/dm/prompts.ts`
- Modify: `src/server/routes/api.ts`
- Modify: `src/server/feedback/github.ts` usage (the summary text)
- Modify: `src/client/components/RecapPanel.tsx`
- Modify: `src/client/lib/api.ts`
- Test: `tests/server/turns/turns.test.ts`
- Test: `tests/server/dm/context.test.ts`
- Test: `tests/server/dm/prompts.test.ts`
- Test: `tests/server/app.test.ts`

**Interfaces:**
- New `memoryText(c: Campaign): string` in `context.ts`. It returns:
  - `pinned` alone if there's no summary
  - `summary` alone if nothing is pinned
  - otherwise `${pinned}\n\nSince then:\n${summary}`

  `buildMessages` and the feedback route use it.
- `TurnService.editSummary(id, text): Promise<{ summary: string; throughRound: number; edited: true }>`:
  - It throws a `GameError` (route → 409) while busy, and waits on nothing; it refuses if `summarising.has(id)`.
  - It sets `pinnedSummary: text, summary: ""` and appends `{ type: "summary", text, throughRound: max(0, roundNumber - 1), edited: true }`.
- `recap()` returns `{ summary: memoryText(c), throughRound, editedThrough: number | null }`. `editedThrough` is the latest edited summary event's `throughRound`, or null.
- `buildContext`: `fromRound = max(0, roundNumber - rounds, lastEditedThrough + 1)` when an edited summary exists. An edit at `throughRound` 0 means `fromRound >= 1` (Review Focus 4).
- `summaryMessages(oldSummary, rounds, people, pinned?: string)`: when `pinned` is non-empty, it adds the spec §6 "The players wrote the earlier story themselves…" lines with the pinned text marked read-only. `summariseRange` passes `c.pinnedSummary` and sends the old summary as only `c.summary`.
- `PUT /api/campaigns/:id/summary` takes `{ summary: string (trim, 1–4000) }` and returns `editSummary`'s result. It returns 404, 400, or 409 (busy or summarising).
- Client: `api.editSummary(id, summary)`. `RecapPanel` gets an Edit button, a textarea prefilled with the shown text (or empty), Save/Cancel, and the line "Edited by you after round N" when `editedThrough !== null`.

- [ ] **Step 1: Write the failing tests.**
  - `turns.test.ts`:
    - an edit pins the text and empties the summary
    - `recap` returns the pinned text plus "Since then:" after a later automatic summary
    - the automatic summariser receives `pinned` and the old summary as only the post-edit text
    - an edit while `resolving` is refused
    - an edit in the lobby (round 0) works, with `throughRound` 0
  - `context.test.ts`:
    - after an edit at `throughRound` 5 with `roundNumber` 8, `recentRounds` covers 6–7 only
    - with no edit, it's unchanged
    - after an edit at `throughRound` 0, it starts at round 1
  - `prompts.test.ts`: `memoryText` in all three cases, and the `summaryMessages` pinned lines.
  - `app.test.ts`: `PUT` summary for validation, 404, 409, and success.

- [ ] **Step 2: Run them and check they fail.**

- [ ] **Step 3: Implement the changes.**

- [ ] **Step 4: Run everything.** `npm test && npm run typecheck && npm run build`. Then take a Playwright screenshot of the recap panel in edit mode at 390px.

- [ ] **Step 5: Real-model check.** Play 3 rounds with smoke, edit the summary to contradict round 1 ("Wren never found the key"), play 2 more rounds, and check the narration doesn't mention Wren having the key. Report the result in the PR.

- [ ] **Step 6: Commit and open the PR** "Edit the story so far: the DM follows your version" (commit `feat: editable, pinned story-so-far memory`). Merge.

### Task 8: Close out

- [ ] **Step 1:** Update `README.md`'s "Playing" section with one line each for: Grounded/Fantastical, dice settings, the People panel, editing the story so far, and the feedback tick box.
- [ ] **Step 2:** Comment on issue #10 with what shipped, linking the releases, then close it.
- [ ] **Step 3:** Commit and open the PR "Docs: new features in the README" (commit `docs: …`). No release, which is expected for docs only. Merge.
