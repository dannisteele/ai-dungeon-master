# AI Dungeon Master — Design

**Date:** 2026-10-03
**Status:** Approved in brainstorming, pending written-spec review

## 1. Purpose

A self-hosted, LAN-only web app where Dani and Rach play a D&D-style story game. Players say what their characters do; a local LLM (Qwen via Ollama) acts as Dungeon Master. The app owns the game state (stats, HP, inventory) and the dice; the AI owns the storytelling.

The immediate goal is a **proof of concept on Dani's Mac** (Apple M5, 32 GB). The longer-term goal is running the web server on a Raspberry Pi or old laptop while the model runs on a machine capable of it.

### Decisions made during brainstorming

| Topic | Decision |
|---|---|
| Play modes | Both: shared party campaigns and solo campaigns |
| Turn structure | Round-based; Dungeon Master waits for all actions, with a "go ahead without me" skip |
| Rules | Light rules now (5e ability scores, HP, d20 checks); rules module swappable so full 5e can come later |
| Campaign start | Preset settings or custom pitch now; hand-written adventure outlines supported, one sample shipped |
| Visual style | "Candlelit Tavern" — dark wood, warm gold glow, Cinzel headings, Spectral body text |
| Devices | Laptops and phones (responsive) |
| Access | LAN only + shared table password |
| Dice | Visible, animated 3D dice; players press Roll; server decides the result |
| Stack | Node/TypeScript server, React front end, SQLite, Ollama |

## 2. Architecture

```
 Dani's laptop/phone ─┐                          ┌─ Ollama (Qwen) — OLLAMA_URL
 Rach's laptop/phone ─┼─ home Wi-Fi ─► Node server ─┤
                      ┘  (password)      │        └─ SQLite file — DB_PATH
```

One Node process serves the built React app, a REST API for setup flows, and a WebSocket for live play.

### Tech choices

- **Runtime:** Node 24, TypeScript throughout
- **Server:** Fastify, `@fastify/websocket`, `@fastify/cookie`, `@fastify/static`
- **Validation:** Zod (API input, DM output, state-change ops)
- **Storage:** SQLite via `better-sqlite3` (runs on Pi/ARM)
- **Front end:** React + Vite; plain CSS with design tokens (no UI framework)
- **Dice:** a 3D physics dice library that supports **predetermined results** (`@3d-dice/dice-box-threejs`, which supports `1d20@N` predetermined rolls). Fallback: CSS-animated d20.
- **AI:** Ollama HTTP API, `/api/chat` with JSON-schema `format` and streaming
- **Tests:** Vitest

### Configuration (environment variables)

| Var | Default | Purpose |
|---|---|---|
| `TABLE_PASSWORD` | — (required) | Shared table password |
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` | Bind address |
| `OLLAMA_URL` | `http://localhost:11434` | Where the model lives |
| `OLLAMA_MODEL` | `qwen3.6:27b` (faster fallback: `qwen3.5:9b`) | Model name |
| `DB_PATH` | `./data/game.sqlite` | Save file |
| `OLLAMA_KEEP_ALIVE` | `30m` | Sent as `keep_alive` on every model request: how long Ollama keeps the model in memory after the last request |

## 3. Server modules

Each module has one responsibility and is testable alone.

| Module | Responsibility | Depends on |
|---|---|---|
| `auth` | Password check, signed long-lived `httpOnly` session cookie, LAN-only IP filter, light login rate limiting | — |
| `store` | All SQLite reads/writes; migrations | — |
| `rules` | Dice, checks, character creation limits, validating and applying state-change ops. **Exposes a `RulesEngine` interface** so a 5e engine can replace it. | — |
| `campaigns` | Create/list campaigns, presets, load adventure outlines | store |
| `characters` | Create characters, request starting kit from DM | store, rules, dm |
| `turns` | Round state machine (below) | store, rules, dm, realtime |
| `dm` | Build prompts, call Ollama, enforce structured output, retry, summarise | rules (for op schema) |
| `realtime` | WebSocket rooms per campaign; broadcast events | — |

### LAN-only filter

Requests are rejected (403) unless the remote address is loopback or private: `127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`, `::1`, `fc00::/7`, `fe80::/10` (including IPv4-mapped IPv6 forms). Combined with the router's default inbound blocking, this keeps the app off the internet. The README includes a short "check your router isn't forwarding this port" note.

### Auth

`TABLE_PASSWORD` compared with `crypto.timingSafeEqual`. On success, set a signed cookie (1-year expiry). All API and WebSocket routes require it. Max 10 failed attempts per IP per 10 minutes.

## 4. Light rules

Ability scores follow D&D 5e; everything else stays light (no classes, spells, AC or initiative).

- **Abilities:** STR, DEX, CON, INT, WIS, CHA, stored as 5e **scores**.
  - **Modifier** = `floor((score − 10) / 2)` (e.g. 8 → −1, 10 → +0, 15 → +2, 20 → +5).
  - Creation: 5e **point buy** — every score starts at 8, **27 points** to spend, scores 8–15 before adjustment. Cost per score: 8→0, 9→1, 10→2, 11→3, 12→4, 13→5, 14→7, 15→9.
  - Hard bounds at all times: **1 to 20**.
- **HP:** max HP = **20 + 2 × CON modifier** at creation (min 10). Current HP is clamped to `0..maxHp`. If CON changes later, max HP is recalculated with the same formula plus level bonuses.
- **Downed:** at 0 HP a character is *downed*: cannot submit actions until healed above 0. The DM is told.
- **Checks:** `d20 + ability modifier ≥ DC`. DC range 5–25. Natural 20 always succeeds (critical); natural 1 always fails (fumble).
- **Level up:** max HP + `max(1, 5 + CON modifier)`, heal by the same amount, and **2 ability points** to assign (both to one score or 1+1 to two scores, 5e ASI style), chosen by the player in the sheet; capped at 20.
- **Inventory:** items have name, description, quantity ≥ 1. Removing to 0 deletes the item.

### State-change ops (the only way the DM changes state)

```ts
type Op =
  | { op: "damage";      character: string; amount: number }        // 1..50
  | { op: "heal";        character: string; amount: number }        // 1..50
  | { op: "add_item";    character: string; name: string; description: string; qty?: number }
  | { op: "remove_item"; character: string; name: string; qty?: number }
  | { op: "adjust_stat"; character: string; stat: "STR"|"DEX"|"CON"|"INT"|"WIS"|"CHA"; delta: -1 | 1 }  // changes the score by 1
  | { op: "level_up";    character: string }
  | { op: "set_scene";   title: string };
```

`character` is the character's name, matched case-insensitively against the campaign's characters. The rules engine validates each op independently: unknown character, removing an item the character doesn't hold, or a stat leaving bounds → op is **rejected and logged**, others still apply. Valid ops are applied in order, clamped where clamping makes sense (HP).

## 5. Turn flow

### Round state machine (per campaign)

```
collecting ──(all active players acted or skipped)──► adjudicating
adjudicating ──(checks needed)──► awaiting_rolls ──(all rolled)──► resolving
adjudicating ──(no checks)──────────────────────────────────────► resolving
resolving ──(narration + ops applied, saved)──► collecting
any AI phase ──(failure after retry)──► stalled ──(Try again)──► same phase
```

- **Active players:** characters in the campaign that are not downed.
- **Solo campaigns:** one character; collecting ends on their action.
- **Skips:** "Go ahead without me" marks the pressing player as skipped this round. Once a player has acted, they also get **"Don't wait for {name}"**, which skips the other player (covers a closed laptop).
- **Rolls:** the owning player presses **Roll d20**. If that player is skipped/disconnected, anyone may roll for them ("Roll for Wren").
- **Server-side randomness:** `crypto.randomInt(1, 21)`. The result is broadcast; clients animate dice landing on it.

### DM calls

1. **Adjudicate** — input: context + this round's actions. Output schema:
   `{ checks: [{ character, stat, dc, reason }] }`
2. **Resolve** — input: context + actions + check results. Output schema (narration first so it can stream):
   `{ narration: string, changes: Op[] }`
   The response is streamed; the server incrementally extracts the `narration` string and broadcasts text chunks. Ops are validated and applied only once the full response parses.
3. **Opening scene** — a Resolve call with no actions, run when the campaign begins.
4. **Starting kit** — given a character concept, returns 3–5 items (`add_item` ops shape). Player can accept or regenerate.
5. **Summarise** — every 10 resolved rounds, rewrite the "story so far" (≤ 300 words) from the old summary + those rounds.

### Error handling

- Invalid JSON / schema mismatch → **one** automatic retry with the validation error appended to the prompt.
- Second failure, Ollama unreachable, or timeout (90 s) → state `stalled`, broadcast "The Dungeon Master pauses, lost in thought…" with **Try again**. Submitted actions and rolls are kept; nothing from the failed phase is persisted.
- Rejected ops are recorded in the event log (visible in a collapsible "DM notes" panel for debugging) but not shown in the story.

### Persistence

A resolved round is written in a **single transaction**: narration event, applied ops, updated characters/items, and round state. A server restart mid-round resumes from the last persisted state (submitted actions and rolls are persisted as they happen).

## 6. Prompt context (memory)

Each DM call includes, in order:

1. System prompt: role, tone, rules summary, op vocabulary, "never decide dice results yourself".
2. Campaign: setting/pitch, and the adventure outline if present.
3. **Party facts from the DB:** each character's name, concept, HP/max, stats, level, inventory, downed status.
4. Story-so-far summary.
5. Last 10 rounds verbatim (actions, rolls, narration).
6. This round's actions (and check results for Resolve).

A token estimate (chars ÷ 4) keeps the prompt under a configurable budget (default 12k tokens) by dropping the oldest verbatim rounds first.

### Pack up for the night

The lobby has a **Pack up for the night** button. It calls `POST /api/pack-up`, which sends Ollama a request for the model with `keep_alive: 0`, so the model is unloaded from memory immediately. It is refused (409, "The Dungeon Master is mid-sentence…") while any campaign is in an AI phase (`opening`, `adjudicating`, `resolving`). Nothing else changes: the next DM call simply reloads the model (the first reply is slower). If Ollama is unreachable, the button reports that rather than failing silently.

## 7. Data model (SQLite)

```
campaigns(id, title, mode['solo'|'party'], setting, pitch, outline_json NULL,
          scene_title, summary, round_state, round_number, created_at, updated_at)
characters(id, campaign_id, name, concept, level, hp, max_hp,
           str, dex, con, int, wis, cha, pending_ability_points, created_at)
items(id, character_id, name, description, qty)
events(id, campaign_id, round_number, type, payload_json, created_at)
  -- type: action | skip | check_request | roll | narration | op_applied | op_rejected | summary | stall
```

Unique: `(campaign_id, lower(name))` on characters, `(character_id, lower(name))` on items.

The story view is rebuilt from `events`. Devices remember their chosen character per campaign in `localStorage`; there are no user accounts.

## 8. Front end

### Screens

1. **Password gate**
2. **Lobby** — campaigns list (title, mode, scene, last played), "New campaign", "Join" (pick or create character).
3. **New campaign** — choose preset (*Classic Fantasy, Gothic Horror, Pirate Seas, Sci-fi Derelict*), write a custom pitch, or pick an adventure outline; choose solo/party.
4. **Character creation** — name, concept, 27-point buy across six abilities (steppers showing score, modifier and points left), suggested starting kit (accept / regenerate).
5. **Play screen**
   - Story column: scrolling narration (streams in), player actions styled in italic gold-name lines, roll results inline, scene title header.
   - Action bar: text input, ready indicators ("Rach ✓ · Dani …"), skip buttons, **Roll d20** button when a check is pending.
   - Character sheet: name, concept, level, HP bar, six abilities (score + modifier), inventory with "✦ new" glow on fresh items, level-up ability picker when points are pending. Party members shown as compact cards.
   - Dice overlay: 3D d20 rolls across the screen on all devices, lands on the server's number, then shows `16 + 2 (STR) = 18 vs DC 14 ✓`. Gold burst on nat 20, red crack on nat 1.

### Responsive

- ≥ 900 px: story and sheet side by side.
- < 900 px: story full width; sheet in a slide-over drawer opened from a tab; action bar fixed to bottom.

### Visual tokens (Candlelit Tavern)

Background `#1a120c` with radial glow `#3a2516`; text `#ead9b8`; muted `#b89c74`; gold `#e0a84a` / highlight `#ffd27a`; panel `#2b1d12`; border `#6b4a24`; HP gradient `#9b2a1e → #d4553a`; success `#8fbf7a`. Fonts: Cinzel (headings), Spectral (body), self-hosted so the app works offline.

## 9. Testing

- **rules** (unit): checks incl. nat 1/20, point-buy costs and limits, modifier formula, HP from CON, every op's valid/invalid paths, bounds and clamping, downed state.
- **turns** (unit, fake DM + in-memory store): party collection, self-skip, "don't wait", solo, rolls by owner and by proxy, stall and retry, restart mid-round.
- **dm** (unit, fake Ollama): schema enforcement, single retry, stall after second failure, streaming narration extraction, prompt contents and budget trimming.
- **store** (integration, temp SQLite): round transaction atomicity; story rebuilt identically after reopen.
- **pack up** (unit, fake fetch): sends `keep_alive: 0` for the configured model; refused during an AI phase.
- **auth** (unit): password, cookie, rate limit, private/public IP classification.
- **Real-model smoke test** (`npm run smoke`, manual): plays 5 rounds against the configured Ollama model and reports schema-valid rate and any rejected ops.

## 10. Proof-of-concept acceptance

1. Server runs on the Mac; Dani and Rach each open it from their own laptops, enter the password, create characters, and join one party campaign.
2. A 15-minute session: both act each round, dice animate on both screens, narration streams, at least one item and one stat change land correctly.
3. Each player can start a solo campaign.
4. Restarting the server mid-campaign loses nothing.
5. Usable on a phone.
6. README covers setup (Ollama + model pull), running, LAN address, router check, and **moving to a Pi** (server on Pi, `OLLAMA_URL` pointing at the Mac with Ollama bound to the LAN via `OLLAMA_HOST=0.0.0.0`).

## 11. Out of scope (for now)

Full 5e rules, multiple shipped adventures (one sample only), sound/music, image generation, user accounts, combat initiative/grid maps, internet access.
