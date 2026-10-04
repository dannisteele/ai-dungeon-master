# Story-So-Far Recap and In-Story Follow-Up Questions: Design

**Date:** 2026-10-04
**Status:** Approved in chat, pending written-spec review
**Builds on:** `2026-10-03-ai-dungeon-master-design.md`, `2026-10-03-npcs-and-party-fall-design.md`

## 1. Purpose

These come from playing the "Gothic Horror" campaign on the phone.

1. **Story so far.** Players want a button that shows a recap of the campaign up to now.
2. **Follow-up questions.** For vague actions such as "I ask some questions", the DM made up the questions itself. Players want to say what their character says.

### Decisions made in chat

| Topic | Decision |
|---|---|
| Recap | The DM writes a fresh recap on demand. It is shown in a panel either player can open, and saved, so it opens instantly until the story moves on. The saved recap is also the DM's long-term memory (the existing campaign summary). |
| Follow-ups | Handled inside the story: the DM plays the NPC's side and ends by asking the player what exactly they say. No new round state, buttons or extra AI call. |

## 2. Story-so-far recap

### 2.1 Server

`TurnService.recap(id: number): Promise<{ summary: string; throughRound: number }>`:
- The last completed round is `through = campaign.roundNumber - 1`.
- **Nothing played yet.** If `through < 1`, return `{ summary: "", throughRound: 0 }`. This covers the lobby, and the opening narration alone.
- **Background summary running.** If one is running for this campaign (`summarising` has the id), first wait for it to finish (keep its promise in a `Map<number, Promise<void>>`).
- **Already up to date.** If `lastSummaryThrough(id) >= through`, return the stored `campaign.summary` and `throughRound: lastSummaryThrough(id)` without calling the DM.
- **Otherwise,** summarise rounds `lastSummaryThrough(id) + 1 … through` with the existing `dm.summarise(campaign.summary, transcript)`. Then:
  - store the result as `campaign.summary`;
  - append a `summary` event with `throughRound: through`;
  - broadcast a snapshot;
  - return the new summary.
- **The campaign lock.** The recap does **not** take the campaign lock, so play is never blocked. It is guarded by the same `summarising` set as the background summary, so a recap and a background summary never run at the same time.
- **Errors.** A `DmError` from `summarise` propagates to the caller.

Route `POST /api/campaigns/:id/recap`:
- 404 for an unknown campaign.
- 200 `{ summary, throughRound }`.
- 503 `{ error: "The Dungeon Master couldn't recall the story just now. Try again." }` on `DmError`.

### 2.2 Client

- **The button.** A **Story so far** button sits in the play header, next to **Sheet**. Unlike the Sheet button, it shows at every screen width.
- **The panel.** Pressing the button opens a full-height overlay panel:
  - **Title:** "The story so far".
  - **While loading:** "The Dungeon Master is remembering…", using the existing `thinking` style.
  - **Body:** the recap, split into paragraphs on blank lines.
  - **Footer:** "Up to round N", shown as `muted small`.
  - **Close** button; Escape and a tap on the backdrop also close it.
- **Opening the panel.**
  - It calls `api.recap(campaignId)` every time it opens. The server returns the stored summary instantly when nothing new has happened.
  - If `summary` is empty, it shows "Nothing has happened yet. Play a round first."
  - On error it shows the error message and a **Try again** button.
- **Layout.** The panel uses the theme tokens. On screens narrower than 900 px it fills the screen; on wider screens it is a centred card up to 640 px wide. It must not scroll the page sideways.

## 3. Follow-up questions in the story

Add this to the system prompt's **Storytelling** section, directly after the "Never decide what player characters say…" bullet:

> - When a player's action is vague about what they say or ask (for example "I ask some questions" or "I chat to her"), don't invent their words. Have the NPC react in character and end by asking that player what exactly they say or ask.

No other change. The existing "end by inviting the players to act" already leaves the reply open for the player.

## 4. Testing

- **turns:**
  - Recap with no rounds played returns an empty summary and makes no DM call.
  - A first recap summarises rounds 1…N and stores the summary and the event with `throughRound` N.
  - A second recap with no new rounds returns the stored summary and makes no DM call.
  - After one more round, a recap covers only the new round.
  - A recap waits for an in-flight background summary instead of overlapping it.
  - A `DmError` propagates.
- **API:** 200 with a summary; 404 for an unknown campaign; 503 on `DmError`.
- **prompts:** the system prompt contains the follow-up bullet verbatim.
- **client:** a pure helper `recapParagraphs(text): string[]` (split on blank lines, trim, drop empties) is unit-tested.
- **Real model (qwen3.5:9b):**
  - Run one resolve where the only action is "I ask the innkeeper some questions" and confirm the narration ends with a question to that player.
  - Call recap on a 5-round smoke campaign and confirm it returns a coherent summary of at most ~300 words.

## 5. Out of scope

Reading the recap aloud (we may revisit this with the audio-drama voices later), a pause-and-ask round state, and editing the recap.
