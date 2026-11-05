# Grounded Stories, Dice Settings, People Cards and Editable Memory: Design

**Date:** 2026-11-05
**Status:** Approved in chat
**Builds on:** `2026-10-03-ai-dungeon-master-design.md`, `2026-10-03-npcs-and-party-fall-design.md`, `2026-10-04-story-recap-and-follow-ups-design.md`
**Source:** Rach's feedback (issue #10, "QOL Edits") and a play session on her Windows laptop.

## 1. Purpose

Rach plays mostly solo, often in realistic, everyday stories. Four problems came up:

1. **Realism breaks.** She pitched a realistic scene (£14, buying a coffee). The DM turned the coffee into a magic portal. The system prompt assumes fantasy adventure ("danger, mystery", "danger is real… someone usually gets hurt", "keep magic items rare"). For her own pitch, the setting the DM sees is just "Custom setting described in the pitch".
2. **Dice break immersion.** "Having it roll on every decision breaks the immersion."
3. **People are forgotten.** She wants to see who she has met, with their background, and have them stay in character, without them joining the party. Today an NPC exists only while in the scene's Nearby list. `npc_gone` deletes them, and nothing records who they are.
4. **The DM's memory can't be corrected.** She wants to fix mistakes, or pull the story back on track.

There is also a feedback change: an option to attach the story to a report. Since the repo went public, reports are public, so the story must only ever be attached by choice.

### Decisions made in chat

| Topic | Decision |
|---|---|
| Realism | A per-campaign **Grounded / Fantastical** choice. Presets and adventures set it. Her own pitch asks. Changeable later. |
| Dice | A per-campaign **dice setting**: Every risky moment / Only big moments / Off (story mode). Changeable during play. **Grounded campaigns default to Only big moments.** |
| People | **People cards** that the DM writes and keeps updated, and reads back for consistency. The player can view and edit them. |
| Memory | An **Edit** button on the story-so-far panel. The player's text becomes the DM's memory. |
| Feedback | An opt-in "Include the story so far" tick box on every report, labelled as public. Nothing about the story is attached unless ticked, including for bug reports (this changes today's behaviour). |
| Process | Built piece by piece, each as its own PR and therefore its own release. |

### Goals

- A Grounded story never contains magic, the supernatural, monsters or impossible technology, unless she writes it in herself.
- She can play without dice, or with dice only at turning points.
- People she has met persist across scenes, with a card she can read and correct. The DM uses those cards.
- She can rewrite what the DM "remembers", and the DM follows her version.
- No feedback report reveals story text unless she ticks the box.

### Non-goals

- Party membership or companions (people cards are about NPCs, not new heroes).
- Undoing or rewriting individual DM turns.
- Images or portraits on cards.
- Anything beyond prompt changes to make the model itself smarter.

### Anti-goals (failures even if it technically works)

- Grounded stories that are dull. Realism removes the impossible, not the drama.
- Story mode where every action simply succeeds. Without dice the DM still has to let things go wrong.
- Cards that bloat the prompt until turns slow down or old rounds fall out of context.
- Her edits being silently overwritten by the AI.
- Losing or corrupting her existing saves when the database changes.

## 2. Database changes and upgrades

Existing saves (`data/game.sqlite` on her laptop) must upgrade in place. `createStore` gains a migration step using SQLite's `PRAGMA user_version`. On open, the store runs each numbered migration above the current version inside a transaction, then sets the version. The existing `CREATE TABLE IF NOT EXISTS` schema counts as version 0. Check for Updates already backs up the database before every update (`data/backups`), which is the safety net.

Migration 1:
- `campaigns.realism TEXT NOT NULL DEFAULT 'fantastical' CHECK (realism IN ('grounded','fantastical'))`
- `campaigns.dice TEXT NOT NULL DEFAULT 'normal' CHECK (dice IN ('normal','big','off'))`
- `campaigns.pinned_summary TEXT NOT NULL DEFAULT ''` (see §6)
- `people.about_edited INTEGER NOT NULL DEFAULT 0` (in the table below; see §5.4)
- Existing campaigns keep today's behaviour (fantastical, normal).
- Table `people`, which replaces `npcs`:
  ```
  id INTEGER PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  about TEXT NOT NULL DEFAULT '',      -- the DM's description; the player may edit it
  notes TEXT NOT NULL DEFAULT '',      -- the player's own notes; the DM never writes these
  attitude TEXT NOT NULL,
  condition TEXT NOT NULL,
  present INTEGER NOT NULL DEFAULT 1,  -- in the current scene (the Nearby strip)
  last_seen_round INTEGER NOT NULL DEFAULT 0,
  UNIQUE (campaign_id, name COLLATE NOCASE)
  ```
  Existing `npcs` rows are copied in with `present = 1`, then `npcs` is dropped.
- The `summary` event gains an optional `edited: true` (JSON payload, so no column change).

`Campaign` gains `realism: Realism` and `dice: DiceMode`. `Npc` stays as the Nearby shape (`name, attitude, condition`). It is now derived from `people WHERE present = 1`, so `getNpcs`/`saveNpcs` keep their meaning for the existing code. New store methods:
- `getPeople(campaignId)`
- `updatePerson(campaignId, name, patch: { about?, notes? })`
- `setPersonAbout(campaignId, name, about)` (used by the DM)

## 3. Grounded or Fantastical

### 3.1 Choosing

- **Presets:** each `Preset` gains `realism`. Civil Service is grounded. Classic Fantasy, Gothic Horror, Pirate Seas (sea monsters, cursed gold) and Sci-fi Derelict (aliens) are fantastical.
- **Adventures:** each adventure JSON gains `"realism"`, defaulting to fantastical if missing. The Misfiled Petition is grounded. The Drowned Chapel is fantastical.
- **Own pitch:** the New Campaign screen shows a two-option choice under the pitch box:
  - **Grounded:** real life, no magic
  - **Fantastical:** magic and the impossible allowed

  It is pre-selected to Grounded (builder's call; her pitches so far are realistic). The request schema gains `realism` for pitches.
- **Dice default at creation:** `big` for grounded campaigns, `normal` for fantastical ones.
- **Changing it later:** see §4.3 (Table settings).

### 3.2 What the DM is told

`systemPrompt(rules, campaign)` takes the campaign and swaps the tone lines.

**Fantastical:** today's lines, unchanged.

**Grounded** replaces "Keep the story moving toward the campaign's goal, with danger, mystery and some humour" and the "Danger is real…" line with:
- "This is a grounded, realistic story. Everything that happens must be possible in the real world of the setting: no magic, no supernatural events, no monsters, no impossible technology, no portals or visions. If something seems strange, it has an ordinary explanation."
- "Drama comes from people, choices, money, time, relationships and consequences. Keep it lively, specific and sometimes funny; ordinary life is full of small surprises."
- "Harm only happens when the story really involves it (an accident, a fight the heroes start, a dangerous job); then use damage ops as usual."
- "Keep magic items… rare" becomes "Items are ordinary, realistic things."

**When she brings the impossible in herself** *(builder's call)*:
- **Pitch and people notes are the world.** If her pitch or her notes say something impossible exists (a talking cat, a haunted house), it exists, and only that. The grounded prompt adds: "Anything the players' pitch or notes establish is true in this world, even if unusual; add nothing impossible beyond it."
- **In-game actions are attempts.** "I cast a spell" in a grounded story is a person trying something. The world responds realistically: nothing magical happens, and people may react to the strange behaviour. The DM doesn't scold her.
- **Smoke test:** the `isFantastical` check only looks at the DM's narration, never her actions.

`campaignBlock` adds a line `Tone: grounded (realistic, nothing impossible)` or `Tone: fantastical`. The model sees the rule in both the system prompt and the user message.

`kitMessages` gets the realism. Grounded kits: "everyday items a real person in this setting would carry" instead of "no powerful magic".

## 4. Dice settings

### 4.1 Behaviour

- **normal:** as today.
- **big:** `adjudicateTask` gets an extra instruction: "Only call for a check at a genuinely pivotal moment: where failure would change the course of the story (a confrontation, a big gamble, real danger). Everyday actions, conversations and most rounds need no check." The server keeps at most **one** check per round: the first valid draft.
- **off:** no adjudicate call at all. A round goes straight from collecting to resolving, saving one AI call per round. `resolveTask` gets: "There are no dice in this game. Decide outcomes fairly from the situation and the characters' abilities and condition. Plans can fail, people can say no, and actions have consequences; not everything succeeds."

### 4.2 Server flow

`TurnService.runAdjudicate` reads `campaign.dice`:
- `off`: call `runResolve` directly.
- `big`: after filtering drafts, keep only the first.

Nothing else in the round state machine changes.

### 4.3 Table settings (play screen)

A **Settings** item in the play header opens a small panel with:
- **Dice:** three options
- **Story:** Grounded / Fantastical

Changes are saved with `PATCH /api/campaigns/:id/settings { dice?, realism? }`, validated with zod and broadcast as a snapshot. A change is allowed mid-round but **refused while the DM is writing** (409). It takes effect from the next AI call. On phones the button shows as ⚙.

## 5. People cards

### 5.1 How the DM keeps them

- The `npc` op gains an optional `about: string` (max 300 characters): "who they are, in one or two sentences: role, background, what they want, and how they relate to the heroes".
  - When `about` is present, the server stores it as the person's `about`.
  - When it's absent, the existing `about` is kept.
- `npc_gone` sets `present = 0` instead of deleting.
- An `npc` op for someone known but absent brings them back (`present = 1`), keeping their card.
- `set_scene` clears the present flag for everyone, as it clears the Nearby list today. Cards stay.
- `last_seen_round` is set whenever an op touches the person.
- The prompt instructions (resolve and opening tasks) add: "When someone notable first appears, include `about`. Update `about` when something important changes about them or their relationship with the heroes. Keep it under 300 characters." The ops guide and the op zod schema are updated to match.
- `MAX_NPCS` (the Nearby cap) still limits present people. The total number of cards has no limit.

### 5.2 Summary pass refresh

The summariser keeps cards current even when the per-round op forgot to. `summaryMessages` is given the people involved in the summarised rounds: anyone named in an `npc` op in that range, with their current `about`. It is asked for:

```json
{"summary": "...", "people": [{"name": "...", "about": "..."}]}
```

- `SummarySchema` gains an optional `people` array.
- For each name the summariser returns that matches a known person, `about` is replaced. Unknown names are ignored.
- **Player-edited cards:** if the player has edited a person's `about` since the last time the DM set it, the summariser does not overwrite it (see 5.4).

### 5.3 What the DM reads

`buildMessages` renders:
- **Nearby** (present people): `- Name: attitude, condition. About: … Player's notes: …`. The "About" and "Player's notes" parts appear only when non-empty.
- **People you have met (not here now):** the absent people, most recently seen first, as `- Name: about. Player's notes: …`, capped at 12 people and 2,000 characters (about 500 tokens). It is omitted when empty.
- The system prompt gains: "Characters listed under People you have met must stay consistent with their cards. Player's notes are the truth: never contradict them."

The budget loop already drops old rounds when the prompt is too long. The people blocks count towards the budget and are kept; rounds go first.

### 5.4 What the player sees and edits

- A **People** button in the play header (👥 on phones) opens a panel styled like the recap panel. It shows cards for everyone met:
  - present people first, then by most recently seen
  - each card shows the name, attitude chip, condition, the DM's description, and her notes
- Each card has **Edit**, which turns the description and notes into text areas and shows Save/Cancel.
- **Length limits** *(builder's call)*: `about` and `notes` are max 500 characters each, enforced in the route (zod) and the textareas (`maxLength` and a counter). When the DM's prompt is built:
  - each present person's line is truncated to 400 characters
  - the Nearby block is capped at 3,000 characters
  - the absent-people block keeps its 2,000-character cap

  So the people blocks together stay under about 1,250 tokens, and recent rounds can't be squeezed out.
- Saving uses `PATCH /api/campaigns/:id/people/:name { about?, notes? }`. That broadcasts a snapshot and is refused (409) while the DM is writing.
- Editing `about` sets `about_edited = 1` (a second column in migration 1: `about_edited INTEGER NOT NULL DEFAULT 0`). While it's set:
  - the summariser (5.2) skips that person
  - an `npc` op's `about` is ignored, so the per-round DM can't overwrite her version either
  - attitude, condition and presence still update normally
- The panel has a **Let the DM update this** link that clears `about_edited`.
- Notes are only ever written by the player.
- The Nearby chips' menu gains a fourth action, **ℹ About**, which opens the People panel at that card.
- The snapshot gains `people: Person[]`, which carries all of this.

## 6. Editable memory

- The story-so-far panel gets an **Edit** button next to Close.
- It turns the recap text into a textarea with Save/Cancel. The textarea is prefilled with the current summary, or empty if there is none yet; she can write one from scratch.
- Saving uses `PUT /api/campaigns/:id/summary { summary }` (1–4000 characters). It is refused (409) while the DM is writing or while a summary is being generated.
- **Her text is pinned, word for word** *(builder's call; the alternative was letting the 300-word summariser reword it)*. Migration 1 adds `campaigns.pinned_summary TEXT NOT NULL DEFAULT ''`. Saving:
  - sets `pinned_summary` to her text and `summary` to `''`
  - appends a `summary` event `{ text, throughRound: roundNumber - 1, edited: true }`
- From then on the automatic summariser only summarises rounds after the edit into `summary`. It is told "The players wrote the earlier story themselves (given below for context); summarise only the new events, without repeating or contradicting it", and is passed the pinned text read-only.
- The DM's memory, and the recap panel, show:
  - `pinned_summary` (her words, unchanged)
  - then, if non-empty, "Since then:" followed by `summary`
- Editing again prefills the textarea with that combined text. Saving replaces `pinned_summary` with everything she saved and clears `summary`.
- **The DM then follows her version.** `buildContext` currently includes the last 10 rounds verbatim, and those could contradict her edit. It now starts recent rounds after the latest *edited* summary: `fromRound = max(roundNumber - 10, lastEditedThrough + 1)`. Her summary becomes the authority for everything up to the edit, and rounds after it build on top. Ordinary automatic summaries don't change this window.
- The recap panel shows "Edited by you after round N" when the latest summary event is an edited one.

## 7. Feedback: story only by choice

- The feedback panel gains a tick box, shown only when the report is sent from inside a campaign: **"Include the story so far (this will be public on GitHub)"**. It is unticked by default for both kinds of report.
- When ticked, the issue's context section adds:
  - **Story so far:** the campaign summary
  - **Recent story:** the last 30 events, rendered as today
- When unticked, neither is included, **including for bug reports**. The campaign name, round, hero name and model are still included. Two lines change because they can carry story text *(builder's call)*:
  - The Setting line shows only the source kind for her own pitch ("Own pitch") unless ticked. Preset and adventure names are fine either way.
  - The current scene title is left out unless ticked.
- `FeedbackSchema` gains `includeStory: boolean` (default false). `buildIssueBody` gets `summary?` and includes the events only when asked.
- The panel's existing hint ("The last few moments of the story are sent along too") is removed.

## 8. Testing

Each piece ships with unit and API tests in the existing style:
- **Store migration:**
  - opening a version-0 database with campaigns and npcs upgrades it with data intact
  - realism and dice get their defaults
  - npcs become present people
  - reopening doesn't re-run the migration
- **Prompts:**
  - grounded vs fantastical system prompt, campaign block and kit lines
  - the big-dice adjudicate line and the off-dice resolve line
  - the people blocks and their caps
- **Turns:**
  - `off` skips adjudicate (the fake DM's adjudicate is never called)
  - `big` keeps one check
  - `npc_gone` keeps the card
  - an `npc` op with `about` sets it, unless `about_edited`
  - `set_scene` clears presence but keeps cards
  - the summariser's people update respects `about_edited`
  - an edited summary narrows `buildContext`'s rounds
- **API:**
  - settings, people and summary routes: validation, 404, 409 while busy
  - feedback with and without `includeStory`
  - the new-campaign realism default per preset, adventure and pitch
- **Real model:** a grounded smoke run on Qwen 9B, using the existing smoke script extended with a grounded preset and pitch. The run checks that 5 rounds of an everyday scene contain no magic words (an `isFantastical` word list: magic, spell, portal, enchanted, supernatural, ghost, monster, …) and that cards get `about` text.

## 9. Order of work (one PR and release each)

1. Store migrations framework + migration 1 (no behaviour change yet).
2. Feedback: story only by choice. This is first because of the privacy issue.
3. Grounded / Fantastical (creation, prompts, kits).
4. Dice settings + the Table settings panel (the realism toggle lives there too).
5. People cards: ops, persistence, prompts, summariser refresh.
6. People panel and editing.
7. Editable story-so-far.

## 10. Builder's calls, beyond those marked above

- **In party mode,** every player at the table can change settings, edit people and edit the memory. There's no host role; it's a friends' table.
- **Switching an existing campaign to Grounded** doesn't change its dice setting. The Grounded → Only big moments default applies at creation only.

## 11. Left to the builder

- Exact UI copy beyond what's quoted here, and the styling, following the existing panels.
- Exact wording of prompt lines, as long as the rules above are kept. Wording can be tuned against the real model.
- The word list for the grounded smoke check.
