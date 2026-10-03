# AI Dungeon Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A LAN-only web app where two players play a D&D-style story with a local Qwen model (via Ollama) as Dungeon Master, with server-owned dice, 5e ability scores, inventory and a Candlelit Tavern UI.

**Architecture:** One Node/TypeScript process (Fastify) serves a React SPA, a small REST API for setup flows, and a WebSocket per campaign for live play. Game state lives in SQLite; an append-only `events` table is the campaign log. The AI never edits state directly: it returns JSON (validated with Zod) containing narration and "ops", which a swappable `RulesEngine` validates and applies.

**Tech Stack:** Node 24, TypeScript, Fastify 5 (+ websocket, cookie, static), better-sqlite3, Zod 4, React 19 + Vite, Vitest, `@3d-dice/dice-box-threejs`, Ollama HTTP API.

**Spec:** `docs/superpowers/specs/2026-10-03-ai-dungeon-master-design.md`

## Global Constraints

- Node ≥ 24; ESM (`"type": "module"`); extensionless relative imports (resolved by tsx/Vite with `moduleResolution: "Bundler"`).
- Abilities are exactly `STR, DEX, CON, INT, WIS, CHA`; scores bounded **1–20**; modifier = `floor((score − 10) / 2)`.
- Point buy: all scores start at 8, budget **27**, creation range 8–15, costs `8→0, 9→1, 10→2, 11→3, 12→4, 13→5, 14→7, 15→9`.
- Max HP = `max(10, 20 + 2×CONmod) + (level − 1) × max(1, 5 + CONmod)`. Current HP clamped to `0..maxHp`. 0 HP = downed.
- Checks: `d20 + mod ≥ DC`; DC clamped to **5–25**; natural 20 always succeeds, natural 1 always fails.
- Dice are rolled only on the server with `crypto.randomInt(1, 21)`.
- DM output: one automatic retry on invalid JSON/schema; then the campaign is `stalled`. Ollama unreachable/timeout (**90 s**) → `stalled` immediately.
- A resolved round is persisted in **one SQLite transaction**.
- Prompt budget default **12 000** tokens, estimated as `ceil(chars / 4)`; drop oldest verbatim rounds first; last **10** rounds verbatim; summary every **10** rounds, ≤ 300 words.
- Requests from non-private IPs → 403. All `/api/*` (except `/api/login`, `/api/session`) and `/ws` require the signed `table` cookie. Login: max **10** failures per IP per **10 minutes**.
- Config env vars: `TABLE_PASSWORD` (required), `PORT=3000`, `HOST=0.0.0.0`, `OLLAMA_URL=http://localhost:11434`, `OLLAMA_MODEL=qwen3.6:27b`, `OLLAMA_KEEP_ALIVE=30m`, `DB_PATH=./data/game.sqlite`, `PROMPT_BUDGET_TOKENS=12000`.
- Visual tokens (Candlelit Tavern): bg `#1a120c`, glow `#3a2516`, text `#ead9b8`, muted `#b89c74`, gold `#e0a84a`, highlight `#ffd27a`, panel `#2b1d12`, border `#6b4a24`, HP `#9b2a1e → #d4553a`, success `#8fbf7a`. Fonts Cinzel (headings) and Spectral (body), self-hosted via `@fontsource`.
- Layout breakpoint **900 px**: side-by-side at ≥ 900, sheet drawer below.
- Commit after every task with the message given, ending with the `Co-Authored-By` trailer from the session.

## Review Focus

1. **Both players press Act at the same instant** → the round must be adjudicated exactly once. (Task 9: concurrent-submit test.)
2. **A player spends a level-up point while the DM is generating** → the spend must not be overwritten when the round commits. (Task 9: characters are re-read inside the commit transaction; test.)
3. **The whole party is downed** → the game must not dead-lock; everyone may act again so the DM can decide their fate. (Task 9: test.)
4. **Server restarts mid-AI-phase** (laptop sleeps, Ctrl-C) → the campaign must come back as "stalled" with a Try again button, not stuck "thinking". (Task 9: `recoverInterrupted` test.)
5. **The AI uses a different case/spacing for names, or a name/item that doesn't exist** → case-insensitive trimmed matching; unknowns rejected and logged, other ops still applied. (Task 3: tests.)

---

## File Structure

```
package.json, tsconfig.json, vitest.config.ts, vite.config.ts, .env.example, README.md
src/shared/types.ts            Domain + wire types shared by server and client
src/shared/abilities.ts        Modifier, point buy, max HP formula (used by both sides)
src/server/config.ts           Env → Config
src/server/main.ts             Entry: load config, wire deps, listen, print LAN URLs
src/server/app.ts              buildApp(deps): Fastify instance with all plugins/routes
src/server/rules/dice.ts       d20 + check resolution
src/server/rules/ops.ts        Op Zod schema + applyOps
src/server/rules/engine.ts     RulesEngine interface + lightRules
src/server/store/store.ts      SQLite schema + Store API
src/server/auth/lan.ts         isPrivateAddress
src/server/auth/password.ts    passwordMatches, cookieSecret, LoginRateLimiter
src/server/auth/plugin.ts      registerAuth: cookie, LAN filter, login/session routes
src/server/dm/ollama.ts        ChatClient over Ollama /api/chat (streaming) + unload
src/server/dm/narrationStream.ts  Incremental extractor of the "narration" JSON string
src/server/dm/schemas.ts       Zod schemas for DM replies
src/server/dm/context.ts       DmContext + transcripts from events
src/server/dm/prompts.ts       System prompt, blocks, tasks, budgeted messages
src/server/dm/dm.ts            DungeonMaster service (retry, stream, kit, summary)
src/server/turns/status.ts     roundStatus(events)
src/server/turns/snapshot.ts   activeCharacters, buildSnapshot
src/server/turns/turns.ts      TurnService state machine
src/server/realtime/hub.ts     Per-campaign WebSocket rooms
src/server/campaigns/presets.ts   Setting presets + campaign input builder
src/server/campaigns/adventures.ts + adventures/drowned-chapel.json
src/server/routes/api.ts       REST routes
src/server/routes/ws.ts        WebSocket route
scripts/smoke.ts               Real-model smoke test
src/client/index.html, main.tsx, App.tsx, theme.css
src/client/lib/api.ts, router.ts, storage.ts, story.ts, useGameSocket.ts, dice.ts, dice-box.d.ts
src/client/screens/PasswordGate.tsx, Lobby.tsx, NewCampaign.tsx, CreateCharacter.tsx, Play.tsx
src/client/components/Story.tsx, ActionBar.tsx, CharacterSheet.tsx, DiceOverlay.tsx
tests/...                      Mirrors src/
```

---

### Task 1: Project scaffold and config

**Files:**
- Create: `package.json` (via npm), `tsconfig.json`, `vitest.config.ts`, `.env.example`, `src/server/config.ts`
- Test: `tests/server/config.test.ts`

**Interfaces:**
- Produces: `interface Config { tablePassword: string; port: number; host: string; ollamaUrl: string; ollamaModel: string; ollamaKeepAlive: string; dbPath: string; promptBudgetTokens: number }`, `loadConfig(env?: NodeJS.ProcessEnv): Config`

- [ ] **Step 1: Initialise the package and install dependencies**

```bash
cd /Users/daniella/github/ai-dungeon-master
npm init -y
npm pkg set type=module private=true engines.node=">=24" \
  scripts.dev="tsx watch src/server/main.ts" \
  scripts.dev:client="vite" \
  scripts.build="vite build" \
  scripts.start="NODE_ENV=production tsx src/server/main.ts" \
  scripts.test="vitest run" \
  scripts.typecheck="tsc --noEmit" \
  scripts.smoke="tsx scripts/smoke.ts"
npm install fastify @fastify/websocket @fastify/cookie @fastify/static better-sqlite3 zod tsx
npm install -D typescript vitest @types/node @types/better-sqlite3 vite @vitejs/plugin-react \
  react react-dom @types/react @types/react-dom @fontsource/cinzel @fontsource/spectral \
  @3d-dice/dice-box-threejs
```

If `better-sqlite3` fails to build, run `npm rebuild better-sqlite3` and check that the Xcode command line tools are installed (`xcode-select --install`).

- [ ] **Step 2: Write `tsconfig.json`, `vitest.config.ts`, `.env.example`**

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src", "scripts", "tests", "vite.config.ts", "vitest.config.ts"]
}
```

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["tests/**/*.test.ts"], environment: "node" },
});
```

```bash
# .env.example — copy to .env and edit
TABLE_PASSWORD=change-me
PORT=3000
HOST=0.0.0.0
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=qwen3.6:27b
OLLAMA_KEEP_ALIVE=30m
DB_PATH=./data/game.sqlite
PROMPT_BUDGET_TOKENS=12000
```

- [ ] **Step 3: Write the failing test**

```ts
// tests/server/config.test.ts
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/server/config";

describe("loadConfig", () => {
  it("requires TABLE_PASSWORD", () => {
    expect(() => loadConfig({})).toThrow(/TABLE_PASSWORD/);
    expect(() => loadConfig({ TABLE_PASSWORD: "   " })).toThrow(/TABLE_PASSWORD/);
  });

  it("applies defaults", () => {
    expect(loadConfig({ TABLE_PASSWORD: "dragon" })).toEqual({
      tablePassword: "dragon",
      port: 3000,
      host: "0.0.0.0",
      ollamaUrl: "http://localhost:11434",
      ollamaModel: "qwen3.6:27b",
      ollamaKeepAlive: "30m",
      dbPath: "./data/game.sqlite",
      promptBudgetTokens: 12000,
    });
  });

  it("reads overrides and strips a trailing slash from OLLAMA_URL", () => {
    const c = loadConfig({
      TABLE_PASSWORD: "x", PORT: "8080", OLLAMA_URL: "http://192.168.1.20:11434/",
      OLLAMA_MODEL: "qwen3.5:9b", OLLAMA_KEEP_ALIVE: "5m", PROMPT_BUDGET_TOKENS: "8000",
    });
    expect(c.port).toBe(8080);
    expect(c.ollamaUrl).toBe("http://192.168.1.20:11434");
    expect(c.ollamaModel).toBe("qwen3.5:9b");
    expect(c.ollamaKeepAlive).toBe("5m");
    expect(c.promptBudgetTokens).toBe(8000);
  });

  it("rejects a bad port or budget", () => {
    expect(() => loadConfig({ TABLE_PASSWORD: "x", PORT: "abc" })).toThrow(/PORT/);
    expect(() => loadConfig({ TABLE_PASSWORD: "x", PORT: "70000" })).toThrow(/PORT/);
    expect(() => loadConfig({ TABLE_PASSWORD: "x", PROMPT_BUDGET_TOKENS: "100" })).toThrow(/PROMPT_BUDGET_TOKENS/);
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npx vitest run tests/server/config.test.ts`
Expected: FAIL, cannot resolve `../../src/server/config`.

- [ ] **Step 5: Implement**

```ts
// src/server/config.ts
export interface Config {
  tablePassword: string;
  port: number;
  host: string;
  ollamaUrl: string;
  ollamaModel: string;
  ollamaKeepAlive: string;
  dbPath: string;
  promptBudgetTokens: number;
}

function intFrom(env: NodeJS.ProcessEnv, key: string, fallback: number, min: number, max: number): number {
  const raw = env[key];
  const value = raw === undefined || raw === "" ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${key} must be a whole number between ${min} and ${max}, got "${raw}"`);
  }
  return value;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const tablePassword = env.TABLE_PASSWORD?.trim();
  if (!tablePassword) {
    throw new Error("TABLE_PASSWORD must be set: it is the shared password for your table (see .env.example)");
  }
  return {
    tablePassword,
    port: intFrom(env, "PORT", 3000, 1, 65535),
    host: env.HOST || "0.0.0.0",
    ollamaUrl: (env.OLLAMA_URL || "http://localhost:11434").replace(/\/+$/, ""),
    ollamaModel: env.OLLAMA_MODEL || "qwen3.6:27b",
    ollamaKeepAlive: env.OLLAMA_KEEP_ALIVE || "30m",
    dbPath: env.DB_PATH || "./data/game.sqlite",
    promptBudgetTokens: intFrom(env, "PROMPT_BUDGET_TOKENS", 12000, 2000, 200000),
  };
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/server/config.test.ts`
Expected: 4 passed.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold project and config loading"
```

---

### Task 2: Shared types, abilities and dice

**Files:**
- Create: `src/shared/types.ts`, `src/shared/abilities.ts`, `src/server/rules/dice.ts`
- Test: `tests/shared/abilities.test.ts`, `tests/server/rules/dice.test.ts`

**Interfaces:**
- Produces (types): everything in `src/shared/types.ts` below. Later tasks import from it.
- Produces (functions): `modifier(score)`, `formatModifier(mod)`, `baseScores()`, `pointBuyCost(scores): number | null`, `validatePointBuy(scores): string | null`, `maxHpFor(con, level)`, constants `POINT_BUY_BUDGET`, `SCORE_MIN`, `SCORE_MAX`; `type D20 = () => number`, `rollD20: D20`, `resolveCheck(die, score, dc): CheckOutcome`.

- [ ] **Step 1: Write the shared types (no test; it's type-only)**

```ts
// src/shared/types.ts
export const ABILITIES = ["STR", "DEX", "CON", "INT", "WIS", "CHA"] as const;
export type Ability = (typeof ABILITIES)[number];
export type Scores = Record<Ability, number>;

export interface Item { name: string; description: string; qty: number }

export interface Character {
  id: number;
  campaignId: number;
  name: string;
  concept: string;
  level: number;
  hp: number;
  maxHp: number;
  scores: Scores;
  pendingAbilityPoints: number;
  items: Item[];
}

export type Mode = "solo" | "party";
export type AiPhase = "opening" | "adjudicating" | "resolving";
export type RoundState = "lobby" | "collecting" | "awaiting_rolls" | "stalled" | AiPhase;
export const AI_PHASES: readonly AiPhase[] = ["opening", "adjudicating", "resolving"];

export interface AdventureOutline {
  id: string;
  title: string;
  setting: string;
  pitch: string;
  goal: string;
  villain: string;
  locations: string[];
  beats: string[];
}

export interface Campaign {
  id: number;
  title: string;
  mode: Mode;
  setting: string;
  pitch: string;
  outline: AdventureOutline | null;
  sceneTitle: string;
  summary: string;
  roundState: RoundState;
  roundNumber: number;
  stalledPhase: AiPhase | null;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignSummary {
  id: number;
  title: string;
  mode: Mode;
  sceneTitle: string;
  roundState: RoundState;
  updatedAt: string;
  characterNames: string[];
}

export type Op =
  | { op: "damage"; character: string; amount: number }
  | { op: "heal"; character: string; amount: number }
  | { op: "add_item"; character: string; name: string; description: string; qty: number }
  | { op: "remove_item"; character: string; name: string; qty: number }
  | { op: "adjust_stat"; character: string; stat: Ability; delta: -1 | 1 }
  | { op: "level_up"; character: string }
  | { op: "set_scene"; title: string };

export type Crit = "nat20" | "nat1" | null;

export interface CheckOutcome { modifier: number; total: number; success: boolean; crit: Crit }

export type RollEvent = { type: "roll"; characterId: number; ability: Ability; die: number; dc: number } & CheckOutcome;

export type GameEvent =
  | { type: "action"; characterId: number; text: string }
  | { type: "skip"; characterId: number; skippedBy: number }
  | { type: "check_request"; characterId: number; ability: Ability; dc: number; reason: string }
  | RollEvent
  | { type: "narration"; text: string }
  | { type: "op_applied"; op: Op }
  | { type: "op_rejected"; op: unknown; reason: string }
  | { type: "summary"; text: string }
  | { type: "stall"; phase: AiPhase; error: string };

export interface EventMeta { id: number; campaignId: number; round: number; createdAt: string }
export type StoredEvent = GameEvent & EventMeta;
export type StoredRoll = RollEvent & EventMeta;

export interface PendingCheck { characterId: number; ability: Ability; dc: number; reason: string; roll: RollEvent | null }

export interface RoundStatus {
  actions: { characterId: number; text: string }[];
  skippedIds: number[];
  checks: PendingCheck[];
}

export interface Snapshot {
  campaign: Campaign;
  characters: Character[];
  events: StoredEvent[];
  round: RoundStatus;
  activeIds: number[];
}

export type ServerMsg =
  | { t: "snapshot"; snapshot: Snapshot }
  | { t: "narration_chunk"; text: string }
  | { t: "narration_reset" }
  | { t: "error"; message: string };

export type ClientMsg =
  | { t: "begin" }
  | { t: "action"; characterId: number; text: string }
  | { t: "skip"; characterId: number; by: number }
  | { t: "roll"; characterId: number }
  | { t: "retry" };

export interface Preset { id: string; name: string; blurb: string; setting: string }
export interface AdventureInfo { id: string; title: string; pitch: string }
export interface KitItem { name: string; description: string }

export type CampaignSource =
  | { kind: "preset"; presetId: string }
  | { kind: "pitch"; pitch: string }
  | { kind: "adventure"; adventureId: string };

export interface NewCampaignRequest { mode: Mode; title?: string; source: CampaignSource }
export interface NewCharacterRequest { name: string; concept: string; scores: Scores; items: KitItem[] }
```

- [ ] **Step 2: Write the failing tests**

```ts
// tests/shared/abilities.test.ts
import { describe, expect, it } from "vitest";
import {
  baseScores, formatModifier, maxHpFor, modifier, pointBuyCost, validatePointBuy,
} from "../../src/shared/abilities";

describe("modifier", () => {
  it.each([[1, -5], [8, -1], [9, -1], [10, 0], [11, 0], [12, 1], [15, 2], [20, 5]])(
    "score %i → %i", (score, mod) => expect(modifier(score)).toBe(mod),
  );
  it("formats with a sign", () => {
    expect(formatModifier(2)).toBe("+2");
    expect(formatModifier(0)).toBe("+0");
    expect(formatModifier(-1)).toBe("-1");
  });
});

describe("point buy", () => {
  it("base scores cost nothing", () => {
    expect(baseScores()).toEqual({ STR: 8, DEX: 8, CON: 8, INT: 8, WIS: 8, CHA: 8 });
    expect(pointBuyCost(baseScores())).toBe(0);
  });
  it("uses the 5e cost table", () => {
    expect(pointBuyCost({ STR: 15, DEX: 15, CON: 15, INT: 8, WIS: 8, CHA: 8 })).toBe(27);
    expect(pointBuyCost({ STR: 14, DEX: 13, CON: 12, INT: 11, WIS: 10, CHA: 9 })).toBe(7 + 5 + 4 + 3 + 2 + 1);
  });
  it("returns null for scores outside 8–15 or non-integers", () => {
    expect(pointBuyCost({ ...baseScores(), STR: 16 })).toBeNull();
    expect(pointBuyCost({ ...baseScores(), STR: 7 })).toBeNull();
    expect(pointBuyCost({ ...baseScores(), STR: 12.5 })).toBeNull();
  });
  it("validates budget and range with readable messages", () => {
    expect(validatePointBuy({ STR: 15, DEX: 15, CON: 15, INT: 8, WIS: 8, CHA: 8 })).toBeNull();
    expect(validatePointBuy(baseScores())).toBeNull();
    expect(validatePointBuy({ STR: 15, DEX: 15, CON: 15, INT: 9, WIS: 8, CHA: 8 })).toMatch(/28 of 27/);
    expect(validatePointBuy({ ...baseScores(), STR: 16 })).toMatch(/between 8 and 15/);
  });
});

describe("maxHpFor", () => {
  it("is 20 + 2×CON mod at level 1, minimum 10", () => {
    expect(maxHpFor(10, 1)).toBe(20);
    expect(maxHpFor(14, 1)).toBe(24);
    expect(maxHpFor(8, 1)).toBe(18);
    expect(maxHpFor(1, 1)).toBe(10);
  });
  it("adds max(1, 5 + CON mod) per level after the first", () => {
    expect(maxHpFor(14, 3)).toBe(24 + 2 * 7);
    expect(maxHpFor(1, 2)).toBe(10 + 1);
  });
});
```

```ts
// tests/server/rules/dice.test.ts
import { describe, expect, it } from "vitest";
import { resolveCheck, rollD20 } from "../../../src/server/rules/dice";

describe("rollD20", () => {
  it("only produces 1..20 and eventually all of them", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 5000; i++) {
      const r = rollD20();
      expect(Number.isInteger(r) && r >= 1 && r <= 20).toBe(true);
      seen.add(r);
    }
    expect(seen.size).toBe(20);
  });
});

describe("resolveCheck", () => {
  it("adds the ability modifier and compares to DC", () => {
    expect(resolveCheck(12, 15, 14)).toEqual({ modifier: 2, total: 14, success: true, crit: null });
    expect(resolveCheck(11, 15, 14)).toEqual({ modifier: 2, total: 13, success: false, crit: null });
  });
  it("natural 20 always succeeds", () => {
    expect(resolveCheck(20, 1, 25)).toEqual({ modifier: -5, total: 15, success: true, crit: "nat20" });
  });
  it("natural 1 always fails", () => {
    expect(resolveCheck(1, 20, 5)).toEqual({ modifier: 5, total: 6, success: false, crit: "nat1" });
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run tests/shared tests/server/rules/dice.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 4: Implement**

```ts
// src/shared/abilities.ts
import { ABILITIES, type Scores } from "./types";

export const POINT_BUY_BUDGET = 27;
export const SCORE_MIN = 1;
export const SCORE_MAX = 20;
const POINT_BUY_COST: Record<number, number> = { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 };

export function modifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

export function formatModifier(mod: number): string {
  return mod >= 0 ? `+${mod}` : `${mod}`;
}

export function baseScores(): Scores {
  return { STR: 8, DEX: 8, CON: 8, INT: 8, WIS: 8, CHA: 8 };
}

export function pointBuyCost(scores: Scores): number | null {
  let total = 0;
  for (const a of ABILITIES) {
    const cost = POINT_BUY_COST[scores[a]];
    if (cost === undefined) return null;
    total += cost;
  }
  return total;
}

export function validatePointBuy(scores: Scores): string | null {
  const cost = pointBuyCost(scores);
  if (cost === null) return "Each ability must be a whole number between 8 and 15 at creation.";
  if (cost > POINT_BUY_BUDGET) return `Point buy uses ${cost} of ${POINT_BUY_BUDGET} points.`;
  return null;
}

export function maxHpFor(con: number, level: number): number {
  const m = modifier(con);
  return Math.max(10, 20 + 2 * m) + (level - 1) * Math.max(1, 5 + m);
}
```

```ts
// src/server/rules/dice.ts
import { randomInt } from "node:crypto";
import { modifier } from "../../shared/abilities";
import type { CheckOutcome } from "../../shared/types";

export type D20 = () => number;

export const rollD20: D20 = () => randomInt(1, 21);

export function resolveCheck(die: number, score: number, dc: number): CheckOutcome {
  const mod = modifier(score);
  const total = die + mod;
  const crit = die === 20 ? "nat20" : die === 1 ? "nat1" : null;
  const success = crit === "nat20" ? true : crit === "nat1" ? false : total >= dc;
  return { modifier: mod, total, success, crit };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/shared tests/server/rules/dice.test.ts`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: shared domain types, 5e ability maths and server dice"
```

---

### Task 3: State-change ops and the rules engine

**Files:**
- Create: `src/server/rules/ops.ts`, `src/server/rules/engine.ts`
- Test: `tests/server/rules/ops.test.ts`, `tests/server/rules/engine.test.ts`

**Interfaces:**
- Consumes: types from Task 2; `maxHpFor`, `SCORE_MIN/MAX`, `validatePointBuy` from `abilities.ts`; `resolveCheck` from `dice.ts`.
- Produces:
  - `OpSchema` (Zod, output type `Op`)
  - `interface ApplyResult { characters: Character[]; applied: Op[]; rejected: { op: unknown; reason: string }[]; sceneTitle: string | null }`
  - `applyOps(characters: Character[], rawOps: unknown[]): ApplyResult` (pure, never mutates input)
  - `findCharacterByName(chars: Character[], name: string): Character | undefined`
  - `recalcMaxHp(c: Character): void` (mutates)
  - `interface RulesEngine { name; rulesSummary; opsGuide; opSchema; validateNewCharacter(scores): string | null; startingMaxHp(scores): number; check(die, scores, ability, dc): CheckOutcome; applyOps(...): ApplyResult; spendAbilityPoint(c, ability): { character: Character } | { error: string }; isDowned(c): boolean }`
  - `lightRules: RulesEngine`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/server/rules/ops.test.ts
import { describe, expect, it } from "vitest";
import { applyOps } from "../../../src/server/rules/ops";
import type { Character } from "../../../src/shared/types";

function hero(over: Partial<Character> = {}): Character {
  return {
    id: 1, campaignId: 1, name: "Corvin Ash", concept: "knight", level: 1, hp: 20, maxHp: 20,
    scores: { STR: 15, DEX: 10, CON: 10, INT: 8, WIS: 12, CHA: 8 }, pendingAbilityPoints: 0,
    items: [{ name: "Rope", description: "30ft", qty: 1 }], ...over,
  };
}

describe("applyOps", () => {
  it("does not mutate its input", () => {
    const chars = [hero()];
    applyOps(chars, [{ op: "damage", character: "Corvin Ash", amount: 5 }]);
    expect(chars[0].hp).toBe(20);
  });

  it("matches names case-insensitively and ignoring surrounding spaces", () => {
    const r = applyOps([hero()], [{ op: "damage", character: "  corvin ash ", amount: 5 }]);
    expect(r.characters[0].hp).toBe(15);
    expect(r.applied).toHaveLength(1);
  });

  it("rejects unknown characters but still applies the rest", () => {
    const r = applyOps([hero()], [
      { op: "damage", character: "Gandalf", amount: 5 },
      { op: "heal", character: "Corvin Ash", amount: 1 },
    ]);
    expect(r.rejected).toEqual([{ op: { op: "damage", character: "Gandalf", amount: 5 }, reason: 'unknown character "Gandalf"' }]);
    expect(r.applied).toHaveLength(1);
  });

  it("rejects malformed ops with a reason", () => {
    const r = applyOps([hero()], [{ op: "damage", character: "Corvin Ash", amount: 500 }, { op: "teleport" }, "nonsense"]);
    expect(r.rejected).toHaveLength(3);
    expect(r.rejected[0].reason).toMatch(/invalid op/);
  });

  it("clamps damage at 0 and healing at max", () => {
    expect(applyOps([hero({ hp: 3 })], [{ op: "damage", character: "Corvin Ash", amount: 10 }]).characters[0].hp).toBe(0);
    expect(applyOps([hero({ hp: 18 })], [{ op: "heal", character: "Corvin Ash", amount: 10 }]).characters[0].hp).toBe(20);
  });

  it("adds items, merging quantities case-insensitively", () => {
    const r = applyOps([hero()], [
      { op: "add_item", character: "Corvin Ash", name: "Silver locket", description: "Cold to the touch" },
      { op: "add_item", character: "Corvin Ash", name: "rope", description: "", qty: 2 },
    ]);
    expect(r.characters[0].items).toEqual([
      { name: "Rope", description: "30ft", qty: 3 },
      { name: "Silver locket", description: "Cold to the touch", qty: 1 },
    ]);
  });

  it("removes items and rejects removing what isn't held", () => {
    const r = applyOps([hero()], [
      { op: "remove_item", character: "Corvin Ash", name: "ROPE" },
      { op: "remove_item", character: "Corvin Ash", name: "Torch" },
    ]);
    expect(r.characters[0].items).toEqual([]);
    expect(r.rejected[0].reason).toBe('Corvin Ash has no "Torch"');
    const r2 = applyOps([hero()], [{ op: "remove_item", character: "Corvin Ash", name: "Rope", qty: 2 }]);
    expect(r2.rejected[0].reason).toBe("Corvin Ash only has 1 × Rope");
  });

  it("adjusts stats within 1..20 and recalculates HP when CON changes", () => {
    const r = applyOps([hero({ scores: { STR: 20, DEX: 10, CON: 11, INT: 8, WIS: 12, CHA: 8 } })], [
      { op: "adjust_stat", character: "Corvin Ash", stat: "STR", delta: 1 },
      { op: "adjust_stat", character: "Corvin Ash", stat: "CON", delta: 1 },
    ]);
    expect(r.rejected[0].reason).toBe("STR can't go above 20");
    expect(r.characters[0].scores.CON).toBe(12);
    expect(r.characters[0].maxHp).toBe(22);
    expect(r.characters[0].hp).toBe(22);
  });

  it("level_up raises level, max HP, heals the gain and grants 2 ability points", () => {
    const r = applyOps([hero({ hp: 10 })], [{ op: "level_up", character: "Corvin Ash" }]);
    expect(r.characters[0]).toMatchObject({ level: 2, maxHp: 25, hp: 15, pendingAbilityPoints: 2 });
  });

  it("set_scene returns the title", () => {
    const r = applyOps([hero()], [{ op: "set_scene", title: "The Drowned Chapel" }]);
    expect(r.sceneTitle).toBe("The Drowned Chapel");
  });
});
```

```ts
// tests/server/rules/engine.test.ts
import { describe, expect, it } from "vitest";
import { lightRules } from "../../../src/server/rules/engine";
import type { Character } from "../../../src/shared/types";

const c = (over: Partial<Character> = {}): Character => ({
  id: 1, campaignId: 1, name: "Wren", concept: "scout", level: 2, hp: 10, maxHp: 25,
  scores: { STR: 10, DEX: 19, CON: 10, INT: 8, WIS: 12, CHA: 8 }, pendingAbilityPoints: 2, items: [], ...over,
});

describe("lightRules", () => {
  it("validates new characters with point buy", () => {
    expect(lightRules.validateNewCharacter({ STR: 15, DEX: 15, CON: 15, INT: 8, WIS: 8, CHA: 8 })).toBeNull();
    expect(lightRules.validateNewCharacter({ STR: 16, DEX: 8, CON: 8, INT: 8, WIS: 8, CHA: 8 })).not.toBeNull();
  });

  it("computes starting HP from CON", () => {
    expect(lightRules.startingMaxHp({ STR: 8, DEX: 8, CON: 14, INT: 8, WIS: 8, CHA: 8 })).toBe(24);
  });

  it("uses the ability's score for checks", () => {
    expect(lightRules.check(10, c().scores, "DEX", 14)).toEqual({ modifier: 4, total: 14, success: true, crit: null });
  });

  it("spends ability points up to 20 and returns a copy", () => {
    const orig = c();
    const r = lightRules.spendAbilityPoint(orig, "DEX");
    expect("character" in r && r.character.scores.DEX).toBe(20);
    expect("character" in r && r.character.pendingAbilityPoints).toBe(1);
    expect(orig.scores.DEX).toBe(19);
    const capped = lightRules.spendAbilityPoint(c({ scores: { ...c().scores, DEX: 20 } }), "DEX");
    expect(capped).toEqual({ error: "DEX is already 20" });
    expect(lightRules.spendAbilityPoint(c({ pendingAbilityPoints: 0 }), "STR")).toEqual({ error: "No ability points to spend" });
  });

  it("spending on CON recalculates max HP", () => {
    const r = lightRules.spendAbilityPoint(c({ scores: { ...c().scores, CON: 11 }, maxHp: 25, hp: 25 }), "CON");
    // CON 12 → mod +1: 22 at level 1, + max(1, 5 + 1) = 6 at level 2
    expect("character" in r && r.character.maxHp).toBe(28);
  });

  it("is downed at 0 HP", () => {
    expect(lightRules.isDowned(c({ hp: 0 }))).toBe(true);
    expect(lightRules.isDowned(c({ hp: 1 }))).toBe(false);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/server/rules`
Expected: FAIL, `ops`/`engine` modules not found.

- [ ] **Step 3: Implement `ops.ts`**

```ts
// src/server/rules/ops.ts
import { z } from "zod";
import { maxHpFor, SCORE_MAX, SCORE_MIN } from "../../shared/abilities";
import { ABILITIES, type Character, type Op } from "../../shared/types";

const name = z.string().trim().min(1).max(60);
const amount = z.number().int().min(1).max(50);

export const OpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("damage"), character: name, amount }),
  z.object({ op: z.literal("heal"), character: name, amount }),
  z.object({
    op: z.literal("add_item"), character: name, name,
    description: z.string().trim().max(200).default(""),
    qty: z.number().int().min(1).max(99).default(1),
  }),
  z.object({ op: z.literal("remove_item"), character: name, name, qty: z.number().int().min(1).max(99).default(1) }),
  z.object({ op: z.literal("adjust_stat"), character: name, stat: z.enum(ABILITIES), delta: z.union([z.literal(-1), z.literal(1)]) }),
  z.object({ op: z.literal("level_up"), character: name }),
  z.object({ op: z.literal("set_scene"), title: z.string().trim().min(1).max(80) }),
]) satisfies z.ZodType<Op>;

export interface ApplyResult {
  characters: Character[];
  applied: Op[];
  rejected: { op: unknown; reason: string }[];
  sceneTitle: string | null;
}

export function findCharacterByName(chars: Character[], name: string): Character | undefined {
  const wanted = name.trim().toLowerCase();
  return chars.find((c) => c.name.toLowerCase() === wanted);
}

export function recalcMaxHp(c: Character): void {
  const newMax = maxHpFor(c.scores.CON, c.level);
  const gain = newMax - c.maxHp;
  c.maxHp = newMax;
  c.hp = Math.min(newMax, Math.max(0, gain > 0 ? c.hp + gain : c.hp));
}

function applyOne(c: Character, op: Exclude<Op, { op: "set_scene" }>): string | null {
  switch (op.op) {
    case "damage":
      c.hp = Math.max(0, c.hp - op.amount);
      return null;
    case "heal":
      c.hp = Math.min(c.maxHp, c.hp + op.amount);
      return null;
    case "add_item": {
      const existing = c.items.find((i) => i.name.toLowerCase() === op.name.toLowerCase());
      if (existing) existing.qty += op.qty;
      else c.items.push({ name: op.name, description: op.description, qty: op.qty });
      return null;
    }
    case "remove_item": {
      const existing = c.items.find((i) => i.name.toLowerCase() === op.name.toLowerCase());
      if (!existing) return `${c.name} has no "${op.name}"`;
      if (existing.qty < op.qty) return `${c.name} only has ${existing.qty} × ${existing.name}`;
      existing.qty -= op.qty;
      if (existing.qty === 0) c.items = c.items.filter((i) => i !== existing);
      return null;
    }
    case "adjust_stat": {
      const next = c.scores[op.stat] + op.delta;
      if (next > SCORE_MAX) return `${op.stat} can't go above ${SCORE_MAX}`;
      if (next < SCORE_MIN) return `${op.stat} can't go below ${SCORE_MIN}`;
      c.scores[op.stat] = next;
      if (op.stat === "CON") recalcMaxHp(c);
      return null;
    }
    case "level_up":
      c.level += 1;
      c.pendingAbilityPoints += 2;
      recalcMaxHp(c);
      return null;
  }
}

export function applyOps(characters: Character[], rawOps: unknown[]): ApplyResult {
  const chars = structuredClone(characters);
  const result: ApplyResult = { characters: chars, applied: [], rejected: [], sceneTitle: null };
  for (const raw of rawOps) {
    const parsed = OpSchema.safeParse(raw);
    if (!parsed.success) {
      result.rejected.push({ op: raw, reason: `invalid op: ${z.prettifyError(parsed.error)}` });
      continue;
    }
    const op = parsed.data;
    if (op.op === "set_scene") {
      result.sceneTitle = op.title;
      result.applied.push(op);
      continue;
    }
    const target = findCharacterByName(chars, op.character);
    if (!target) {
      result.rejected.push({ op, reason: `unknown character "${op.character}"` });
      continue;
    }
    const reason = applyOne(target, op);
    if (reason) result.rejected.push({ op, reason });
    else result.applied.push(op);
  }
  return result;
}
```

Note: the test for unknown characters expects the rejected `op` to equal the parsed op (`{ op: "damage", character: "Gandalf", amount: 5 }`), which it does because parsing doesn't change those fields.

- [ ] **Step 4: Implement `engine.ts`**

```ts
// src/server/rules/engine.ts
import type { z } from "zod";
import { validatePointBuy, maxHpFor, SCORE_MAX } from "../../shared/abilities";
import type { Ability, Character, CheckOutcome, Op, Scores } from "../../shared/types";
import { resolveCheck } from "./dice";
import { applyOps, OpSchema, recalcMaxHp, type ApplyResult } from "./ops";

export interface RulesEngine {
  readonly name: string;
  /** Plain-English rules for the DM system prompt. */
  readonly rulesSummary: string;
  /** One line per op, shown to the DM. */
  readonly opsGuide: string;
  readonly opSchema: z.ZodType<Op>;
  validateNewCharacter(scores: Scores): string | null;
  startingMaxHp(scores: Scores): number;
  check(die: number, scores: Scores, ability: Ability, dc: number): CheckOutcome;
  applyOps(characters: Character[], ops: unknown[]): ApplyResult;
  spendAbilityPoint(c: Character, ability: Ability): { character: Character } | { error: string };
  isDowned(c: Character): boolean;
}

export const lightRules: RulesEngine = {
  name: "light-5e-abilities",
  rulesSummary: [
    "- Six abilities (STR, DEX, CON, INT, WIS, CHA) use D&D 5e scores; modifier = (score - 10) / 2, rounded down.",
    "- Ability check: d20 + modifier vs a DC (10 easy, 15 moderate, 20 hard, 25 nearly impossible). Natural 20 always succeeds; natural 1 always fails.",
    "- A character at 0 HP is downed and cannot act until healed.",
    "- There are no classes, spells or armour class: describe magic and combat in the story and use damage/heal ops for harm and recovery. Typical damage: 1-4 minor, 5-8 serious, 9-15 deadly.",
  ].join("\n"),
  opsGuide: [
    '- {"op":"damage","character":NAME,"amount":1-50}',
    '- {"op":"heal","character":NAME,"amount":1-50}',
    '- {"op":"add_item","character":NAME,"name":ITEM,"description":SHORT_TEXT,"qty":1}',
    '- {"op":"remove_item","character":NAME,"name":ITEM,"qty":1}',
    '- {"op":"adjust_stat","character":NAME,"stat":"STR"|"DEX"|"CON"|"INT"|"WIS"|"CHA","delta":1 or -1}  (a permanent change; rare)',
    '- {"op":"level_up","character":NAME}',
    '- {"op":"set_scene","title":SHORT_PLACE_NAME}  (when the party arrives somewhere new)',
  ].join("\n"),
  opSchema: OpSchema,
  validateNewCharacter: validatePointBuy,
  startingMaxHp: (scores) => maxHpFor(scores.CON, 1),
  check: (die, scores, ability, dc) => resolveCheck(die, scores[ability], dc),
  applyOps,
  spendAbilityPoint(c, ability) {
    if (c.pendingAbilityPoints <= 0) return { error: "No ability points to spend" };
    if (c.scores[ability] >= SCORE_MAX) return { error: `${ability} is already ${SCORE_MAX}` };
    const next = structuredClone(c);
    next.scores[ability] += 1;
    next.pendingAbilityPoints -= 1;
    if (ability === "CON") recalcMaxHp(next);
    return { character: next };
  },
  isDowned: (c) => c.hp <= 0,
};
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/server/rules`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: validated state-change ops and light rules engine"
```

---

### Task 4: SQLite store

**Files:**
- Create: `src/server/store/store.ts`
- Test: `tests/server/store/store.test.ts`

**Interfaces:**
- Consumes: shared types.
- Produces:
  - `class NameTakenError extends Error`
  - `interface NewCampaignInput { title: string; mode: Mode; setting: string; pitch: string; outline: AdventureOutline | null }`
  - `interface NewCharacterInput { campaignId: number; name: string; concept: string; scores: Scores; hp: number; maxHp: number; items: Item[] }`
  - `type CampaignPatch = Partial<Pick<Campaign, "sceneTitle" | "summary" | "roundState" | "roundNumber" | "stalledPhase">>`
  - `interface EventQuery { fromRound?: number; toRound?: number; limit?: number }` (`limit` = latest N, returned oldest-first)
  - `interface Store { createCampaign(i): Campaign; getCampaign(id): Campaign | undefined; listCampaigns(): CampaignSummary[]; updateCampaign(id, patch): void; createCharacter(i): Character; getCharacter(id): Character | undefined; getCharacters(campaignId): Character[]; saveCharacter(c): void; appendEvent(campaignId, round, e: GameEvent): StoredEvent; getEvents(campaignId, q?: EventQuery): StoredEvent[]; transaction<T>(fn: () => T): T; close(): void }`
  - `createStore(path: string): Store` (`":memory:"` for tests)

- [ ] **Step 1: Write the failing tests**

```ts
// tests/server/store/store.test.ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createStore, NameTakenError, type Store } from "../../../src/server/store/store";

const scores = { STR: 15, DEX: 10, CON: 14, INT: 8, WIS: 12, CHA: 8 };
let store: Store;
afterEach(() => store?.close());

function seed(s: Store) {
  const campaign = s.createCampaign({ title: "Test", mode: "party", setting: "Fantasy", pitch: "", outline: null });
  const corvin = s.createCharacter({
    campaignId: campaign.id, name: "Corvin", concept: "knight", scores, hp: 24, maxHp: 24,
    items: [{ name: "Rope", description: "30ft", qty: 1 }],
  });
  return { campaign, corvin };
}

describe("store", () => {
  it("creates campaigns with lobby defaults", () => {
    store = createStore(":memory:");
    const { campaign } = seed(store);
    expect(campaign).toMatchObject({ title: "Test", mode: "party", roundState: "lobby", roundNumber: 0, sceneTitle: "", summary: "", stalledPhase: null, outline: null });
    expect(store.getCampaign(campaign.id)).toEqual(campaign);
  });

  it("round-trips an adventure outline", () => {
    store = createStore(":memory:");
    const outline = { id: "x", title: "X", setting: "s", pitch: "p", goal: "g", villain: "v", locations: ["a"], beats: ["b"] };
    const c = store.createCampaign({ title: "X", mode: "solo", setting: "s", pitch: "p", outline });
    expect(store.getCampaign(c.id)?.outline).toEqual(outline);
  });

  it("updates campaign fields and bumps updatedAt", () => {
    store = createStore(":memory:");
    const { campaign } = seed(store);
    store.updateCampaign(campaign.id, { roundState: "stalled", stalledPhase: "resolving", roundNumber: 3, sceneTitle: "Gate" });
    expect(store.getCampaign(campaign.id)).toMatchObject({ roundState: "stalled", stalledPhase: "resolving", roundNumber: 3, sceneTitle: "Gate" });
  });

  it("stores characters with items and lists them by campaign", () => {
    store = createStore(":memory:");
    const { campaign, corvin } = seed(store);
    expect(corvin).toMatchObject({ name: "Corvin", level: 1, hp: 24, maxHp: 24, scores, pendingAbilityPoints: 0, items: [{ name: "Rope", description: "30ft", qty: 1 }] });
    expect(store.getCharacters(campaign.id).map((c) => c.name)).toEqual(["Corvin"]);
    expect(store.listCampaigns()).toEqual([expect.objectContaining({ id: campaign.id, characterNames: ["Corvin"] })]);
  });

  it("rejects duplicate character names in a campaign, case-insensitively", () => {
    store = createStore(":memory:");
    const { campaign } = seed(store);
    expect(() => store.createCharacter({ campaignId: campaign.id, name: "corvin", concept: "x", scores, hp: 20, maxHp: 20, items: [] })).toThrow(NameTakenError);
  });

  it("saves characters, replacing items", () => {
    store = createStore(":memory:");
    const { corvin } = seed(store);
    store.saveCharacter({ ...corvin, hp: 3, level: 2, pendingAbilityPoints: 2, scores: { ...scores, STR: 16 }, items: [{ name: "Locket", description: "silver", qty: 1 }] });
    expect(store.getCharacter(corvin.id)).toMatchObject({ hp: 3, level: 2, pendingAbilityPoints: 2, scores: { STR: 16 }, items: [{ name: "Locket", description: "silver", qty: 1 }] });
  });

  it("appends and queries events by round and limit", () => {
    store = createStore(":memory:");
    const { campaign, corvin } = seed(store);
    store.appendEvent(campaign.id, 0, { type: "narration", text: "Once" });
    const a = store.appendEvent(campaign.id, 1, { type: "action", characterId: corvin.id, text: "I knock" });
    store.appendEvent(campaign.id, 2, { type: "narration", text: "Later" });
    expect(a).toMatchObject({ type: "action", text: "I knock", round: 1, campaignId: campaign.id });
    expect(store.getEvents(campaign.id).map((e) => e.round)).toEqual([0, 1, 2]);
    expect(store.getEvents(campaign.id, { fromRound: 1, toRound: 1 }).map((e) => e.type)).toEqual(["action"]);
    expect(store.getEvents(campaign.id, { limit: 2 }).map((e) => e.round)).toEqual([1, 2]);
  });

  it("rolls back a failed transaction", () => {
    store = createStore(":memory:");
    const { campaign } = seed(store);
    expect(() => store.transaction(() => {
      store.appendEvent(campaign.id, 1, { type: "narration", text: "lost" });
      throw new Error("boom");
    })).toThrow("boom");
    expect(store.getEvents(campaign.id)).toEqual([]);
  });

  it("persists to disk across reopen", () => {
    const dir = mkdtempSync(join(tmpdir(), "adm-"));
    const path = join(dir, "nested", "game.sqlite");
    try {
      store = createStore(path);
      const { campaign } = seed(store);
      store.appendEvent(campaign.id, 0, { type: "narration", text: "Saved" });
      store.close();
      store = createStore(path);
      expect(store.getEvents(campaign.id)[0]).toMatchObject({ type: "narration", text: "Saved" });
      expect(store.getCharacters(campaign.id)).toHaveLength(1);
    } finally {
      store.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

`close()` must be safe to call twice (the `afterEach` calls it again).

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/server/store`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// src/server/store/store.ts
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type {
  AdventureOutline, AiPhase, Campaign, CampaignSummary, Character, GameEvent, Item, Mode, RoundState, Scores, StoredEvent,
} from "../../shared/types";

export class NameTakenError extends Error {}

export interface NewCampaignInput { title: string; mode: Mode; setting: string; pitch: string; outline: AdventureOutline | null }
export interface NewCharacterInput { campaignId: number; name: string; concept: string; scores: Scores; hp: number; maxHp: number; items: Item[] }
export type CampaignPatch = Partial<Pick<Campaign, "sceneTitle" | "summary" | "roundState" | "roundNumber" | "stalledPhase">>;
export interface EventQuery { fromRound?: number; toRound?: number; limit?: number }

export interface Store {
  createCampaign(input: NewCampaignInput): Campaign;
  getCampaign(id: number): Campaign | undefined;
  listCampaigns(): CampaignSummary[];
  updateCampaign(id: number, patch: CampaignPatch): void;
  createCharacter(input: NewCharacterInput): Character;
  getCharacter(id: number): Character | undefined;
  getCharacters(campaignId: number): Character[];
  saveCharacter(c: Character): void;
  appendEvent(campaignId: number, round: number, event: GameEvent): StoredEvent;
  getEvents(campaignId: number, query?: EventQuery): StoredEvent[];
  transaction<T>(fn: () => T): T;
  close(): void;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('solo','party')),
  setting TEXT NOT NULL,
  pitch TEXT NOT NULL DEFAULT '',
  outline_json TEXT,
  scene_title TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  round_state TEXT NOT NULL DEFAULT 'lobby',
  round_number INTEGER NOT NULL DEFAULT 0,
  stalled_phase TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE IF NOT EXISTS characters (
  id INTEGER PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  concept TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 1,
  hp INTEGER NOT NULL,
  max_hp INTEGER NOT NULL,
  str INTEGER NOT NULL, dex INTEGER NOT NULL, con INTEGER NOT NULL,
  int INTEGER NOT NULL, wis INTEGER NOT NULL, cha INTEGER NOT NULL,
  pending_ability_points INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_characters_name ON characters(campaign_id, lower(name));
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY,
  character_id INTEGER NOT NULL REFERENCES characters(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  qty INTEGER NOT NULL CHECK (qty >= 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_items_name ON items(character_id, lower(name));
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  round_number INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS ix_events_campaign_round ON events(campaign_id, round_number, id);
`;

interface CampaignRow {
  id: number; title: string; mode: Mode; setting: string; pitch: string; outline_json: string | null;
  scene_title: string; summary: string; round_state: RoundState; round_number: number;
  stalled_phase: AiPhase | null; created_at: string; updated_at: string;
}
interface CharacterRow {
  id: number; campaign_id: number; name: string; concept: string; level: number; hp: number; max_hp: number;
  str: number; dex: number; con: number; int: number; wis: number; cha: number; pending_ability_points: number;
}
interface EventRow { id: number; campaign_id: number; round_number: number; type: string; payload_json: string; created_at: string }

const toCampaign = (r: CampaignRow): Campaign => ({
  id: r.id, title: r.title, mode: r.mode, setting: r.setting, pitch: r.pitch,
  outline: r.outline_json ? (JSON.parse(r.outline_json) as AdventureOutline) : null,
  sceneTitle: r.scene_title, summary: r.summary, roundState: r.round_state, roundNumber: r.round_number,
  stalledPhase: r.stalled_phase, createdAt: r.created_at, updatedAt: r.updated_at,
});

const toEvent = (r: EventRow): StoredEvent => ({
  ...(JSON.parse(r.payload_json) as GameEvent),
  id: r.id, campaignId: r.campaign_id, round: r.round_number, createdAt: r.created_at,
});

const PATCH_COLUMNS: Record<keyof CampaignPatch, string> = {
  sceneTitle: "scene_title", summary: "summary", roundState: "round_state", roundNumber: "round_number", stalledPhase: "stalled_phase",
};

export function createStore(path: string): Store {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA);

  const itemsFor = db.prepare<[number], Item>("SELECT name, description, qty FROM items WHERE character_id = ? ORDER BY id");
  const toCharacter = (r: CharacterRow): Character => ({
    id: r.id, campaignId: r.campaign_id, name: r.name, concept: r.concept, level: r.level, hp: r.hp, maxHp: r.max_hp,
    scores: { STR: r.str, DEX: r.dex, CON: r.con, INT: r.int, WIS: r.wis, CHA: r.cha },
    pendingAbilityPoints: r.pending_ability_points, items: itemsFor.all(r.id),
  });
  const insertItem = db.prepare("INSERT INTO items (character_id, name, description, qty) VALUES (?, ?, ?, ?)");
  let closed = false;

  const store: Store = {
    createCampaign(i) {
      const info = db.prepare("INSERT INTO campaigns (title, mode, setting, pitch, outline_json) VALUES (?, ?, ?, ?, ?)")
        .run(i.title, i.mode, i.setting, i.pitch, i.outline ? JSON.stringify(i.outline) : null);
      return store.getCampaign(Number(info.lastInsertRowid))!;
    },
    getCampaign(id) {
      const row = db.prepare<[number], CampaignRow>("SELECT * FROM campaigns WHERE id = ?").get(id);
      return row ? toCampaign(row) : undefined;
    },
    listCampaigns() {
      const rows = db.prepare<[], CampaignRow>("SELECT * FROM campaigns ORDER BY updated_at DESC, id DESC").all();
      const names = db.prepare<[number], { name: string }>("SELECT name FROM characters WHERE campaign_id = ? ORDER BY id");
      return rows.map((r) => ({
        id: r.id, title: r.title, mode: r.mode, sceneTitle: r.scene_title, roundState: r.round_state,
        updatedAt: r.updated_at, characterNames: names.all(r.id).map((n) => n.name),
      }));
    },
    updateCampaign(id, patch) {
      const keys = Object.keys(patch) as (keyof CampaignPatch)[];
      if (keys.length === 0) return;
      const sets = keys.map((k) => `${PATCH_COLUMNS[k]} = @${k}`).join(", ");
      db.prepare(`UPDATE campaigns SET ${sets}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = @id`).run({ ...patch, id });
    },
    createCharacter(i) {
      try {
        const id = db.transaction(() => {
          const info = db.prepare(`INSERT INTO characters (campaign_id, name, concept, hp, max_hp, str, dex, con, int, wis, cha)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
            i.campaignId, i.name, i.concept, i.hp, i.maxHp,
            i.scores.STR, i.scores.DEX, i.scores.CON, i.scores.INT, i.scores.WIS, i.scores.CHA,
          );
          const cid = Number(info.lastInsertRowid);
          for (const it of i.items) insertItem.run(cid, it.name, it.description, it.qty);
          return cid;
        })();
        return store.getCharacter(id)!;
      } catch (e) {
        if ((e as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE") {
          throw new NameTakenError(`There's already a hero called ${i.name} in this campaign.`);
        }
        throw e;
      }
    },
    getCharacter(id) {
      const row = db.prepare<[number], CharacterRow>("SELECT * FROM characters WHERE id = ?").get(id);
      return row ? toCharacter(row) : undefined;
    },
    getCharacters(campaignId) {
      return db.prepare<[number], CharacterRow>("SELECT * FROM characters WHERE campaign_id = ? ORDER BY id").all(campaignId).map(toCharacter);
    },
    saveCharacter(c) {
      db.transaction(() => {
        db.prepare(`UPDATE characters SET level = ?, hp = ?, max_hp = ?, str = ?, dex = ?, con = ?, int = ?, wis = ?, cha = ?,
          pending_ability_points = ? WHERE id = ?`).run(
          c.level, c.hp, c.maxHp, c.scores.STR, c.scores.DEX, c.scores.CON, c.scores.INT, c.scores.WIS, c.scores.CHA,
          c.pendingAbilityPoints, c.id,
        );
        db.prepare("DELETE FROM items WHERE character_id = ?").run(c.id);
        for (const it of c.items) insertItem.run(c.id, it.name, it.description, it.qty);
      })();
    },
    appendEvent(campaignId, round, event) {
      const info = db.prepare("INSERT INTO events (campaign_id, round_number, type, payload_json) VALUES (?, ?, ?, ?)")
        .run(campaignId, round, event.type, JSON.stringify(event));
      const row = db.prepare<[number], EventRow>("SELECT * FROM events WHERE id = ?").get(Number(info.lastInsertRowid))!;
      return toEvent(row);
    },
    getEvents(campaignId, q = {}) {
      const where = ["campaign_id = @campaignId"];
      if (q.fromRound !== undefined) where.push("round_number >= @fromRound");
      if (q.toRound !== undefined) where.push("round_number <= @toRound");
      let sql = `SELECT * FROM events WHERE ${where.join(" AND ")}`;
      sql = q.limit !== undefined
        ? `SELECT * FROM (${sql} ORDER BY id DESC LIMIT @limit) ORDER BY id`
        : `${sql} ORDER BY id`;
      return db.prepare<[object], EventRow>(sql).all({ campaignId, ...q }).map(toEvent);
    },
    transaction(fn) {
      return db.transaction(fn)();
    },
    close() {
      if (!closed) { closed = true; db.close(); }
    },
  };
  return store;
}
```

better-sqlite3 transactions nest as savepoints, so `saveCharacter` and `createCharacter` work inside `store.transaction`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/store`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: SQLite store for campaigns, characters, items and events"
```

---

### Task 5: Auth (LAN filter, password, cookie, rate limit)

**Files:**
- Create: `src/server/auth/lan.ts`, `src/server/auth/password.ts`, `src/server/auth/plugin.ts`
- Test: `tests/server/auth/lan.test.ts`, `tests/server/auth/password.test.ts`, `tests/server/auth/plugin.test.ts`

**Interfaces:**
- Produces: `isPrivateAddress(ip: string): boolean`; `passwordMatches(input: string, expected: string): boolean`; `cookieSecret(password: string): string`; `class LoginRateLimiter { constructor(max?: number, windowMs?: number, now?: () => number); isBlocked(ip): boolean; recordFailure(ip): void; reset(ip): void }`; `registerAuth(app: FastifyInstance, opts: { password: string }): Promise<void>`; cookie name `table`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/server/auth/lan.test.ts
import { describe, expect, it } from "vitest";
import { isPrivateAddress } from "../../../src/server/auth/lan";

describe("isPrivateAddress", () => {
  it.each([
    "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.20", "169.254.3.4",
    "::1", "::ffff:192.168.1.5", "fd12:3456::1", "fe80::1", "fe80::1%en0",
  ])("allows %s", (ip) => expect(isPrivateAddress(ip)).toBe(true));

  it.each(["8.8.8.8", "172.32.0.1", "172.15.0.1", "192.169.0.1", "2001:4860::8888", "::ffff:8.8.8.8", "", "not-an-ip"])(
    "blocks %s", (ip) => expect(isPrivateAddress(ip)).toBe(false),
  );
});
```

```ts
// tests/server/auth/password.test.ts
import { describe, expect, it } from "vitest";
import { cookieSecret, LoginRateLimiter, passwordMatches } from "../../../src/server/auth/password";

describe("password", () => {
  it("matches exactly", () => {
    expect(passwordMatches("dragon", "dragon")).toBe(true);
    expect(passwordMatches("Dragon", "dragon")).toBe(false);
    expect(passwordMatches("", "dragon")).toBe(false);
    expect(passwordMatches("a much longer guess", "dragon")).toBe(false);
  });
  it("derives a stable secret that changes with the password", () => {
    expect(cookieSecret("a")).toBe(cookieSecret("a"));
    expect(cookieSecret("a")).not.toBe(cookieSecret("b"));
    expect(cookieSecret("a").length).toBeGreaterThanOrEqual(32);
  });
});

describe("LoginRateLimiter", () => {
  it("blocks after max failures within the window, then forgets", () => {
    let t = 0;
    const rl = new LoginRateLimiter(3, 1000, () => t);
    for (let i = 0; i < 3; i++) rl.recordFailure("1.1.1.1");
    expect(rl.isBlocked("1.1.1.1")).toBe(true);
    expect(rl.isBlocked("2.2.2.2")).toBe(false);
    t = 1001;
    expect(rl.isBlocked("1.1.1.1")).toBe(false);
  });
  it("reset clears an IP", () => {
    const rl = new LoginRateLimiter(1, 1000, () => 0);
    rl.recordFailure("x");
    rl.reset("x");
    expect(rl.isBlocked("x")).toBe(false);
  });
});
```

```ts
// tests/server/auth/plugin.test.ts
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { registerAuth } from "../../../src/server/auth/plugin";

async function app() {
  const a = Fastify();
  await registerAuth(a, { password: "dragon" });
  a.get("/api/secret", async () => ({ ok: true }));
  a.get("/", async () => "page");
  return a;
}
const LAN = "192.168.1.10";

describe("auth plugin", () => {
  it("blocks non-LAN addresses everywhere", async () => {
    const a = await app();
    const r = await a.inject({ method: "GET", url: "/", remoteAddress: "8.8.8.8" });
    expect(r.statusCode).toBe(403);
  });

  it("serves non-API pages on the LAN without login", async () => {
    const a = await app();
    expect((await a.inject({ method: "GET", url: "/", remoteAddress: LAN })).statusCode).toBe(200);
  });

  it("requires the cookie for API routes", async () => {
    const a = await app();
    expect((await a.inject({ method: "GET", url: "/api/secret", remoteAddress: LAN })).statusCode).toBe(401);
    expect((await a.inject({ method: "GET", url: "/api/session", remoteAddress: LAN })).json()).toEqual({ authed: false });
  });

  it("logs in with the right password and remembers the device", async () => {
    const a = await app();
    const bad = await a.inject({ method: "POST", url: "/api/login", remoteAddress: LAN, payload: { password: "nope" } });
    expect(bad.statusCode).toBe(401);
    expect(bad.json().error).toMatch(/not the password/);

    const ok = await a.inject({ method: "POST", url: "/api/login", remoteAddress: LAN, payload: { password: "dragon" } });
    expect(ok.statusCode).toBe(200);
    const cookie = ok.cookies.find((c) => c.name === "table")!;
    expect(cookie.httpOnly).toBe(true);
    const headers = { cookie: `table=${cookie.value}` };
    expect((await a.inject({ method: "GET", url: "/api/secret", remoteAddress: LAN, headers })).json()).toEqual({ ok: true });
    expect((await a.inject({ method: "GET", url: "/api/session", remoteAddress: LAN, headers })).json()).toEqual({ authed: true });
  });

  it("rejects a forged cookie", async () => {
    const a = await app();
    const r = await a.inject({ method: "GET", url: "/api/secret", remoteAddress: LAN, headers: { cookie: "table=ok" } });
    expect(r.statusCode).toBe(401);
  });

  it("rate-limits repeated failures", async () => {
    const a = await app();
    for (let i = 0; i < 10; i++) await a.inject({ method: "POST", url: "/api/login", remoteAddress: LAN, payload: { password: "x" } });
    const r = await a.inject({ method: "POST", url: "/api/login", remoteAddress: LAN, payload: { password: "dragon" } });
    expect(r.statusCode).toBe(429);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/server/auth`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

```ts
// src/server/auth/lan.ts
import { isIPv4, isIPv6 } from "node:net";

export function isPrivateAddress(ip: string): boolean {
  let addr = ip.trim().toLowerCase().split("%")[0];
  if (addr.startsWith("::ffff:") && isIPv4(addr.slice(7))) addr = addr.slice(7);
  if (isIPv4(addr)) {
    const [a, b] = addr.split(".").map(Number);
    return a === 127 || a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (isIPv6(addr)) {
    if (addr === "::1") return true;
    const first = parseInt(addr.split(":")[0] || "0", 16);
    return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80;
  }
  return false;
}
```

```ts
// src/server/auth/password.ts
import { createHash, timingSafeEqual } from "node:crypto";

const sha256 = (s: string) => createHash("sha256").update(s).digest();

export function passwordMatches(input: string, expected: string): boolean {
  return timingSafeEqual(sha256(input), sha256(expected));
}

/** Changing TABLE_PASSWORD changes the secret, which signs every device out. */
export function cookieSecret(password: string): string {
  return sha256(`ai-dungeon-master:cookie:${password}`).toString("hex");
}

export class LoginRateLimiter {
  private failures = new Map<string, number[]>();
  constructor(private max = 10, private windowMs = 10 * 60_000, private now: () => number = Date.now) {}

  private recent(ip: string): number[] {
    const cutoff = this.now() - this.windowMs;
    const list = (this.failures.get(ip) ?? []).filter((t) => t > cutoff);
    this.failures.set(ip, list);
    return list;
  }
  isBlocked(ip: string): boolean { return this.recent(ip).length >= this.max; }
  recordFailure(ip: string): void { this.recent(ip).push(this.now()); }
  reset(ip: string): void { this.failures.delete(ip); }
}
```

```ts
// src/server/auth/plugin.ts
import cookie from "@fastify/cookie";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { isPrivateAddress } from "./lan";
import { cookieSecret, LoginRateLimiter, passwordMatches } from "./password";

const COOKIE = "table";
const OPEN_PATHS = new Set(["/api/login", "/api/session"]);

export async function registerAuth(app: FastifyInstance, opts: { password: string }): Promise<void> {
  await app.register(cookie, { secret: cookieSecret(opts.password) });
  const limiter = new LoginRateLimiter();

  const isAuthed = (req: FastifyRequest) => {
    const raw = req.cookies[COOKIE];
    if (!raw) return false;
    const unsigned = req.unsignCookie(raw);
    return unsigned.valid && unsigned.value === "ok";
  };

  app.addHook("onRequest", async (req, reply) => {
    if (!isPrivateAddress(req.ip)) {
      return reply.code(403).send({ error: "This table is only open on the home network." });
    }
    const path = req.url.split("?")[0];
    const needsAuth = (path.startsWith("/api/") && !OPEN_PATHS.has(path)) || path === "/ws";
    if (needsAuth && !isAuthed(req)) {
      return reply.code(401).send({ error: "Enter the table password." });
    }
  });

  app.get("/api/session", async (req) => ({ authed: isAuthed(req) }));

  app.post<{ Body: { password?: unknown } }>("/api/login", async (req, reply) => {
    if (limiter.isBlocked(req.ip)) {
      return reply.code(429).send({ error: "Too many wrong guesses. Try again in a few minutes." });
    }
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    if (!passwordMatches(password, opts.password)) {
      limiter.recordFailure(req.ip);
      return reply.code(401).send({ error: "That's not the password." });
    }
    limiter.reset(req.ip);
    reply.setCookie(COOKIE, "ok", { signed: true, httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
    return { ok: true };
  });
}
```

`registerAuth` adds a hook to the root instance; do **not** wrap it in `app.register()`, or the hook would be encapsulated and stop applying to other routes.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/auth`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: LAN-only filter, table password and signed session cookie"
```

---

### Task 6: Ollama client and streaming narration extractor

**Files:**
- Create: `src/server/dm/ollama.ts`, `src/server/dm/narrationStream.ts`
- Test: `tests/server/dm/ollama.test.ts`, `tests/server/dm/narrationStream.test.ts`

**Interfaces:**
- Produces:
  - `interface ChatMessage { role: "system" | "user" | "assistant"; content: string }`
  - `interface ChatRequest { messages: ChatMessage[]; format: object; onToken?: (t: string) => void; timeoutMs?: number }`
  - `interface ChatClient { chat(req: ChatRequest): Promise<string>; unload(): Promise<void> }`
  - `class OllamaError extends Error`
  - `createOllamaClient(opts: { url: string; model: string; keepAlive: string; fetchImpl?: typeof fetch }): ChatClient`
  - `class NarrationExtractor { push(chunk: string): string }`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/server/dm/narrationStream.test.ts
import { describe, expect, it } from "vitest";
import { NarrationExtractor } from "../../../src/server/dm/narrationStream";

function feed(chunks: string[]): string {
  const x = new NarrationExtractor();
  return chunks.map((c) => x.push(c)).join("");
}

describe("NarrationExtractor", () => {
  const json = JSON.stringify({ narration: 'The bell tolls.\n"Who rings it?" she asks — ☃ 😀', changes: [{ op: "set_scene", title: "x" }] });
  const expected = 'The bell tolls.\n"Who rings it?" she asks — ☃ 😀';

  it("extracts the narration from a whole document", () => {
    expect(feed([json])).toBe(expected);
  });

  it("gives the same result however the stream is split", () => {
    for (let i = 1; i < json.length; i++) {
      expect(feed([json.slice(0, i), json.slice(i)])).toBe(expected);
    }
    expect(feed([...json])).toBe(expected);
  });

  it("decodes \\u escapes, including surrogate pairs", () => {
    const raw = '{"narration": "snow\\u2603 smile\\ud83d\\ude00"}';
    expect(feed([...raw])).toBe("snow☃ smile😀");
  });

  it("ignores everything after the closing quote", () => {
    expect(feed(['{ "narration" : "Hi", "changes": [{"name":"narration"}]}'])).toBe("Hi");
  });

  it("returns nothing when there is no narration key", () => {
    expect(feed(['{"checks": []}'])).toBe("");
  });
});
```

```ts
// tests/server/dm/ollama.test.ts
import { describe, expect, it } from "vitest";
import { createOllamaClient, OllamaError } from "../../../src/server/dm/ollama";

function streamResponse(parts: string[], status = 200): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) { for (const p of parts) c.enqueue(enc.encode(p)); c.close(); },
  });
  return new Response(body, { status });
}

describe("ollama client", () => {
  it("posts a streaming chat with format, keep_alive and think:false, and joins tokens", async () => {
    const calls: { url: string; body: any }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return streamResponse([
        '{"message":{"content":"{\\"narr"}}\n{"message":{"con',
        'tent":"ation\\": \\"Hi\\"}"}}\n',
        '{"done":true}\n',
      ]);
    }) as typeof fetch;
    const tokens: string[] = [];
    const client = createOllamaClient({ url: "http://ollama:11434", model: "qwen", keepAlive: "30m", fetchImpl });
    const out = await client.chat({ messages: [{ role: "user", content: "go" }], format: { type: "object" }, onToken: (t) => tokens.push(t) });
    expect(out).toBe('{"narration": "Hi"}');
    expect(tokens.join("")).toBe(out);
    expect(calls[0].url).toBe("http://ollama:11434/api/chat");
    expect(calls[0].body).toMatchObject({ model: "qwen", stream: true, think: false, keep_alive: "30m", format: { type: "object" } });
  });

  it("wraps network failures in OllamaError", async () => {
    const fetchImpl = (async () => { throw new TypeError("fetch failed"); }) as typeof fetch;
    const client = createOllamaClient({ url: "http://x", model: "m", keepAlive: "30m", fetchImpl });
    await expect(client.chat({ messages: [], format: {} })).rejects.toThrow(OllamaError);
    await expect(client.chat({ messages: [], format: {} })).rejects.toThrow(/Could not reach Ollama at http:\/\/x/);
  });

  it("reports HTTP errors and in-stream errors", async () => {
    const http = createOllamaClient({ url: "http://x", model: "m", keepAlive: "30m", fetchImpl: (async () => new Response("model not found", { status: 404 })) as typeof fetch });
    await expect(http.chat({ messages: [], format: {} })).rejects.toThrow(/404.*model not found/);
    const inStream = createOllamaClient({ url: "http://x", model: "m", keepAlive: "30m", fetchImpl: (async () => streamResponse(['{"error":"out of memory"}\n'])) as typeof fetch });
    await expect(inStream.chat({ messages: [], format: {} })).rejects.toThrow(/out of memory/);
  });

  it("times out", async () => {
    const fetchImpl = ((_u: string, init: RequestInit) => new Promise((_, reject) => {
      init.signal!.addEventListener("abort", () => reject(init.signal!.reason));
    })) as typeof fetch;
    const client = createOllamaClient({ url: "http://x", model: "m", keepAlive: "30m", fetchImpl });
    await expect(client.chat({ messages: [], format: {}, timeoutMs: 20 })).rejects.toThrow(OllamaError);
  });

  it("unload sends keep_alive 0 for the model", async () => {
    const calls: { url: string; body: any }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ done: true, done_reason: "unload" }));
    }) as typeof fetch;
    await createOllamaClient({ url: "http://x", model: "qwen", keepAlive: "30m", fetchImpl }).unload();
    expect(calls).toEqual([{ url: "http://x/api/generate", body: { model: "qwen", keep_alive: 0, stream: false } }]);
  });

  it("unload reports an unreachable Ollama", async () => {
    const fetchImpl = (async () => { throw new TypeError("fetch failed"); }) as typeof fetch;
    await expect(createOllamaClient({ url: "http://x", model: "m", keepAlive: "30m", fetchImpl }).unload()).rejects.toThrow(OllamaError);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/server/dm`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement**

```ts
// src/server/dm/narrationStream.ts
/**
 * Pulls the value of the top-level "narration" string out of a JSON document
 * as it streams in, so players see the story appear word by word.
 */
export class NarrationExtractor {
  private mode: "seek" | "in" | "done" = "seek";
  private seekBuf = "";
  private escape = false;
  private unicode: string | null = null;

  push(chunk: string): string {
    if (this.mode === "done") return "";
    let text = chunk;
    if (this.mode === "seek") {
      this.seekBuf += chunk;
      const m = /"narration"\s*:\s*"/.exec(this.seekBuf);
      if (!m) {
        this.seekBuf = this.seekBuf.slice(-32); // enough to hold a split key
        return "";
      }
      text = this.seekBuf.slice(m.index + m[0].length);
      this.seekBuf = "";
      this.mode = "in";
    }
    let out = "";
    for (const ch of text) {
      if (this.unicode !== null) {
        this.unicode += ch;
        if (this.unicode.length === 4) {
          out += String.fromCharCode(parseInt(this.unicode, 16));
          this.unicode = null;
        }
      } else if (this.escape) {
        this.escape = false;
        if (ch === "u") this.unicode = "";
        else out += ({ n: "\n", t: "\t", r: "", b: "", f: "" } as Record<string, string>)[ch] ?? ch;
      } else if (ch === "\\") {
        this.escape = true;
      } else if (ch === '"') {
        this.mode = "done";
        break;
      } else {
        out += ch;
      }
    }
    return out;
  }
}
```

Note: `for (const ch of text)` iterates by code point, so a raw (unescaped) emoji is emitted whole. `\uXXXX` surrogate halves are emitted as separate UTF-16 units, which join correctly when concatenated.

```ts
// src/server/dm/ollama.ts
export interface ChatMessage { role: "system" | "user" | "assistant"; content: string }
export interface ChatRequest { messages: ChatMessage[]; format: object; onToken?: (t: string) => void; timeoutMs?: number }
export interface ChatClient {
  chat(req: ChatRequest): Promise<string>;
  /** Ask Ollama to drop the model from memory now (keep_alive: 0). */
  unload(): Promise<void>;
}

export class OllamaError extends Error {}

export function createOllamaClient(opts: { url: string; model: string; keepAlive: string; fetchImpl?: typeof fetch }): ChatClient {
  const fetchImpl = opts.fetchImpl ?? fetch;

  async function post(path: string, body: object, signal?: AbortSignal): Promise<Response> {
    let res: Response;
    try {
      res = await fetchImpl(`${opts.url}${path}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal,
      });
    } catch (e) {
      throw new OllamaError(`Could not reach Ollama at ${opts.url}: ${(e as Error).message}`);
    }
    if (!res.ok) throw new OllamaError(`Ollama returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res;
  }

  return {
    async chat({ messages, format, onToken, timeoutMs = 90_000 }) {
      try {
        const res = await post("/api/chat", {
          model: opts.model, messages, format, stream: true, think: false, keep_alive: opts.keepAlive,
          options: { temperature: 0.8 },
        }, AbortSignal.timeout(timeoutMs));
        if (!res.body) throw new OllamaError("Ollama sent an empty response");
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buf = "";
        let out = "";
        const handle = (line: string) => {
          if (!line.trim()) return;
          const msg = JSON.parse(line) as { error?: string; message?: { content?: string } };
          if (msg.error) throw new OllamaError(`Ollama error: ${msg.error}`);
          const tok = msg.message?.content ?? "";
          if (tok) { out += tok; onToken?.(tok); }
        };
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += value;
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            handle(buf.slice(0, nl));
            buf = buf.slice(nl + 1);
          }
        }
        handle(buf);
        return out;
      } catch (e) {
        if (e instanceof OllamaError) throw e;
        throw new OllamaError(`Ollama request failed: ${(e as Error).message}`);
      }
    },

    async unload() {
      await post("/api/generate", { model: opts.model, keep_alive: 0, stream: false }, AbortSignal.timeout(15_000));
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/dm`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: streaming Ollama client with unload and narration extractor"
```

---

### Task 7: DM schemas, context and prompts

**Files:**
- Create: `src/server/dm/schemas.ts`, `src/server/dm/context.ts`, `src/server/dm/prompts.ts`
- Test: `tests/server/dm/context.test.ts`, `tests/server/dm/prompts.test.ts`

**Interfaces:**
- Consumes: `Store` (Task 4), `RulesEngine` (Task 3), `ChatMessage` (Task 6), `formatModifier`, `modifier`.
- Produces:
  - `AdjudicateSchema`, `resolveFormatSchema(rules)`, `ResolveParseSchema`, `KitSchema`, `SummarySchema`, `toFormat(schema): object`
  - `interface RoundTranscript { round: number; lines: string[] }`
  - `interface DmContext { campaign: Campaign; characters: Character[]; recentRounds: RoundTranscript[] }`
  - `transcriptFromEvents(events: StoredEvent[], characters: Character[]): RoundTranscript[]`
  - `buildContext(store: Store, campaignId: number, rounds?: number): DmContext`
  - `interface ActionInput { character: string; text: string }`
  - `interface RollInput { character: string; ability: Ability; die: number; modifier: number; total: number; dc: number; success: boolean; crit: Crit; reason: string }`
  - `interface ResolveInput { actions: ActionInput[]; skipped: string[]; rolls: RollInput[] }`
  - `estimateTokens(s)`, `systemPrompt(rules)`, `campaignBlock(c)`, `partyBlock(chars)`, `adjudicateTask(actions)`, `resolveTask(input)`, `openingTask()`, `kitMessages(input)`, `summaryMessages(old, rounds)`, `buildMessages(ctx, rules, task, budgetTokens): ChatMessage[]`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/server/dm/context.test.ts
import { describe, expect, it } from "vitest";
import { buildContext, transcriptFromEvents } from "../../../src/server/dm/context";
import { createStore } from "../../../src/server/store/store";

const scores = { STR: 15, DEX: 10, CON: 10, INT: 8, WIS: 12, CHA: 8 };

describe("transcripts", () => {
  it("renders actions, skips, rolls and narration per round", () => {
    const store = createStore(":memory:");
    const c = store.createCampaign({ title: "T", mode: "party", setting: "S", pitch: "", outline: null });
    const corvin = store.createCharacter({ campaignId: c.id, name: "Corvin", concept: "knight", scores, hp: 20, maxHp: 20, items: [] });
    const wren = store.createCharacter({ campaignId: c.id, name: "Wren", concept: "scout", scores, hp: 20, maxHp: 20, items: [] });
    store.appendEvent(c.id, 0, { type: "narration", text: "Fog rolls in." });
    store.appendEvent(c.id, 1, { type: "action", characterId: corvin.id, text: "I kick the door" });
    store.appendEvent(c.id, 1, { type: "skip", characterId: wren.id, skippedBy: corvin.id });
    store.appendEvent(c.id, 1, { type: "check_request", characterId: corvin.id, ability: "STR", dc: 14, reason: "heavy door" });
    store.appendEvent(c.id, 1, { type: "roll", characterId: corvin.id, ability: "STR", die: 20, dc: 14, modifier: 2, total: 22, success: true, crit: "nat20" });
    store.appendEvent(c.id, 1, { type: "narration", text: "It bursts open." });

    const t = transcriptFromEvents(store.getEvents(c.id), store.getCharacters(c.id));
    expect(t).toEqual([
      { round: 0, lines: ["DM: Fog rolls in."] },
      { round: 1, lines: [
        "Corvin: I kick the door",
        "Wren holds back this round.",
        "[Roll] Corvin STR check: 20 +2 = 22 vs DC 14 (heavy door): success (natural 20)",
        "DM: It bursts open.",
      ] },
    ]);
  });

  it("buildContext includes only completed rounds within the window", () => {
    const store = createStore(":memory:");
    const c = store.createCampaign({ title: "T", mode: "solo", setting: "S", pitch: "", outline: null });
    for (let r = 0; r <= 14; r++) store.appendEvent(c.id, r, { type: "narration", text: `round ${r}` });
    store.updateCampaign(c.id, { roundNumber: 14 });
    const ctx = buildContext(store, c.id, 10);
    expect(ctx.recentRounds.map((r) => r.round)).toEqual([4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(ctx.campaign.id).toBe(c.id);
  });
});
```

```ts
// tests/server/dm/prompts.test.ts
import { describe, expect, it } from "vitest";
import type { DmContext } from "../../../src/server/dm/context";
import { adjudicateTask, buildMessages, estimateTokens, partyBlock, resolveTask } from "../../../src/server/dm/prompts";
import { toFormat, resolveFormatSchema, AdjudicateSchema } from "../../../src/server/dm/schemas";
import { lightRules } from "../../../src/server/rules/engine";
import type { Campaign, Character } from "../../../src/shared/types";

const campaign: Campaign = {
  id: 1, title: "The Drowned Chapel", mode: "party", setting: "Gothic fantasy", pitch: "A bell rings at night",
  outline: { id: "dc", title: "The Drowned Chapel", setting: "Gothic", pitch: "p", goal: "Silence the bell", villain: "Sister Ambrel", locations: ["Nave"], beats: ["Arrive"] },
  sceneTitle: "Fenwick", summary: "The party arrived in Fenwick.", roundState: "collecting", roundNumber: 3, stalledPhase: null, createdAt: "", updatedAt: "",
};
const corvin: Character = {
  id: 1, campaignId: 1, name: "Corvin", concept: "disgraced knight", level: 2, hp: 0, maxHp: 25,
  scores: { STR: 15, DEX: 10, CON: 10, INT: 8, WIS: 12, CHA: 8 }, pendingAbilityPoints: 0,
  items: [{ name: "Rope", description: "30ft", qty: 2 }],
};

describe("prompts", () => {
  it("party block shows sheet facts from the database", () => {
    const text = partyBlock([corvin]);
    expect(text).toContain("Corvin (disgraced knight)");
    expect(text).toContain("Level 2");
    expect(text).toContain("HP 0/25");
    expect(text).toContain("STR 15 (+2)");
    expect(text).toContain("Rope ×2");
    expect(text).toContain("DOWNED");
  });

  it("tasks list actions, skips and rolls", () => {
    expect(adjudicateTask([{ character: "Corvin", text: "I climb" }])).toContain("- Corvin: I climb");
    const r = resolveTask({
      actions: [{ character: "Corvin", text: "I climb" }], skipped: ["Wren"],
      rolls: [{ character: "Corvin", ability: "DEX", die: 3, modifier: 0, total: 3, dc: 12, success: false, crit: null, reason: "slick wall" }],
    });
    expect(r).toContain("Wren");
    expect(r).toContain("Corvin DEX check: 3 +0 = 3 vs DC 12 (slick wall): FAILURE");
  });

  it("buildMessages includes outline, summary and recent rounds", () => {
    const ctx: DmContext = { campaign, characters: [corvin], recentRounds: [{ round: 2, lines: ["DM: older"] }] };
    const [system, user] = buildMessages(ctx, lightRules, "TASK", 12000);
    expect(system.role).toBe("system");
    expect(system.content).toContain("Never invent dice results");
    expect(user.content).toContain("Silence the bell");
    expect(user.content).toContain("The party arrived in Fenwick.");
    expect(user.content).toContain("DM: older");
    expect(user.content.endsWith("TASK")).toBe(true);
  });

  it("drops the oldest rounds first to fit the budget", () => {
    const big = "x".repeat(4000);
    const ctx: DmContext = {
      campaign, characters: [corvin],
      recentRounds: Array.from({ length: 10 }, (_, i) => ({ round: i, lines: [`DM: r${i} ${big}`] })),
    };
    const msgs = buildMessages(ctx, lightRules, "TASK", 6000);
    const total = estimateTokens(msgs.map((m) => m.content).join(""));
    expect(total).toBeLessThanOrEqual(6000);
    expect(msgs[1].content).toContain("r9 ");
    expect(msgs[1].content).not.toContain("r0 ");
  });

  it("produces JSON schemas for Ollama's format field", () => {
    const adj = toFormat(AdjudicateSchema) as any;
    expect(adj.type).toBe("object");
    expect(adj.properties.checks.type).toBe("array");
    const res = toFormat(resolveFormatSchema(lightRules)) as any;
    expect(Object.keys(res.properties)).toEqual(["narration", "changes"]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/server/dm/context.test.ts tests/server/dm/prompts.test.ts`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement `schemas.ts`**

```ts
// src/server/dm/schemas.ts
import { z } from "zod";
import { ABILITIES } from "../../shared/types";
import type { RulesEngine } from "../rules/engine";

export const AdjudicateSchema = z.object({
  checks: z.array(z.object({
    character: z.string(),
    ability: z.enum(ABILITIES),
    dc: z.number(),
    reason: z.string(),
  })),
});
export type CheckDraft = z.infer<typeof AdjudicateSchema>["checks"][number];

/** Shape we ask Ollama for: narration first so it can stream. */
export const resolveFormatSchema = (rules: RulesEngine) =>
  z.object({ narration: z.string(), changes: z.array(rules.opSchema) });

/** Shape we accept: ops are validated one by one by the rules engine, so a bad op can't sink the round. */
export const ResolveParseSchema = z.object({
  narration: z.string().trim().min(1),
  changes: z.array(z.unknown()).default([]),
});
export type ResolveOutput = z.infer<typeof ResolveParseSchema>;

export const KitSchema = z.object({
  items: z.array(z.object({
    name: z.string().trim().min(1).max(60),
    description: z.string().trim().max(200),
  })).min(1),
});

export const SummarySchema = z.object({ summary: z.string().trim().min(1) });

export const toFormat = (schema: z.ZodType): object => z.toJSONSchema(schema, { io: "input" });
```

- [ ] **Step 4: Implement `context.ts`**

```ts
// src/server/dm/context.ts
import { formatModifier } from "../../shared/abilities";
import type { Campaign, Character, StoredEvent } from "../../shared/types";
import type { Store } from "../store/store";

export interface RoundTranscript { round: number; lines: string[] }
export interface DmContext { campaign: Campaign; characters: Character[]; recentRounds: RoundTranscript[] }

export function transcriptFromEvents(events: StoredEvent[], characters: Character[]): RoundTranscript[] {
  const name = (id: number) => characters.find((c) => c.id === id)?.name ?? "Someone";
  const rounds = new Map<number, string[]>();
  const reasons = new Map<string, string>();
  for (const e of events) {
    const lines = rounds.get(e.round) ?? [];
    switch (e.type) {
      case "action": lines.push(`${name(e.characterId)}: ${e.text}`); break;
      case "skip": lines.push(`${name(e.characterId)} holds back this round.`); break;
      case "check_request": reasons.set(`${e.round}:${e.characterId}`, e.reason); break;
      case "roll": {
        const reason = reasons.get(`${e.round}:${e.characterId}`);
        const crit = e.crit === "nat20" ? " (natural 20)" : e.crit === "nat1" ? " (natural 1)" : "";
        lines.push(`[Roll] ${name(e.characterId)} ${e.ability} check: ${e.die} ${formatModifier(e.modifier)} = ${e.total} vs DC ${e.dc}${reason ? ` (${reason})` : ""}: ${e.success ? "success" : "failure"}${crit}`);
        break;
      }
      case "narration": lines.push(`DM: ${e.text}`); break;
      default: continue;
    }
    rounds.set(e.round, lines);
  }
  return [...rounds.entries()].sort(([a], [b]) => a - b).map(([round, lines]) => ({ round, lines }));
}

export function buildContext(store: Store, campaignId: number, rounds = 10): DmContext {
  const campaign = store.getCampaign(campaignId);
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);
  const characters = store.getCharacters(campaignId);
  const events = campaign.roundNumber === 0 ? [] : store.getEvents(campaignId, {
    fromRound: Math.max(0, campaign.roundNumber - rounds),
    toRound: campaign.roundNumber - 1,
  });
  return { campaign, characters, recentRounds: transcriptFromEvents(events, characters) };
}
```

- [ ] **Step 5: Implement `prompts.ts`**

```ts
// src/server/dm/prompts.ts
import { formatModifier, modifier } from "../../shared/abilities";
import { ABILITIES, type Ability, type Campaign, type Character, type Crit } from "../../shared/types";
import type { RulesEngine } from "../rules/engine";
import type { DmContext, RoundTranscript } from "./context";
import type { ChatMessage } from "./ollama";

export interface ActionInput { character: string; text: string }
export interface RollInput {
  character: string; ability: Ability; die: number; modifier: number; total: number;
  dc: number; success: boolean; crit: Crit; reason: string;
}
export interface ResolveInput { actions: ActionInput[]; skipped: string[]; rolls: RollInput[] }

export const estimateTokens = (s: string) => Math.ceil(s.length / 4);

export function systemPrompt(rules: RulesEngine): string {
  return [
    "You are the Dungeon Master for a tabletop roleplaying game played by friends at home.",
    "",
    "Storytelling:",
    "- Narrate vividly but concisely: 1-3 short paragraphs per round.",
    "- Give every character who acted a moment in the spotlight.",
    "- Never decide what player characters say, think or choose. Describe the world and how it reacts, then invite the players to act.",
    "- Keep the story moving toward the campaign's goal, with danger, mystery and some humour.",
    "",
    "Fairness:",
    "- The game app rolls all dice. Never invent dice results. A failed check fails; a successful one succeeds.",
    "",
    "Rules:",
    rules.rulesSummary,
    "",
    "Changing character sheets:",
    '- You cannot edit sheets directly. List every change in "changes" using only these ops:',
    rules.opsGuide,
    "- Use characters' exact names. Only remove items a character actually has (see the party sheet).",
    "- Award items and level_up sparingly; level_up only after a major victory or milestone.",
    "",
    "Always reply with a single JSON object and nothing else.",
  ].join("\n");
}

export function campaignBlock(c: Campaign): string {
  const lines = [`Campaign: ${c.title}`, `Setting: ${c.setting}`];
  if (c.pitch) lines.push(`Pitch: ${c.pitch}`);
  if (c.outline) {
    lines.push(
      "Adventure outline (steer toward this, improvise within it):",
      `- Goal: ${c.outline.goal}`,
      `- Villain: ${c.outline.villain}`,
      `- Locations: ${c.outline.locations.join("; ")}`,
      `- Story beats: ${c.outline.beats.join(" → ")}`,
    );
  }
  if (c.sceneTitle) lines.push(`Current scene: ${c.sceneTitle}`);
  return lines.join("\n");
}

export function partyBlock(chars: Character[]): string {
  const lines = chars.map((c) => {
    const abilities = ABILITIES.map((a) => `${a} ${c.scores[a]} (${formatModifier(modifier(c.scores[a]))})`).join(", ");
    const items = c.items.length ? c.items.map((i) => `${i.name}${i.qty > 1 ? ` ×${i.qty}` : ""}`).join(", ") : "nothing";
    return `- ${c.name} (${c.concept}): Level ${c.level}, HP ${c.hp}/${c.maxHp}${c.hp <= 0 ? " [DOWNED]" : ""}. ${abilities}. Carrying: ${items}.`;
  });
  return ["Party (authoritative character sheets):", ...lines].join("\n");
}

export function adjudicateTask(actions: ActionInput[]): string {
  return [
    "This round the players declared:",
    ...actions.map((a) => `- ${a.character}: ${a.text}`),
    "",
    "Decide which of these actions are risky or uncertain enough to need an ability check. Ordinary actions need no check.",
    "At most one check per character, and only for characters listed above. Choose the most fitting ability (STR, DEX, CON, INT, WIS, CHA).",
    "DC guide: 10 easy, 15 moderate, 20 hard, 25 nearly impossible.",
    'Reply as JSON: {"checks": [{"character": "<name>", "ability": "DEX", "dc": 15, "reason": "<short reason>"}]}. Use an empty list if no checks are needed. Do not narrate yet.',
  ].join("\n");
}

export function resolveTask(input: ResolveInput): string {
  const lines = ["This round:", ...input.actions.map((a) => `- ${a.character}: ${a.text}`)];
  if (input.skipped.length) lines.push(`(${input.skipped.join(", ")} did not act this round; keep them in the scene but passive.)`);
  if (input.rolls.length) {
    lines.push("", "Dice results (final, do not change them):");
    for (const r of input.rolls) {
      const crit = r.crit === "nat20" ? " (natural 20: make it spectacular)" : r.crit === "nat1" ? " (natural 1: make it go memorably wrong)" : "";
      lines.push(`- ${r.character} ${r.ability} check: ${r.die} ${formatModifier(r.modifier)} = ${r.total} vs DC ${r.dc} (${r.reason}): ${r.success ? "SUCCESS" : "FAILURE"}${crit}`);
    }
  }
  lines.push(
    "",
    "Narrate what happens, honouring every result. End by inviting the players to act.",
    'Reply as JSON: {"narration": "<story text>", "changes": [<ops>]}. Use an empty changes list if nothing on the sheets changes.',
  );
  return lines.join("\n");
}

export function openingTask(): string {
  return [
    "Begin the adventure. Introduce the party in the opening scene in 2-4 short paragraphs and end with a clear prompt for them to act.",
    "Include a set_scene op naming the opening location. Do not add items: the characters already have their starting kits.",
    'Reply as JSON: {"narration": "<story text>", "changes": [<ops>]}.',
  ].join("\n");
}

export function kitMessages(input: { name: string; concept: string; setting: string }): ChatMessage[] {
  return [
    { role: "system", content: "You help players equip new characters for a tabletop roleplaying game. Always reply with a single JSON object and nothing else." },
    {
      role: "user",
      content: [
        `Setting: ${input.setting}`,
        `Character: ${input.name}, ${input.concept}`,
        "Suggest 3 to 5 practical, flavourful starting items that fit this character. Keep them modest: no powerful magic.",
        'Reply as JSON: {"items": [{"name": "<short item name>", "description": "<one short sentence>"}]}.',
      ].join("\n"),
    },
  ];
}

export function summaryMessages(oldSummary: string, rounds: RoundTranscript[]): ChatMessage[] {
  return [
    { role: "system", content: "You keep the story-so-far notes for a tabletop roleplaying campaign. Always reply with a single JSON object and nothing else." },
    {
      role: "user",
      content: [
        `Story so far:\n${oldSummary || "(nothing yet)"}`,
        "",
        `New events:\n${rounds.map((r) => r.lines.join("\n")).join("\n\n")}`,
        "",
        "Rewrite the story-so-far in at most 300 words. Keep names, places, unresolved threads, promises, debts and important items.",
        'Reply as JSON: {"summary": "<text>"}.',
      ].join("\n"),
    },
  ];
}

export function buildMessages(ctx: DmContext, rules: RulesEngine, task: string, budgetTokens: number): ChatMessage[] {
  const system = systemPrompt(rules);
  let rounds = [...ctx.recentRounds];
  const render = () => [
    campaignBlock(ctx.campaign),
    partyBlock(ctx.characters),
    ctx.campaign.summary ? `Story so far:\n${ctx.campaign.summary}` : "",
    rounds.length ? `Recent rounds:\n${rounds.map((r) => r.lines.join("\n")).join("\n\n")}` : "",
    task,
  ].filter(Boolean).join("\n\n");
  let user = render();
  while (rounds.length > 0 && estimateTokens(system + user) > budgetTokens) {
    rounds = rounds.slice(1);
    user = render();
  }
  return [{ role: "system", content: system }, { role: "user", content: user }];
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/server/dm`
Expected: all pass. If `toFormat` output nests differently in your Zod version, print it with `console.log(JSON.stringify(toFormat(AdjudicateSchema), null, 2))` and adjust the test's property paths only. The behaviour that matters is that it is a valid JSON Schema object.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: DM prompt building, context window and reply schemas"
```

---

### Task 8: DungeonMaster service

**Files:**
- Create: `src/server/dm/dm.ts`
- Test: `tests/server/dm/dm.test.ts`

**Interfaces:**
- Consumes: `ChatClient`, `OllamaError` (Task 6); schemas, prompts, context (Task 7); `RulesEngine`.
- Produces:
  - `class DmError extends Error`
  - `interface StreamHandlers { onChunk(text: string): void; onRestart(): void }`
  - `interface DungeonMaster { adjudicate(ctx: DmContext, actions: ActionInput[]): Promise<CheckDraft[]>; resolve(ctx: DmContext, input: ResolveInput, stream: StreamHandlers): Promise<ResolveOutput>; opening(ctx: DmContext, stream: StreamHandlers): Promise<ResolveOutput>; startingKit(input: { name: string; concept: string; setting: string }): Promise<KitItem[]>; summarise(oldSummary: string, rounds: RoundTranscript[]): Promise<string> }`
  - `createDungeonMaster(deps: { chat: ChatClient; rules: RulesEngine; budgetTokens: number }): DungeonMaster`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/server/dm/dm.test.ts
import { describe, expect, it } from "vitest";
import { createDungeonMaster, DmError } from "../../../src/server/dm/dm";
import type { DmContext } from "../../../src/server/dm/context";
import { OllamaError, type ChatClient, type ChatRequest } from "../../../src/server/dm/ollama";
import { lightRules } from "../../../src/server/rules/engine";

class FakeChat implements ChatClient {
  requests: ChatRequest[] = [];
  constructor(private replies: (string | Error)[]) {}
  async chat(req: ChatRequest) {
    this.requests.push(req);
    const next = this.replies.shift();
    if (next === undefined) throw new Error("no more scripted replies");
    if (next instanceof Error) throw next;
    // stream in 3-char pieces to exercise the extractor
    for (let i = 0; i < next.length; i += 3) req.onToken?.(next.slice(i, i + 3));
    return next;
  }
  async unload() {}
}

const ctx: DmContext = {
  campaign: { id: 1, title: "T", mode: "solo", setting: "S", pitch: "", outline: null, sceneTitle: "", summary: "", roundState: "resolving", roundNumber: 1, stalledPhase: null, createdAt: "", updatedAt: "" },
  characters: [], recentRounds: [],
};
const make = (replies: (string | Error)[]) => {
  const chat = new FakeChat(replies);
  return { chat, dm: createDungeonMaster({ chat, rules: lightRules, budgetTokens: 12000 }) };
};
const recorder = () => {
  const r = { chunks: [] as string[], restarts: 0 };
  return { r, handlers: { onChunk: (t: string) => r.chunks.push(t), onRestart: () => { r.restarts++; } } };
};

describe("DungeonMaster", () => {
  it("adjudicates", async () => {
    const { dm, chat } = make(['{"checks":[{"character":"Wren","ability":"DEX","dc":14,"reason":"slippery"}]}']);
    expect(await dm.adjudicate(ctx, [{ character: "Wren", text: "I leap" }])).toEqual([{ character: "Wren", ability: "DEX", dc: 14, reason: "slippery" }]);
    expect(chat.requests[0].format).toHaveProperty("type", "object");
  });

  it("streams narration and returns raw changes for the rules engine to validate", async () => {
    const { dm } = make([JSON.stringify({ narration: "The door gives way.", changes: [{ op: "damage", character: "Wren", amount: 2 }, { op: "bogus" }] })]);
    const { r, handlers } = recorder();
    const out = await dm.resolve(ctx, { actions: [], skipped: [], rolls: [] }, handlers);
    expect(out.narration).toBe("The door gives way.");
    expect(out.changes).toHaveLength(2);
    expect(r.chunks.join("")).toBe("The door gives way.");
  });

  it("retries once with the validation error, signalling a restart", async () => {
    const { dm, chat } = make(['{"narration": "", "changes": []}', '{"narration":"Second try.","changes":[]}']);
    const { r, handlers } = recorder();
    const out = await dm.resolve(ctx, { actions: [], skipped: [], rolls: [] }, handlers);
    expect(out.narration).toBe("Second try.");
    expect(r.restarts).toBe(1);
    expect(chat.requests).toHaveLength(2);
    expect(chat.requests[1].messages.at(-1)!.content).toMatch(/not valid/);
  });

  it("retries on invalid JSON", async () => {
    const { dm } = make(["not json at all", '{"checks":[]}']);
    expect(await dm.adjudicate(ctx, [])).toEqual([]);
  });

  it("gives up with DmError after two bad replies", async () => {
    const { dm } = make(["nope", "still nope"]);
    await expect(dm.adjudicate(ctx, [])).rejects.toThrow(DmError);
  });

  it("does not retry when Ollama is unreachable", async () => {
    const { dm, chat } = make([new OllamaError("Could not reach Ollama"), '{"checks":[]}']);
    await expect(dm.adjudicate(ctx, [])).rejects.toThrow(/Could not reach Ollama/);
    expect(chat.requests).toHaveLength(1);
  });

  it("caps the starting kit at 5 items", async () => {
    const items = Array.from({ length: 7 }, (_, i) => ({ name: `Item ${i}`, description: "d" }));
    const { dm } = make([JSON.stringify({ items })]);
    expect(await dm.startingKit({ name: "Wren", concept: "scout", setting: "S" })).toHaveLength(5);
  });

  it("summarises", async () => {
    const { dm } = make(['{"summary":"They won."}']);
    expect(await dm.summarise("", [{ round: 1, lines: ["DM: x"] }])).toBe("They won.");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/server/dm/dm.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// src/server/dm/dm.ts
import { z } from "zod";
import type { KitItem } from "../../shared/types";
import type { RulesEngine } from "../rules/engine";
import type { DmContext, RoundTranscript } from "./context";
import { NarrationExtractor } from "./narrationStream";
import { OllamaError, type ChatClient, type ChatMessage } from "./ollama";
import {
  adjudicateTask, buildMessages, kitMessages, openingTask, resolveTask, summaryMessages,
  type ActionInput, type ResolveInput,
} from "./prompts";
import {
  AdjudicateSchema, KitSchema, ResolveParseSchema, SummarySchema, resolveFormatSchema, toFormat,
  type CheckDraft, type ResolveOutput,
} from "./schemas";

export class DmError extends Error {}

export interface StreamHandlers { onChunk(text: string): void; onRestart(): void }

export interface DungeonMaster {
  adjudicate(ctx: DmContext, actions: ActionInput[]): Promise<CheckDraft[]>;
  resolve(ctx: DmContext, input: ResolveInput, stream: StreamHandlers): Promise<ResolveOutput>;
  opening(ctx: DmContext, stream: StreamHandlers): Promise<ResolveOutput>;
  startingKit(input: { name: string; concept: string; setting: string }): Promise<KitItem[]>;
  summarise(oldSummary: string, rounds: RoundTranscript[]): Promise<string>;
}

export function createDungeonMaster(deps: { chat: ChatClient; rules: RulesEngine; budgetTokens: number }): DungeonMaster {
  const { chat, rules, budgetTokens } = deps;
  const adjudicateFormat = toFormat(AdjudicateSchema);
  const resolveFormat = toFormat(resolveFormatSchema(rules));
  const kitFormat = toFormat(KitSchema);
  const summaryFormat = toFormat(SummarySchema);

  async function callStructured<T>(messages: ChatMessage[], parser: z.ZodType<T>, format: object, stream?: StreamHandlers): Promise<T> {
    let lastError = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const msgs: ChatMessage[] = attempt === 0 ? messages : [
        ...messages,
        { role: "user", content: `Your previous reply was not valid: ${lastError}\nReply again with valid JSON only, in the required format.` },
      ];
      if (attempt > 0) stream?.onRestart();
      const extractor = new NarrationExtractor();
      let raw: string;
      try {
        raw = await chat.chat({
          messages: msgs, format,
          onToken: stream ? (t) => { const s = extractor.push(t); if (s) stream.onChunk(s); } : undefined,
        });
      } catch (e) {
        if (e instanceof OllamaError) throw new DmError(e.message);
        throw e;
      }
      let json: unknown;
      try { json = JSON.parse(raw); } catch { lastError = "it was not valid JSON"; continue; }
      const parsed = parser.safeParse(json);
      if (parsed.success) return parsed.data;
      lastError = z.prettifyError(parsed.error);
    }
    throw new DmError(`The Dungeon Master gave an unusable reply twice (${lastError})`);
  }

  return {
    async adjudicate(ctx, actions) {
      const out = await callStructured(buildMessages(ctx, rules, adjudicateTask(actions), budgetTokens), AdjudicateSchema, adjudicateFormat);
      return out.checks;
    },
    resolve(ctx, input, stream) {
      return callStructured(buildMessages(ctx, rules, resolveTask(input), budgetTokens), ResolveParseSchema, resolveFormat, stream);
    },
    opening(ctx, stream) {
      return callStructured(buildMessages(ctx, rules, openingTask(), budgetTokens), ResolveParseSchema, resolveFormat, stream);
    },
    async startingKit(input) {
      const out = await callStructured(kitMessages(input), KitSchema, kitFormat);
      return out.items.slice(0, 5);
    },
    async summarise(oldSummary, rounds) {
      const out = await callStructured(summaryMessages(oldSummary, rounds), SummarySchema, summaryFormat);
      return out.summary;
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/server/dm`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: DungeonMaster service with structured output, retry and streaming"
```

---

### Task 9: Turn state machine

**Files:**
- Create: `src/server/realtime/hub.ts` (just the `Broadcaster` interface + `Hub` class), `src/server/turns/status.ts`, `src/server/turns/snapshot.ts`, `src/server/turns/turns.ts`
- Test: `tests/server/turns/turns.test.ts`

**Interfaces:**
- Consumes: `Store`, `RulesEngine`, `DungeonMaster`/`DmError`/`StreamHandlers`, `buildContext`/`transcriptFromEvents`, `findCharacterByName`, `D20`.
- Produces:
  - `interface Broadcaster { broadcast(campaignId: number, msg: ServerMsg): void }`
  - `interface Socketish { send(data: string): void; readyState: number }`
  - `class Hub implements Broadcaster { join(id, ws: Socketish); leave(id, ws); broadcast(id, msg) }`
  - `roundStatus(events: StoredEvent[]): RoundStatus`
  - `activeCharacters(chars: Character[], rules: RulesEngine): Character[]`
  - `buildSnapshot(store: Store, rules: RulesEngine, campaignId: number): Snapshot`
  - `class GameError extends Error`
  - `class TurnService { constructor(deps: { store; rules; dm; hub: Broadcaster; dice: D20 }); begin(id): Promise<void>; submitAction(id, characterId, text): Promise<void>; skip(id, characterId, by): Promise<void>; roll(id, characterId): Promise<void>; retry(id): Promise<void>; recoverInterrupted(): void; settle(): Promise<void>; broadcastSnapshot(id): void }`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/server/turns/turns.test.ts
import { describe, expect, it } from "vitest";
import type { DmContext } from "../../../src/server/dm/context";
import { DmError, type DungeonMaster, type StreamHandlers } from "../../../src/server/dm/dm";
import type { ActionInput, ResolveInput } from "../../../src/server/dm/prompts";
import type { CheckDraft } from "../../../src/server/dm/schemas";
import type { Broadcaster } from "../../../src/server/realtime/hub";
import { lightRules } from "../../../src/server/rules/engine";
import { createStore } from "../../../src/server/store/store";
import { GameError, TurnService } from "../../../src/server/turns/turns";
import type { Mode, ServerMsg } from "../../../src/shared/types";

const tick = () => new Promise((r) => setTimeout(r, 5));

class FakeDm implements DungeonMaster {
  adjudicateCalls: ActionInput[][] = [];
  resolveCalls: ResolveInput[] = [];
  nextChecks: CheckDraft[] = [];
  nextChanges: unknown[] = [];
  failNext: "adjudicate" | "resolve" | "opening" | null = null;
  summaries = 0;
  onResolve: (() => void) | null = null;

  async adjudicate(_ctx: DmContext, actions: ActionInput[]) {
    this.adjudicateCalls.push(actions);
    await tick();
    if (this.failNext === "adjudicate") { this.failNext = null; throw new DmError("adjudicate failed"); }
    const c = this.nextChecks; this.nextChecks = []; return c;
  }
  async resolve(_ctx: DmContext, input: ResolveInput, stream: StreamHandlers) {
    this.resolveCalls.push(input);
    this.onResolve?.();
    await tick();
    if (this.failNext === "resolve") { this.failNext = null; throw new DmError("resolve failed"); }
    stream.onChunk("The ");
    stream.onChunk("story.");
    const changes = this.nextChanges; this.nextChanges = [];
    return { narration: `Resolved: ${input.actions.map((a) => a.character).join(", ")}`, changes };
  }
  async opening(_ctx: DmContext, stream: StreamHandlers) {
    await tick();
    if (this.failNext === "opening") { this.failNext = null; throw new DmError("opening failed"); }
    stream.onChunk("Once");
    return { narration: "Once upon a time.", changes: [{ op: "set_scene", title: "The Gate" }] };
  }
  async startingKit() { return [{ name: "Rope", description: "30ft" }]; }
  async summarise(_old: string, rounds: unknown[]) { this.summaries++; return `summary of ${rounds.length} rounds`; }
}

class RecordingHub implements Broadcaster {
  msgs: ServerMsg[] = [];
  broadcast(_id: number, msg: ServerMsg) { this.msgs.push(msg); }
}

function setup(mode: Mode = "party", names = ["Corvin", "Wren"]) {
  const store = createStore(":memory:");
  const dm = new FakeDm();
  const hub = new RecordingHub();
  let die = 16;
  const campaign = store.createCampaign({ title: "Test", mode, setting: "Fantasy", pitch: "", outline: null });
  const chars = names.map((name) => store.createCharacter({
    campaignId: campaign.id, name, concept: "hero", hp: 20, maxHp: 20, items: [{ name: "Rope", description: "", qty: 1 }],
    scores: { STR: 15, DEX: 10, CON: 10, INT: 8, WIS: 12, CHA: 8 },
  }));
  const turns = new TurnService({ store, rules: lightRules, dm, hub, dice: () => die });
  return { store, dm, hub, turns, id: campaign.id, chars, setDie: (n: number) => { die = n; } };
}

async function begun(mode: Mode = "party", names?: string[]) {
  const s = setup(mode, names);
  await s.turns.begin(s.id);
  return s;
}

describe("TurnService", () => {
  it("begin runs the opening scene and starts round 1", async () => {
    const { store, hub, turns, id } = setup();
    await turns.begin(id);
    const c = store.getCampaign(id)!;
    expect(c).toMatchObject({ roundState: "collecting", roundNumber: 1, sceneTitle: "The Gate" });
    expect(store.getEvents(id).find((e) => e.type === "narration")).toMatchObject({ text: "Once upon a time.", round: 0 });
    expect(hub.msgs.some((m) => m.t === "narration_chunk" && m.text === "Once")).toBe(true);
    await expect(turns.begin(id)).rejects.toThrow(GameError);
  });

  it("begin needs at least one character", async () => {
    const { turns, id } = setup("party", []);
    await expect(turns.begin(id)).rejects.toThrow(/Create a character/);
  });

  it("solo: one action resolves the round", async () => {
    const { store, dm, turns, id, chars } = await begun("solo", ["Corvin"]);
    await turns.submitAction(id, chars[0].id, "  I open the gate  ");
    expect(dm.adjudicateCalls[0]).toEqual([{ character: "Corvin", text: "I open the gate" }]);
    expect(store.getCampaign(id)).toMatchObject({ roundState: "collecting", roundNumber: 2 });
    expect(store.getEvents(id, { fromRound: 1, toRound: 1 }).map((e) => e.type)).toEqual(["action", "narration"]);
  });

  it("party: waits for everyone, then resolves both", async () => {
    const { store, dm, turns, id, chars } = await begun();
    await turns.submitAction(id, chars[0].id, "I look around");
    expect(store.getCampaign(id)!.roundState).toBe("collecting");
    expect(dm.adjudicateCalls).toHaveLength(0);
    await expect(turns.submitAction(id, chars[0].id, "again")).rejects.toThrow(/already acted/);
    await turns.submitAction(id, chars[1].id, "I listen");
    expect(dm.resolveCalls[0].actions.map((a) => a.character)).toEqual(["Corvin", "Wren"]);
    expect(store.getCampaign(id)!.roundNumber).toBe(2);
  });

  it("rejects empty or overlong actions", async () => {
    const { turns, id, chars } = await begun();
    await expect(turns.submitAction(id, chars[0].id, "   ")).rejects.toThrow(GameError);
    await expect(turns.submitAction(id, chars[0].id, "x".repeat(1001))).rejects.toThrow(GameError);
  });

  it("go ahead without me, and don't wait for someone", async () => {
    const a = await begun();
    await a.turns.skip(a.id, a.chars[1].id, a.chars[1].id);
    await a.turns.submitAction(a.id, a.chars[0].id, "I go alone");
    expect(a.dm.resolveCalls[0]).toMatchObject({ skipped: ["Wren"], actions: [{ character: "Corvin" }] });

    const b = await begun();
    await b.turns.submitAction(b.id, b.chars[0].id, "I go");
    await b.turns.skip(b.id, b.chars[1].id, b.chars[0].id);
    expect(b.store.getCampaign(b.id)!.roundNumber).toBe(2);
    expect(b.store.getEvents(b.id).find((e) => e.type === "skip")).toMatchObject({ characterId: b.chars[1].id, skippedBy: b.chars[0].id });
  });

  it("someone has to act", async () => {
    const solo = await begun("solo", ["Corvin"]);
    await expect(solo.turns.skip(solo.id, solo.chars[0].id, solo.chars[0].id)).rejects.toThrow(/Someone has to act/);
    const party = await begun();
    await party.turns.skip(party.id, party.chars[0].id, party.chars[0].id);
    await expect(party.turns.skip(party.id, party.chars[1].id, party.chars[1].id)).rejects.toThrow(/Someone has to act/);
  });

  it("checks: waits for rolls, then resolves with real results", async () => {
    const { store, dm, turns, id, chars, setDie } = await begun("solo", ["Corvin"]);
    dm.nextChecks = [{ character: "corvin", ability: "STR", dc: 14, reason: "heavy gate" }];
    await turns.submitAction(id, chars[0].id, "I force the gate");
    expect(store.getCampaign(id)!.roundState).toBe("awaiting_rolls");
    setDie(12);
    await turns.roll(id, chars[0].id);
    expect(dm.resolveCalls[0].rolls).toEqual([{ character: "Corvin", ability: "STR", die: 12, modifier: 2, total: 14, dc: 14, success: true, crit: null, reason: "heavy gate" }]);
    expect(store.getCampaign(id)!.roundState).toBe("collecting");
    await expect(turns.roll(id, chars[0].id)).rejects.toThrow(GameError);
  });

  it("ignores checks for unknown or non-acting characters, dedupes, and clamps DC", async () => {
    const { store, dm, turns, id, chars } = await begun();
    dm.nextChecks = [
      { character: "Gandalf", ability: "WIS", dc: 10, reason: "x" },
      { character: "Wren", ability: "DEX", dc: 10, reason: "skipped wren" },
      { character: "Corvin", ability: "STR", dc: 99, reason: "first" },
      { character: "Corvin", ability: "DEX", dc: 10, reason: "second" },
    ];
    await turns.skip(id, chars[1].id, chars[1].id);
    await turns.submitAction(id, chars[0].id, "I try");
    const checks = store.getEvents(id).filter((e) => e.type === "check_request");
    expect(checks).toEqual([expect.objectContaining({ characterId: chars[0].id, ability: "STR", dc: 25, reason: "first" })]);
  });

  it("a party member can roll for someone else", async () => {
    const { store, dm, turns, id, chars } = await begun();
    dm.nextChecks = [{ character: "Wren", ability: "DEX", dc: 10, reason: "jump" }];
    await turns.submitAction(id, chars[0].id, "I wait");
    await turns.submitAction(id, chars[1].id, "I jump");
    await turns.roll(id, chars[1].id); // pressed on Corvin's device
    expect(store.getCampaign(id)!.roundNumber).toBe(2);
  });

  it("applies ops and logs rejected ones", async () => {
    const { store, dm, turns, id, chars } = await begun("solo", ["Corvin"]);
    dm.nextChanges = [
      { op: "damage", character: "Corvin", amount: 5 },
      { op: "add_item", character: "Corvin", name: "Silver locket", description: "cold" },
      { op: "remove_item", character: "Corvin", name: "Torch" },
    ];
    await turns.submitAction(id, chars[0].id, "I search");
    const corvin = store.getCharacter(chars[0].id)!;
    expect(corvin.hp).toBe(15);
    expect(corvin.items.map((i) => i.name)).toEqual(["Rope", "Silver locket"]);
    const types = store.getEvents(id, { fromRound: 1, toRound: 1 }).map((e) => e.type);
    expect(types).toEqual(["action", "narration", "op_applied", "op_applied", "op_rejected"]);
  });

  it("a level-up spend during generation is not overwritten by the round commit", async () => {
    const { store, dm, turns, id, chars } = await begun("solo", ["Corvin"]);
    store.saveCharacter({ ...store.getCharacter(chars[0].id)!, pendingAbilityPoints: 1 });
    dm.onResolve = () => {
      const c = store.getCharacter(chars[0].id)!;
      const r = lightRules.spendAbilityPoint(c, "STR");
      if ("character" in r) store.saveCharacter(r.character);
    };
    dm.nextChanges = [{ op: "damage", character: "Corvin", amount: 1 }];
    await turns.submitAction(id, chars[0].id, "I fight");
    expect(store.getCharacter(chars[0].id)).toMatchObject({ hp: 19, pendingAbilityPoints: 0, scores: { STR: 16 } });
  });

  it("stalls on DM failure and retries the same phase", async () => {
    const { store, dm, hub, turns, id, chars } = await begun("solo", ["Corvin"]);
    dm.failNext = "resolve";
    await turns.submitAction(id, chars[0].id, "I try");
    expect(store.getCampaign(id)).toMatchObject({ roundState: "stalled", stalledPhase: "resolving", roundNumber: 1 });
    expect(store.getEvents(id).some((e) => e.type === "stall")).toBe(true);
    expect(hub.msgs.some((m) => m.t === "narration_reset")).toBe(true);
    await turns.retry(id);
    expect(store.getCampaign(id)).toMatchObject({ roundState: "collecting", stalledPhase: null, roundNumber: 2 });
    expect(dm.resolveCalls).toHaveLength(2);
    await expect(turns.retry(id)).rejects.toThrow(/Nothing to retry/);
  });

  it("opening can stall and be retried", async () => {
    const s = setup();
    s.dm.failNext = "opening";
    await s.turns.begin(s.id);
    expect(s.store.getCampaign(s.id)).toMatchObject({ roundState: "stalled", stalledPhase: "opening" });
    await s.turns.retry(s.id);
    expect(s.store.getCampaign(s.id)!.roundState).toBe("collecting");
  });

  it("both players acting at the same instant adjudicates once", async () => {
    const { dm, turns, id, chars } = await begun();
    await Promise.all([
      turns.submitAction(id, chars[0].id, "A"),
      turns.submitAction(id, chars[1].id, "B"),
    ]);
    expect(dm.adjudicateCalls).toHaveLength(1);
    expect(dm.resolveCalls).toHaveLength(1);
  });

  it("downed characters can't act, unless the whole party is down", async () => {
    const { store, turns, id, chars } = await begun();
    store.saveCharacter({ ...store.getCharacter(chars[1].id)!, hp: 0 });
    await expect(turns.submitAction(id, chars[1].id, "I crawl")).rejects.toThrow(/down/);
    await turns.submitAction(id, chars[0].id, "I fight on");
    expect(store.getCampaign(id)!.roundNumber).toBe(2); // Wren not waited for

    store.saveCharacter({ ...store.getCharacter(chars[0].id)!, hp: 0 });
    await turns.submitAction(id, chars[1].id, "I crawl");
    expect(store.getCampaign(id)!.roundState).toBe("collecting"); // waiting for Corvin too
    await turns.submitAction(id, chars[0].id, "I gasp");
    expect(store.getCampaign(id)!.roundNumber).toBe(3);
  });

  it("recoverInterrupted turns AI phases into stalls", async () => {
    const { store, turns, id } = await begun();
    store.updateCampaign(id, { roundState: "resolving" });
    turns.recoverInterrupted();
    expect(store.getCampaign(id)).toMatchObject({ roundState: "stalled", stalledPhase: "resolving" });
  });

  it("summarises every 10 rounds without blocking play", async () => {
    const { store, dm, turns, id, chars } = await begun("solo", ["Corvin"]);
    for (let i = 0; i < 10; i++) await turns.submitAction(id, chars[0].id, `act ${i}`);
    await turns.settle();
    expect(dm.summaries).toBe(1);
    expect(store.getCampaign(id)!.summary).toBe("summary of 10 rounds");
  });

  it("broadcasts snapshots with round status", async () => {
    const { hub, turns, id, chars } = await begun();
    hub.msgs = [];
    await turns.submitAction(id, chars[0].id, "I wait");
    const snap = hub.msgs.filter((m) => m.t === "snapshot").at(-1);
    expect(snap && snap.t === "snapshot" && snap.snapshot.round.actions).toEqual([{ characterId: chars[0].id, text: "I wait" }]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/server/turns`
Expected: FAIL, modules not found.

- [ ] **Step 3: Implement `hub.ts`, `status.ts`, `snapshot.ts`**

```ts
// src/server/realtime/hub.ts
import type { ServerMsg } from "../../shared/types";

export interface Broadcaster { broadcast(campaignId: number, msg: ServerMsg): void }
export interface Socketish { send(data: string): void; readyState: number }

const OPEN = 1;

export class Hub implements Broadcaster {
  private rooms = new Map<number, Set<Socketish>>();

  join(campaignId: number, ws: Socketish): void {
    const room = this.rooms.get(campaignId) ?? new Set();
    room.add(ws);
    this.rooms.set(campaignId, room);
  }

  leave(campaignId: number, ws: Socketish): void {
    this.rooms.get(campaignId)?.delete(ws);
  }

  broadcast(campaignId: number, msg: ServerMsg): void {
    const data = JSON.stringify(msg);
    for (const ws of this.rooms.get(campaignId) ?? []) {
      if (ws.readyState === OPEN) ws.send(data);
    }
  }
}
```

```ts
// src/server/turns/status.ts
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
```

```ts
// src/server/turns/snapshot.ts
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
    events: store.getEvents(campaignId, { limit: 300 }),
    round: roundStatus(store.getEvents(campaignId, { fromRound: campaign.roundNumber, toRound: campaign.roundNumber })),
    activeIds: activeCharacters(characters, rules).map((c) => c.id),
  };
}
```

- [ ] **Step 4: Implement `turns.ts`**

```ts
// src/server/turns/turns.ts
import { AI_PHASES, type AiPhase, type Campaign, type Character, type RoundStatus } from "../../shared/types";
import { buildContext, transcriptFromEvents } from "../dm/context";
import type { DungeonMaster, StreamHandlers } from "../dm/dm";
import type { ResolveOutput } from "../dm/schemas";
import type { Broadcaster } from "../realtime/hub";
import type { D20 } from "../rules/dice";
import type { RulesEngine } from "../rules/engine";
import { findCharacterByName } from "../rules/ops";
import type { Store } from "../store/store";
import { activeCharacters, buildSnapshot } from "./snapshot";
import { roundStatus } from "./status";

/** A player-facing problem ("it's not your turn"), safe to show in the UI. */
export class GameError extends Error {}

export interface TurnDeps { store: Store; rules: RulesEngine; dm: DungeonMaster; hub: Broadcaster; dice: D20 }

const SUMMARY_EVERY = 10;
const hasResponded = (s: RoundStatus, id: number) => s.actions.some((a) => a.characterId === id) || s.skippedIds.includes(id);
const nameOf = (chars: Character[], id: number) => chars.find((c) => c.id === id)?.name ?? "Someone";

export class TurnService {
  private locks = new Map<number, Promise<unknown>>();
  private background = new Set<Promise<void>>();

  constructor(private deps: TurnDeps) {}

  begin(id: number): Promise<void> {
    return this.locked(id, async () => {
      const c = this.campaign(id);
      if (c.roundState !== "lobby") throw new GameError("The adventure has already begun.");
      if (this.deps.store.getCharacters(id).length === 0) throw new GameError("Create a character first.");
      await this.runOpening(id);
    });
  }

  submitAction(id: number, characterId: number, text: string): Promise<void> {
    return this.locked(id, async () => {
      const c = this.campaign(id);
      if (c.roundState !== "collecting") throw new GameError("It's not time to act right now.");
      const trimmed = text.trim();
      if (!trimmed) throw new GameError("Say what your character does.");
      if (trimmed.length > 1000) throw new GameError("Keep it under 1000 characters.");
      const ch = this.activeCharacter(id, characterId);
      if (hasResponded(this.status(c), characterId)) throw new GameError(`${ch.name} has already acted this round.`);
      this.deps.store.appendEvent(id, c.roundNumber, { type: "action", characterId, text: trimmed });
      await this.advanceIfReady(id);
    });
  }

  skip(id: number, characterId: number, by: number): Promise<void> {
    return this.locked(id, async () => {
      const c = this.campaign(id);
      if (c.roundState !== "collecting") throw new GameError("It's not time to act right now.");
      const ch = this.activeCharacter(id, characterId);
      const status = this.status(c);
      if (hasResponded(status, characterId)) throw new GameError(`${ch.name} has already acted this round.`);
      const stillIn = this.activeIds(id).filter((a) => a !== characterId && !status.skippedIds.includes(a));
      if (stillIn.length === 0) throw new GameError("Someone has to act this round.");
      this.deps.store.appendEvent(id, c.roundNumber, { type: "skip", characterId, skippedBy: by });
      await this.advanceIfReady(id);
    });
  }

  roll(id: number, characterId: number): Promise<void> {
    return this.locked(id, async () => {
      const { store, rules, dice } = this.deps;
      const c = this.campaign(id);
      if (c.roundState !== "awaiting_rolls") throw new GameError("There's nothing to roll right now.");
      const status = this.status(c);
      const check = status.checks.find((ch) => ch.characterId === characterId && !ch.roll);
      if (!check) throw new GameError("There's no roll waiting for that character.");
      const ch = store.getCharacter(characterId)!;
      const die = dice();
      const outcome = rules.check(die, ch.scores, check.ability, check.dc);
      store.appendEvent(id, c.roundNumber, { type: "roll", characterId, ability: check.ability, die, dc: check.dc, ...outcome });
      const after = this.status(c);
      if (after.checks.every((x) => x.roll)) await this.runResolve(id);
      else this.broadcastSnapshot(id);
    });
  }

  retry(id: number): Promise<void> {
    return this.locked(id, async () => {
      const c = this.campaign(id);
      if (c.roundState !== "stalled" || !c.stalledPhase) throw new GameError("Nothing to retry.");
      if (c.stalledPhase === "opening") await this.runOpening(id);
      else if (c.stalledPhase === "adjudicating") await this.runAdjudicate(id);
      else await this.runResolve(id);
    });
  }

  /** Call once at startup: a phase that was running when the server stopped can never finish. */
  recoverInterrupted(): void {
    for (const s of this.deps.store.listCampaigns()) {
      if ((AI_PHASES as readonly string[]).includes(s.roundState)) {
        this.deps.store.updateCampaign(s.id, { roundState: "stalled", stalledPhase: s.roundState as AiPhase });
      }
    }
  }

  /** Wait for background work (summaries). Used by tests and the smoke script. */
  async settle(): Promise<void> {
    await Promise.all([...this.background]);
  }

  broadcastSnapshot(id: number): void {
    this.deps.hub.broadcast(id, { t: "snapshot", snapshot: buildSnapshot(this.deps.store, this.deps.rules, id) });
  }

  // ── internals ──────────────────────────────────────────────────────────

  private locked<T>(id: number, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(id) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.locks.set(id, next.catch(() => undefined));
    return next;
  }

  private campaign(id: number): Campaign {
    const c = this.deps.store.getCampaign(id);
    if (!c) throw new GameError("No such campaign.");
    return c;
  }

  private status(c: Campaign): RoundStatus {
    return roundStatus(this.deps.store.getEvents(c.id, { fromRound: c.roundNumber, toRound: c.roundNumber }));
  }

  private activeIds(id: number): number[] {
    return activeCharacters(this.deps.store.getCharacters(id), this.deps.rules).map((c) => c.id);
  }

  private activeCharacter(id: number, characterId: number): Character {
    const ch = this.deps.store.getCharacters(id).find((c) => c.id === characterId);
    if (!ch) throw new GameError("That character isn't in this campaign.");
    if (!this.activeIds(id).includes(characterId)) throw new GameError(`${ch.name} is down and can't act until healed.`);
    return ch;
  }

  private async advanceIfReady(id: number): Promise<void> {
    const status = this.status(this.campaign(id));
    const waiting = this.activeIds(id).filter((a) => !hasResponded(status, a));
    if (waiting.length > 0) { this.broadcastSnapshot(id); return; }
    await this.runAdjudicate(id);
  }

  private stream(id: number): StreamHandlers {
    return {
      onChunk: (text) => this.deps.hub.broadcast(id, { t: "narration_chunk", text }),
      onRestart: () => this.deps.hub.broadcast(id, { t: "narration_reset" }),
    };
  }

  private async runPhase(id: number, phase: AiPhase, work: () => Promise<void>): Promise<void> {
    const { store, hub } = this.deps;
    store.updateCampaign(id, { roundState: phase, stalledPhase: null });
    this.broadcastSnapshot(id);
    try {
      await work();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      console.warn(`[campaign ${id}] ${phase} stalled: ${message}`);
      store.appendEvent(id, this.campaign(id).roundNumber, { type: "stall", phase, error: message });
      store.updateCampaign(id, { roundState: "stalled", stalledPhase: phase });
      hub.broadcast(id, { t: "narration_reset" });
    }
    this.broadcastSnapshot(id);
  }

  private runOpening(id: number): Promise<void> {
    return this.runPhase(id, "opening", async () => {
      const out = await this.deps.dm.opening(buildContext(this.deps.store, id), this.stream(id));
      this.commitNarration(id, out);
    });
  }

  private runAdjudicate(id: number): Promise<void> {
    return this.runPhase(id, "adjudicating", async () => {
      const { store, dm } = this.deps;
      const c = this.campaign(id);
      const chars = store.getCharacters(id);
      const status = this.status(c);
      const drafts = await dm.adjudicate(
        buildContext(store, id),
        status.actions.map((a) => ({ character: nameOf(chars, a.characterId), text: a.text })),
      );
      const acting = new Set(status.actions.map((a) => a.characterId));
      const chosen = new Set<number>();
      store.transaction(() => {
        for (const d of drafts) {
          const ch = findCharacterByName(chars, d.character);
          if (!ch || !acting.has(ch.id) || chosen.has(ch.id)) continue;
          chosen.add(ch.id);
          const dc = Math.min(25, Math.max(5, Math.round(Number.isFinite(d.dc) ? d.dc : 15)));
          store.appendEvent(id, c.roundNumber, { type: "check_request", characterId: ch.id, ability: d.ability, dc, reason: d.reason.slice(0, 200) });
        }
        if (chosen.size > 0) store.updateCampaign(id, { roundState: "awaiting_rolls" });
      });
      if (chosen.size === 0) await this.runResolve(id);
    });
  }

  private runResolve(id: number): Promise<void> {
    return this.runPhase(id, "resolving", async () => {
      const { store, dm } = this.deps;
      const c = this.campaign(id);
      const chars = store.getCharacters(id);
      const status = this.status(c);
      const out = await dm.resolve(buildContext(store, id), {
        actions: status.actions.map((a) => ({ character: nameOf(chars, a.characterId), text: a.text })),
        skipped: status.skippedIds.map((sid) => nameOf(chars, sid)),
        rolls: status.checks.flatMap((ch) => ch.roll ? [{
          character: nameOf(chars, ch.characterId), ability: ch.ability, die: ch.roll.die, modifier: ch.roll.modifier,
          total: ch.roll.total, dc: ch.dc, success: ch.roll.success, crit: ch.roll.crit, reason: ch.reason,
        }] : []),
      }, this.stream(id));
      this.commitNarration(id, out);
      if (c.roundNumber % SUMMARY_EVERY === 0) this.spawnSummary(id, c.roundNumber);
    });
  }

  /** Applies a DM reply atomically. Characters are re-read here so changes made during generation survive. */
  private commitNarration(id: number, out: ResolveOutput): void {
    const { store, rules } = this.deps;
    store.transaction(() => {
      const c = this.campaign(id);
      const result = rules.applyOps(store.getCharacters(id), out.changes);
      for (const ch of result.characters) store.saveCharacter(ch);
      store.appendEvent(id, c.roundNumber, { type: "narration", text: out.narration });
      for (const op of result.applied) store.appendEvent(id, c.roundNumber, { type: "op_applied", op });
      for (const r of result.rejected) store.appendEvent(id, c.roundNumber, { type: "op_rejected", op: r.op, reason: r.reason });
      store.updateCampaign(id, {
        roundState: "collecting", stalledPhase: null, roundNumber: c.roundNumber + 1,
        ...(result.sceneTitle ? { sceneTitle: result.sceneTitle } : {}),
      });
    });
  }

  private spawnSummary(id: number, upToRound: number): void {
    const { store, dm } = this.deps;
    const p = (async () => {
      try {
        const c = this.campaign(id);
        const events = store.getEvents(id, { fromRound: upToRound - SUMMARY_EVERY + 1, toRound: upToRound });
        const text = await dm.summarise(c.summary, transcriptFromEvents(events, store.getCharacters(id)));
        store.updateCampaign(id, { summary: text });
        store.appendEvent(id, this.campaign(id).roundNumber, { type: "summary", text });
      } catch (e) {
        console.warn(`[campaign ${id}] summary failed (will retry in 10 rounds):`, (e as Error).message);
      }
    })();
    this.background.add(p);
    void p.finally(() => this.background.delete(p));
  }
}
```

Note on the "level-up spend" test: `commitNarration` reads characters inside the transaction, *after* the DM call returns. That's what keeps the spend made during `onResolve`. Don't "optimise" it by reusing `chars` from before the DM call.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/server/turns`
Expected: all pass. Then run everything: `npx vitest run` (all green).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: round state machine with rolls, skips, stalls and summaries"
```

---

### Task 10: Presets, adventures, API, WebSocket, app and entry point

**Files:**
- Create: `src/server/campaigns/presets.ts`, `src/server/campaigns/adventures.ts`, `src/server/campaigns/adventures/drowned-chapel.json`, `src/server/routes/api.ts`, `src/server/routes/ws.ts`, `src/server/app.ts`, `src/server/main.ts`
- Test: `tests/server/app.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `PRESETS: Preset[]`; `campaignInputFrom(req: NewCampaignRequest, adventures: AdventureOutline[]): NewCampaignInput | { error: string }`
  - `loadAdventures(): AdventureOutline[]`
  - `NewCampaignSchema`, `NewCharacterSchema`, `ClientMsgSchema` (Zod)
  - `interface AppDeps { config: Config; store: Store; dm: DungeonMaster; chat: ChatClient; rules?: RulesEngine; dice?: D20; serveClient?: boolean }`
  - `buildApp(deps: AppDeps): Promise<{ app: FastifyInstance; turns: TurnService; hub: Hub }>`
  - REST: `GET /api/presets`, `GET/POST /api/campaigns`, `GET /api/campaigns/:id`, `POST /api/kit`, `POST /api/campaigns/:id/characters`, `POST /api/characters/:id/spend`, `POST /api/pack-up`
  - WS: `GET /ws?campaign=<id>` → sends `snapshot` on connect; accepts `ClientMsg`.

- [ ] **Step 1: Write the presets and adventure data**

```ts
// src/server/campaigns/presets.ts
import type { AdventureOutline, NewCampaignRequest, Preset } from "../../shared/types";
import type { NewCampaignInput } from "../store/store";

export const PRESETS: Preset[] = [
  { id: "classic-fantasy", name: "Classic Fantasy", blurb: "Taverns, dragons, ruined keeps and a kingdom in need of heroes.",
    setting: "Classic high fantasy: knights, wizards, dragons, ancient ruins, and a realm on the edge of war." },
  { id: "gothic-horror", name: "Gothic Horror", blurb: "Fog, candlelight and things that should stay buried.",
    setting: "Gothic horror: a mist-bound valley of crumbling manors, superstitious villagers, cursed nobles and creeping dread. Danger is real." },
  { id: "pirate-seas", name: "Pirate Seas", blurb: "Salt, cannon smoke and treasure maps of dubious honesty.",
    setting: "Swashbuckling age of sail: pirate havens, navy hunters, sea monsters, cursed gold and island mysteries." },
  { id: "scifi-derelict", name: "Sci-fi Derelict", blurb: "A dead ship drifts in the dark. Something aboard is still awake.",
    setting: "Tense science fiction: a salvage crew boards a derelict starship far from help. Failing systems, strange tech, and something alien." },
];

export function campaignInputFrom(req: NewCampaignRequest, adventures: AdventureOutline[]): NewCampaignInput | { error: string } {
  const title = req.title?.trim();
  switch (req.source.kind) {
    case "preset": {
      const presetId = req.source.presetId;
      const p = PRESETS.find((x) => x.id === presetId);
      if (!p) return { error: "Unknown setting." };
      return { title: title || p.name, mode: req.mode, setting: p.setting, pitch: "", outline: null };
    }
    case "pitch":
      return { title: title || "A Tale Untold", mode: req.mode, setting: "Custom setting described in the pitch", pitch: req.source.pitch.trim(), outline: null };
    case "adventure": {
      const adventureId = req.source.adventureId;
      const a = adventures.find((x) => x.id === adventureId);
      if (!a) return { error: "Unknown adventure." };
      return { title: title || a.title, mode: req.mode, setting: a.setting, pitch: a.pitch, outline: a };
    }
  }
}
```

```json
// src/server/campaigns/adventures/drowned-chapel.json
{
  "id": "drowned-chapel",
  "title": "The Drowned Chapel",
  "setting": "Classic fantasy with a gothic tone: marsh villages, old faith, restless dead.",
  "pitch": "A flooded chapel on the marsh has started ringing its bell at night, though its bell tower collapsed decades ago. The village of Fenwick has offered a purse of silver to anyone who can silence it.",
  "goal": "Discover why the bell rings and silence it for good.",
  "villain": "Sister Ambrel, a drowned abbess bound to the bell, who wants one living soul to take her place.",
  "locations": ["Fenwick village and the Lantern Inn", "The causeway across the marsh", "The flooded nave", "The crypt beneath the altar", "The sunken bell chamber"],
  "beats": [
    "The villagers explain the bell and the recent disappearances",
    "The causeway: something in the reeds follows the party",
    "The nave: signs of the abbess and her last sermon",
    "The crypt: the truth of the bargain",
    "The bell chamber: confront Sister Ambrel and choose how it ends"
  ]
}
```

(Remove the `// path` comment line when creating the JSON file. JSON has no comments.)

```ts
// src/server/campaigns/adventures.ts
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { AdventureOutline } from "../../shared/types";

const AdventureSchema = z.object({
  id: z.string().min(1), title: z.string().min(1), setting: z.string().min(1), pitch: z.string().min(1),
  goal: z.string().min(1), villain: z.string().min(1), locations: z.array(z.string()).min(1), beats: z.array(z.string()).min(1),
}) satisfies z.ZodType<AdventureOutline>;

const DIR = join(dirname(fileURLToPath(import.meta.url)), "adventures");

/** Hand-written adventures: drop another JSON file in ./adventures to add one. */
export function loadAdventures(dir = DIR): AdventureOutline[] {
  return readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => {
    const parsed = AdventureSchema.safeParse(JSON.parse(readFileSync(join(dir, f), "utf8")));
    if (!parsed.success) throw new Error(`Adventure ${f} is invalid: ${z.prettifyError(parsed.error)}`);
    return parsed.data;
  });
}
```

- [ ] **Step 2: Write the failing integration tests**

```ts
// tests/server/app.test.ts
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/server/app";
import { loadConfig } from "../../src/server/config";
import type { DungeonMaster } from "../../src/server/dm/dm";
import { DmError } from "../../src/server/dm/dm";
import { OllamaError, type ChatClient } from "../../src/server/dm/ollama";
import { createStore, type Store } from "../../src/server/store/store";
import type { FastifyInstance } from "fastify";

const LAN = "192.168.1.10";
const scores = { STR: 15, DEX: 14, CON: 13, INT: 12, WIS: 10, CHA: 8 };

const fakeDm = (over: Partial<DungeonMaster> = {}): DungeonMaster => ({
  adjudicate: async () => [],
  resolve: async (_c, input) => ({ narration: `Resolved ${input.actions.length}`, changes: [] }),
  opening: async () => ({ narration: "It begins.", changes: [] }),
  startingKit: async () => [{ name: "Rope", description: "30ft" }],
  summarise: async () => "summary",
  ...over,
});

let app: FastifyInstance;
let store: Store;
let unloads = 0;
afterEach(async () => { await app?.close(); store?.close(); });

async function start(dm = fakeDm(), unload: ChatClient["unload"] = async () => { unloads++; }) {
  store = createStore(":memory:");
  unloads = 0;
  const chat: ChatClient = { chat: async () => "", unload };
  ({ app } = await buildApp({ config: loadConfig({ TABLE_PASSWORD: "dragon" }), store, dm, chat }));
  const login = await app.inject({ method: "POST", url: "/api/login", remoteAddress: LAN, payload: { password: "dragon" } });
  const cookie = `table=${login.cookies.find((c) => c.name === "table")!.value}`;
  const req = (method: "GET" | "POST", url: string, payload?: object) =>
    app.inject({ method, url, payload, remoteAddress: LAN, headers: { cookie } });
  return { req, cookie };
}

describe("API", () => {
  it("lists presets and adventures", async () => {
    const { req } = await start();
    const body = (await req("GET", "/api/presets")).json();
    expect(body.presets.map((p: { id: string }) => p.id)).toContain("gothic-horror");
    expect(body.adventures).toEqual([expect.objectContaining({ id: "drowned-chapel", title: "The Drowned Chapel" })]);
  });

  it("creates a campaign from a preset, pitch or adventure", async () => {
    const { req } = await start();
    const a = (await req("POST", "/api/campaigns", { mode: "party", source: { kind: "preset", presetId: "pirate-seas" } })).json();
    expect(a.campaign).toMatchObject({ title: "Pirate Seas", mode: "party", roundState: "lobby" });
    const b = await req("POST", "/api/campaigns", { mode: "solo", title: "Mine", source: { kind: "pitch", pitch: "Two smugglers on a ghost ship." } });
    expect(b.json().campaign).toMatchObject({ title: "Mine", pitch: "Two smugglers on a ghost ship." });
    const c = (await req("POST", "/api/campaigns", { mode: "solo", source: { kind: "adventure", adventureId: "drowned-chapel" } })).json();
    expect(c.campaign.outline.villain).toMatch(/Ambrel/);
    expect((await req("POST", "/api/campaigns", { mode: "solo", source: { kind: "pitch", pitch: "short" } })).statusCode).toBe(400);
    expect((await req("POST", "/api/campaigns", { mode: "solo", source: { kind: "preset", presetId: "nope" } })).statusCode).toBe(400);
    expect((await req("GET", "/api/campaigns")).json().campaigns).toHaveLength(3);
  });

  it("creates characters with point buy, HP from CON, and the kit", async () => {
    const { req } = await start();
    const { campaign } = (await req("POST", "/api/campaigns", { mode: "party", source: { kind: "preset", presetId: "classic-fantasy" } })).json();
    const kit = (await req("POST", "/api/kit", { campaignId: campaign.id, name: "Wren", concept: "scout" })).json();
    expect(kit.items).toEqual([{ name: "Rope", description: "30ft" }]);
    const r = await req("POST", `/api/campaigns/${campaign.id}/characters`, { name: "Wren", concept: "scout", scores, items: kit.items });
    expect(r.statusCode).toBe(200);
    expect(r.json().character).toMatchObject({ name: "Wren", hp: 22, maxHp: 22, items: [{ name: "Rope", qty: 1 }] });
    const dup = await req("POST", `/api/campaigns/${campaign.id}/characters`, { name: "wren", concept: "x", scores, items: [] });
    expect(dup.statusCode).toBe(409);
    const cheat = await req("POST", `/api/campaigns/${campaign.id}/characters`, { name: "Max", concept: "x", scores: { ...scores, STR: 16 }, items: [] });
    expect(cheat.statusCode).toBe(400);
  });

  it("solo campaigns have one hero", async () => {
    const { req } = await start();
    const { campaign } = (await req("POST", "/api/campaigns", { mode: "solo", source: { kind: "preset", presetId: "classic-fantasy" } })).json();
    await req("POST", `/api/campaigns/${campaign.id}/characters`, { name: "A", concept: "x", scores, items: [] });
    expect((await req("POST", `/api/campaigns/${campaign.id}/characters`, { name: "B", concept: "x", scores, items: [] })).statusCode).toBe(409);
  });

  it("returns 503 when the kit can't be generated", async () => {
    const { req } = await start(fakeDm({ startingKit: async () => { throw new DmError("down"); } }));
    const { campaign } = (await req("POST", "/api/campaigns", { mode: "solo", source: { kind: "preset", presetId: "classic-fantasy" } })).json();
    expect((await req("POST", "/api/kit", { campaignId: campaign.id, name: "A", concept: "b" })).statusCode).toBe(503);
  });

  it("spends ability points", async () => {
    const { req } = await start();
    const { campaign } = (await req("POST", "/api/campaigns", { mode: "solo", source: { kind: "preset", presetId: "classic-fantasy" } })).json();
    const { character } = (await req("POST", `/api/campaigns/${campaign.id}/characters`, { name: "A", concept: "x", scores, items: [] })).json();
    expect((await req("POST", `/api/characters/${character.id}/spend`, { ability: "STR" })).statusCode).toBe(400);
    store.saveCharacter({ ...store.getCharacter(character.id)!, pendingAbilityPoints: 1 });
    const ok = await req("POST", `/api/characters/${character.id}/spend`, { ability: "STR" });
    expect(ok.json().character).toMatchObject({ pendingAbilityPoints: 0, scores: { STR: 16 } });
  });

  it("packs up the model, but not mid-sentence", async () => {
    const { req } = await start();
    expect((await req("POST", "/api/pack-up")).json()).toEqual({ ok: true });
    expect(unloads).toBe(1);
    const { campaign } = (await req("POST", "/api/campaigns", { mode: "solo", source: { kind: "preset", presetId: "classic-fantasy" } })).json();
    store.updateCampaign(campaign.id, { roundState: "resolving" });
    const busy = await req("POST", "/api/pack-up");
    expect(busy.statusCode).toBe(409);
    expect(busy.json().error).toMatch(/mid-sentence/);
    expect(unloads).toBe(1);
  });

  it("reports when Ollama can't be reached to pack up", async () => {
    const { req } = await start(fakeDm(), async () => { throw new OllamaError("Could not reach Ollama at http://localhost:11434"); });
    const r = await req("POST", "/api/pack-up");
    expect(r.statusCode).toBe(503);
    expect(r.json().error).toMatch(/Could not reach Ollama/);
  });

  it("plays over the WebSocket", async () => {
    const { req, cookie } = await start();
    const { campaign } = (await req("POST", "/api/campaigns", { mode: "solo", source: { kind: "preset", presetId: "classic-fantasy" } })).json();
    const { character } = (await req("POST", `/api/campaigns/${campaign.id}/characters`, { name: "A", concept: "x", scores, items: [] })).json();
    await app.ready();
    const ws = await app.injectWS(`/ws?campaign=${campaign.id}`, { headers: { cookie } });
    const msgs: any[] = [];
    ws.on("message", (d: Buffer) => msgs.push(JSON.parse(d.toString())));
    const waitFor = async (pred: (m: any) => boolean) => {
      for (let i = 0; i < 100 && !msgs.some(pred); i++) await new Promise((r) => setTimeout(r, 10));
      return msgs.find(pred);
    };
    expect(await waitFor((m) => m.t === "snapshot")).toBeTruthy();
    ws.send(JSON.stringify({ t: "begin" }));
    expect(await waitFor((m) => m.t === "snapshot" && m.snapshot.campaign.roundState === "collecting")).toBeTruthy();
    ws.send(JSON.stringify({ t: "action", characterId: character.id, text: "I look" }));
    expect(await waitFor((m) => m.t === "snapshot" && m.snapshot.campaign.roundNumber === 2)).toBeTruthy();
    ws.send(JSON.stringify({ t: "roll", characterId: character.id }));
    expect(await waitFor((m) => m.t === "error")).toMatchObject({ message: "There's nothing to roll right now." });
    ws.send("garbage");
    expect(await waitFor((m) => m.t === "error" && m.message === "That message didn't make sense.")).toBeTruthy();
    ws.terminate();
  });

  it("refuses WebSockets without the cookie", async () => {
    await start();
    await app.ready();
    await expect(app.injectWS("/ws?campaign=1")).rejects.toThrow();
  });
});
```

If `app.injectWS` isn't available in your `@fastify/websocket` version, check its README for the test helper (it has been there since v10). Fallback: `await app.listen({ port: 0, host: "127.0.0.1" })` and connect with `new (await import("ws")).default(url, { headers: { cookie } })` (`npm i -D ws @types/ws`).

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run tests/server/app.test.ts`
Expected: FAIL, `app` module not found.

- [ ] **Step 4: Implement the routes**

```ts
// src/server/routes/api.ts
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ABILITIES, AI_PHASES, type AdventureOutline } from "../../shared/types";
import { campaignInputFrom, PRESETS } from "../campaigns/presets";
import { DmError, type DungeonMaster } from "../dm/dm";
import { OllamaError, type ChatClient } from "../dm/ollama";
import type { RulesEngine } from "../rules/engine";
import { NameTakenError, type Store } from "../store/store";
import { buildSnapshot } from "../turns/snapshot";
import type { TurnService } from "../turns/turns";

export const NewCampaignSchema = z.object({
  mode: z.enum(["solo", "party"]),
  title: z.string().trim().max(80).optional(),
  source: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("preset"), presetId: z.string() }),
    z.object({ kind: z.literal("pitch"), pitch: z.string().trim().min(10, "Write at least a sentence for your pitch.").max(1000) }),
    z.object({ kind: z.literal("adventure"), adventureId: z.string() }),
  ]),
});

const KitItemSchema = z.object({ name: z.string().trim().min(1).max(60), description: z.string().trim().max(200) });

export const NewCharacterSchema = z.object({
  name: z.string().trim().min(1, "Give your hero a name.").max(40),
  concept: z.string().trim().min(1, "Describe your hero in a few words.").max(120),
  scores: z.object(Object.fromEntries(ABILITIES.map((a) => [a, z.number().int()])) as Record<(typeof ABILITIES)[number], z.ZodNumber>),
  items: z.array(KitItemSchema).max(5),
});

const KitRequestSchema = z.object({ campaignId: z.number().int(), name: z.string().trim().min(1).max(40), concept: z.string().trim().min(1).max(120) });
const SpendSchema = z.object({ ability: z.enum(ABILITIES) });

export interface ApiDeps {
  store: Store; rules: RulesEngine; dm: DungeonMaster; chat: ChatClient; turns: TurnService; adventures: AdventureOutline[];
}

export async function registerApi(app: FastifyInstance, deps: ApiDeps): Promise<void> {
  const { store, rules, dm, chat, turns, adventures } = deps;
  const bad = (error: z.ZodError) => ({ error: z.prettifyError(error) });

  app.get("/api/presets", async () => ({
    presets: PRESETS,
    adventures: adventures.map(({ id, title, pitch }) => ({ id, title, pitch })),
  }));

  app.get("/api/campaigns", async () => ({ campaigns: store.listCampaigns() }));

  app.post("/api/campaigns", async (req, reply) => {
    const parsed = NewCampaignSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(bad(parsed.error));
    const input = campaignInputFrom(parsed.data, adventures);
    if ("error" in input) return reply.code(400).send(input);
    return { campaign: store.createCampaign(input) };
  });

  app.get<{ Params: { id: string } }>("/api/campaigns/:id", async (req, reply) => {
    const id = Number(req.params.id);
    if (!store.getCampaign(id)) return reply.code(404).send({ error: "No such campaign." });
    return { snapshot: buildSnapshot(store, rules, id) };
  });

  app.post("/api/kit", async (req, reply) => {
    const parsed = KitRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(bad(parsed.error));
    const campaign = store.getCampaign(parsed.data.campaignId);
    if (!campaign) return reply.code(404).send({ error: "No such campaign." });
    try {
      return { items: await dm.startingKit({ name: parsed.data.name, concept: parsed.data.concept, setting: campaign.setting }) };
    } catch (e) {
      if (e instanceof DmError) return reply.code(503).send({ error: "The Dungeon Master couldn't pack a kit just now. Try again." });
      throw e;
    }
  });

  app.post<{ Params: { id: string } }>("/api/campaigns/:id/characters", async (req, reply) => {
    const campaignId = Number(req.params.id);
    const campaign = store.getCampaign(campaignId);
    if (!campaign) return reply.code(404).send({ error: "No such campaign." });
    const parsed = NewCharacterSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(bad(parsed.error));
    const invalid = rules.validateNewCharacter(parsed.data.scores);
    if (invalid) return reply.code(400).send({ error: invalid });
    if (campaign.mode === "solo" && store.getCharacters(campaignId).length > 0) {
      return reply.code(409).send({ error: "Solo campaigns have one hero." });
    }
    const maxHp = rules.startingMaxHp(parsed.data.scores);
    try {
      const character = store.createCharacter({
        campaignId, name: parsed.data.name, concept: parsed.data.concept, scores: parsed.data.scores,
        hp: maxHp, maxHp, items: parsed.data.items.map((i) => ({ ...i, qty: 1 })),
      });
      turns.broadcastSnapshot(campaignId);
      return { character };
    } catch (e) {
      if (e instanceof NameTakenError) return reply.code(409).send({ error: e.message });
      throw e;
    }
  });

  app.post<{ Params: { id: string } }>("/api/characters/:id/spend", async (req, reply) => {
    const character = store.getCharacter(Number(req.params.id));
    if (!character) return reply.code(404).send({ error: "No such character." });
    const parsed = SpendSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(bad(parsed.error));
    const result = rules.spendAbilityPoint(character, parsed.data.ability);
    if ("error" in result) return reply.code(400).send(result);
    store.saveCharacter(result.character);
    turns.broadcastSnapshot(character.campaignId);
    return { character: result.character };
  });

  app.post("/api/pack-up", async (_req, reply) => {
    const busy = store.listCampaigns().some((c) => (AI_PHASES as readonly string[]).includes(c.roundState));
    if (busy) return reply.code(409).send({ error: "The Dungeon Master is mid-sentence. Try again once the story settles." });
    try {
      await chat.unload();
      return { ok: true };
    } catch (e) {
      if (e instanceof OllamaError) return reply.code(503).send({ error: e.message });
      throw e;
    }
  });
}
```

```ts
// src/server/routes/ws.ts
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ClientMsg } from "../../shared/types";
import type { Hub } from "../realtime/hub";
import type { RulesEngine } from "../rules/engine";
import type { Store } from "../store/store";
import { buildSnapshot } from "../turns/snapshot";
import { GameError, type TurnService } from "../turns/turns";

const id = z.number().int();
export const ClientMsgSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("begin") }),
  z.object({ t: z.literal("action"), characterId: id, text: z.string() }),
  z.object({ t: z.literal("skip"), characterId: id, by: id }),
  z.object({ t: z.literal("roll"), characterId: id }),
  z.object({ t: z.literal("retry") }),
]) satisfies z.ZodType<ClientMsg>;

function dispatch(turns: TurnService, campaignId: number, msg: ClientMsg): Promise<void> {
  switch (msg.t) {
    case "begin": return turns.begin(campaignId);
    case "action": return turns.submitAction(campaignId, msg.characterId, msg.text);
    case "skip": return turns.skip(campaignId, msg.characterId, msg.by);
    case "roll": return turns.roll(campaignId, msg.characterId);
    case "retry": return turns.retry(campaignId);
  }
}

export async function registerWs(app: FastifyInstance, deps: { store: Store; rules: RulesEngine; turns: TurnService; hub: Hub }): Promise<void> {
  app.get<{ Querystring: { campaign?: string } }>("/ws", { websocket: true }, (socket, req) => {
    const campaignId = Number(req.query.campaign);
    const sendError = (message: string) => socket.send(JSON.stringify({ t: "error", message }));
    if (!deps.store.getCampaign(campaignId)) {
      sendError("No such campaign.");
      socket.close();
      return;
    }
    deps.hub.join(campaignId, socket);
    socket.send(JSON.stringify({ t: "snapshot", snapshot: buildSnapshot(deps.store, deps.rules, campaignId) }));

    socket.on("message", async (raw: Buffer) => {
      let msg: ClientMsg;
      try {
        msg = ClientMsgSchema.parse(JSON.parse(raw.toString()));
      } catch {
        sendError("That message didn't make sense.");
        return;
      }
      try {
        await dispatch(deps.turns, campaignId, msg);
      } catch (e) {
        if (e instanceof GameError) sendError(e.message);
        else { req.log.error(e); sendError("Something went wrong at the table."); }
      }
    });
    socket.on("close", () => deps.hub.leave(campaignId, socket));
  });
}
```

- [ ] **Step 5: Implement `app.ts` and `main.ts`**

```ts
// src/server/app.ts
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";
import { registerAuth } from "./auth/plugin";
import { loadAdventures } from "./campaigns/adventures";
import type { Config } from "./config";
import type { DungeonMaster } from "./dm/dm";
import type { ChatClient } from "./dm/ollama";
import { Hub } from "./realtime/hub";
import { registerApi } from "./routes/api";
import { registerWs } from "./routes/ws";
import { rollD20, type D20 } from "./rules/dice";
import { lightRules, type RulesEngine } from "./rules/engine";
import type { Store } from "./store/store";
import { TurnService } from "./turns/turns";

export interface AppDeps {
  config: Config; store: Store; dm: DungeonMaster; chat: ChatClient;
  rules?: RulesEngine; dice?: D20; serveClient?: boolean;
}

const CLIENT_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../dist/client");

export async function buildApp(deps: AppDeps): Promise<{ app: FastifyInstance; turns: TurnService; hub: Hub }> {
  const rules = deps.rules ?? lightRules;
  const hub = new Hub();
  const turns = new TurnService({ store: deps.store, rules, dm: deps.dm, hub, dice: deps.dice ?? rollD20 });
  const app = Fastify({ logger: deps.serveClient ? { level: "info" } : false });

  await registerAuth(app, { password: deps.config.tablePassword });
  await app.register(websocket);
  await registerApi(app, { store: deps.store, rules, dm: deps.dm, chat: deps.chat, turns, adventures: loadAdventures() });
  await registerWs(app, { store: deps.store, rules, turns, hub });

  if (deps.serveClient) {
    if (!existsSync(CLIENT_DIR)) throw new Error("No built client found. Run `npm run build` first.");
    await app.register(fastifyStatic, { root: CLIENT_DIR });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/api/")) return reply.sendFile("index.html");
      return reply.code(404).send({ error: "Not found" });
    });
  }
  return { app, turns, hub };
}
```

```ts
// src/server/main.ts
import { networkInterfaces } from "node:os";
import { buildApp } from "./app";
import { loadConfig } from "./config";
import { createDungeonMaster } from "./dm/dm";
import { createOllamaClient } from "./dm/ollama";
import { lightRules } from "./rules/engine";
import { createStore } from "./store/store";

try { process.loadEnvFile(); } catch { /* no .env file: rely on the environment */ }

const config = loadConfig();
const store = createStore(config.dbPath);
const chat = createOllamaClient({ url: config.ollamaUrl, model: config.ollamaModel, keepAlive: config.ollamaKeepAlive });
const dm = createDungeonMaster({ chat, rules: lightRules, budgetTokens: config.promptBudgetTokens });
const { app, turns } = await buildApp({ config, store, dm, chat, serveClient: process.env.NODE_ENV === "production" });

turns.recoverInterrupted();
await app.listen({ port: config.port, host: config.host });

const lan = Object.values(networkInterfaces()).flat()
  .filter((n) => n && n.family === "IPv4" && !n.internal)
  .map((n) => `  http://${n!.address}:${config.port}`);
console.log(`\n🕯  The table is open.\n  http://localhost:${config.port}\n${lan.join("\n")}\n  Dungeon Master: ${config.ollamaModel} at ${config.ollamaUrl}\n`);

const shutdown = async () => { await app.close(); store.close(); process.exit(0); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run`
Expected: all pass. Then run `npm run typecheck` and fix any type errors (typical: Fastify generic route typings).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: REST API, WebSocket play, pack-up endpoint and server entry"
```

---

### Task 11: Client foundation: Vite, theme, API, socket, gate, lobby, new campaign

**Files:**
- Create: `vite.config.ts`, `src/client/index.html`, `src/client/main.tsx`, `src/client/App.tsx`, `src/client/theme.css`, `src/client/lib/api.ts`, `src/client/lib/router.ts`, `src/client/lib/storage.ts`, `src/client/lib/useGameSocket.ts`, `src/client/lib/story.ts`, `src/client/screens/PasswordGate.tsx`, `src/client/screens/Lobby.tsx`, `src/client/screens/NewCampaign.tsx`
- Test: `tests/client/story.test.ts`

**Interfaces:**
- Consumes: shared types; REST/WS from Task 10.
- Produces: `api` object; `useHashRoute(): string[]`; `go(path)`; `getMyCharacter(campaignId)`, `setMyCharacter(campaignId, characterId)`; `useGameSocket(campaignId): { snapshot, streaming, error, connected, send }`; `buildStory(events, characters): StoryEntry[]`; `newItemNames(events, characterName, roundNumber): Set<string>`; `nameOf(characters, id)`; `isRoll(e): e is StoredRoll`.

- [ ] **Step 1: Write the failing test for the pure story helpers**

```ts
// tests/client/story.test.ts
import { describe, expect, it } from "vitest";
import { buildStory, newItemNames } from "../../src/client/lib/story";
import type { Character, StoredEvent } from "../../src/shared/types";

const chars = [{ id: 1, name: "Corvin" }, { id: 2, name: "Wren" }] as Character[];
let n = 0;
const ev = (round: number, e: object) => ({ id: ++n, campaignId: 1, round, createdAt: "", ...e }) as StoredEvent;

describe("buildStory", () => {
  it("turns events into readable entries, hiding bookkeeping", () => {
    const events = [
      ev(0, { type: "narration", text: "Fog." }),
      ev(1, { type: "action", characterId: 1, text: "I kick the door" }),
      ev(1, { type: "skip", characterId: 2, skippedBy: 1 }),
      ev(1, { type: "check_request", characterId: 1, ability: "STR", dc: 14, reason: "door" }),
      ev(1, { type: "roll", characterId: 1, ability: "STR", die: 15, dc: 14, modifier: 2, total: 17, success: true, crit: null }),
      ev(1, { type: "narration", text: "It opens." }),
      ev(1, { type: "op_applied", op: { op: "set_scene", title: "Hall" } }),
      ev(1, { type: "stall", phase: "resolving", error: "x" }),
    ];
    const story = buildStory(events, chars);
    expect(story.map((s) => s.kind)).toEqual(["narration", "action", "skip", "roll", "narration"]);
    expect(story[1]).toMatchObject({ name: "Corvin", text: "I kick the door" });
    expect(story[2]).toMatchObject({ text: "Corvin went ahead without Wren." });
    expect(story[3]).toMatchObject({ name: "Corvin" });
  });

  it("describes a self-skip", () => {
    const story = buildStory([ev(1, { type: "skip", characterId: 2, skippedBy: 2 })], chars);
    expect(story[0]).toMatchObject({ text: "Wren holds back this round." });
  });
});

describe("newItemNames", () => {
  it("lists items added to a character in the last resolved round", () => {
    const events = [
      ev(1, { type: "op_applied", op: { op: "add_item", character: "Corvin", name: "Old key", description: "", qty: 1 } }),
      ev(2, { type: "op_applied", op: { op: "add_item", character: "corvin", name: "Silver Locket", description: "", qty: 1 } }),
      ev(2, { type: "op_applied", op: { op: "add_item", character: "Wren", name: "Bow", description: "", qty: 1 } }),
    ];
    expect([...newItemNames(events, "Corvin", 3)]).toEqual(["silver locket"]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/client`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement `lib/story.ts`**

```ts
// src/client/lib/story.ts
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
```

Run: `npx vitest run tests/client`. Expected: pass.

- [ ] **Step 4: Vite config, HTML entry, main, theme**

```ts
// vite.config.ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "src/client",
  plugins: [react()],
  build: { outDir: "../../dist/client", emptyOutDir: true },
  server: {
    host: true,
    proxy: {
      "/api": "http://localhost:3000",
      "/ws": { target: "ws://localhost:3000", ws: true },
    },
  },
});
```

```html
<!-- src/client/index.html -->
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#1a120c" />
    <title>The Candlelit Table</title>
    <link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🕯️</text></svg>" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

```tsx
// src/client/main.tsx
import "@fontsource/cinzel/600.css";
import "@fontsource/spectral/400.css";
import "@fontsource/spectral/400-italic.css";
import "@fontsource/spectral/600.css";
import "./theme.css";
import { createRoot } from "react-dom/client";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(<App />);
```

(No `StrictMode`: its double effects would roll the 3D dice twice in development.)

```css
/* src/client/theme.css */
:root {
  --bg: #1a120c; --bg-glow: #3a2516; --panel: #2b1d12; --panel-deep: #120c07;
  --border: #6b4a24; --border-soft: #3a2818; --text: #ead9b8; --muted: #b89c74; --faint: #7d6748;
  --gold: #e0a84a; --gold-bright: #ffd27a; --hp-from: #9b2a1e; --hp-to: #d4553a;
  --success: #8fbf7a; --danger: #d4553a;
  --font-display: "Cinzel", Georgia, serif; --font-body: "Spectral", Georgia, serif;
  --radius: 8px;
  color-scheme: dark;
}
* { box-sizing: border-box; }
html, body, #root { min-height: 100%; margin: 0; }
body {
  background: var(--bg) radial-gradient(ellipse at 30% 0%, var(--bg-glow) 0, var(--bg) 65%) fixed;
  color: var(--text); font: 17px/1.6 var(--font-body); -webkit-font-smoothing: antialiased;
}
h1, h2, h3 { font-family: var(--font-display); font-weight: 600; color: var(--gold-bright); letter-spacing: .04em; margin: 0 0 .4em; line-height: 1.25; }
h1 { font-size: clamp(1.6rem, 4vw, 2.2rem); }
a { color: var(--gold); }
button { font: inherit; cursor: pointer; }
.gold { color: var(--gold-bright); }
.muted { color: var(--muted); }
.small { font-size: .85rem; }
.error { color: var(--danger); margin: .5rem 0 0; }
.ok { color: var(--success); }
.fail { color: var(--danger); }
.eyebrow { font-family: var(--font-display); font-size: .8rem; letter-spacing: .18em; color: var(--gold); text-transform: uppercase; margin: 0; }
.page { max-width: 880px; margin: 0 auto; padding: 2rem 16px 4rem; }
.stack > * + * { margin-top: 1rem; }
.row { display: flex; gap: .75rem; align-items: center; flex-wrap: wrap; }
.spread { justify-content: space-between; }
.panel { background: rgba(43, 29, 18, .72); border: 1px solid var(--border-soft); border-radius: 12px; padding: 1.25rem; }

.btn { background: var(--panel); color: var(--text); border: 1px solid var(--border); border-radius: var(--radius); padding: .55em 1.1em; transition: box-shadow .2s, border-color .2s, color .2s; }
.btn:hover:not(:disabled), .btn:focus-visible { border-color: var(--gold); box-shadow: 0 0 14px rgba(224, 168, 74, .25); outline: none; }
.btn:disabled { opacity: .45; cursor: default; }
.btn[aria-pressed="true"] { border-color: var(--gold); color: var(--gold-bright); box-shadow: 0 0 16px rgba(224, 168, 74, .3); }
.btn-primary { background: linear-gradient(180deg, #c98e34, #9c6a22); color: #1a120c; border-color: var(--gold-bright); font-weight: 600; }
.btn-ghost { background: transparent; border-color: var(--border-soft); color: var(--muted); }

.input { width: 100%; background: var(--panel-deep); color: var(--text); border: 1px solid #4a3218; border-radius: var(--radius); padding: .6em .8em; font: inherit; resize: vertical; }
.input:focus { outline: none; border-color: var(--gold); box-shadow: 0 0 0 3px rgba(224, 168, 74, .15); }
label.stack > span { color: var(--muted); font-size: .9rem; }

.grid-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 1rem; }
.card-choice { text-align: left; color: inherit; font: inherit; cursor: pointer; transition: border-color .2s, box-shadow .2s; }
.card-choice[aria-pressed="true"], .card-choice:hover { border-color: var(--gold); box-shadow: 0 0 18px rgba(224, 168, 74, .25); }
.card-choice p { margin: 0; }

.gate { display: grid; place-items: center; min-height: 100dvh; }
.gate form { width: min(420px, 100%); text-align: center; }

/* Play screen */
.play { display: grid; grid-template-columns: 1fr 340px; height: 100dvh; }
.play-main { display: flex; flex-direction: column; min-height: 0; min-width: 0; }
.play-header { display: flex; align-items: center; gap: 1rem; padding: .8rem 1.5rem; border-bottom: 1px solid var(--border-soft); }
.play-header a { text-decoration: none; }
.dot { width: 10px; height: 10px; border-radius: 50%; background: var(--danger); }
.dot.ok { background: var(--success); box-shadow: 0 0 8px var(--success); }
.story { flex: 1; overflow-y: auto; padding: 1.5rem; }
.story-inner { max-width: 720px; margin: 0 auto; }
.narration { margin: 0 0 1.1em; white-space: pre-wrap; }
.story-inner > .narration:first-child::first-letter { font-family: var(--font-display); font-size: 2.6em; float: left; line-height: .9; margin: .05em .12em 0 0; color: var(--gold); }
.action-line { font-style: italic; color: var(--muted); margin: 0 0 .8em; }
.action-line b { color: var(--gold); font-style: normal; }
.roll-chip { display: inline-flex; gap: .5em; align-items: center; background: var(--panel); border: 1px solid var(--border); border-radius: 6px; padding: .3em .8em; margin: 0 0 1em; box-shadow: 0 0 18px rgba(224, 168, 74, .2); font-size: .95rem; }
.roll-chip .die-glyph { color: var(--gold); font-size: 1.2em; }
.caret::after { content: "▍"; animation: blink 1s steps(2) infinite; color: var(--gold); }
@keyframes blink { 50% { opacity: 0; } }
.action-bar { border-top: 1px solid var(--border-soft); padding: 1rem 1.5rem calc(1rem + env(safe-area-inset-bottom)); background: rgba(18, 12, 7, .65); }
.thinking { font-style: italic; color: var(--muted); animation: flicker 2.4s ease-in-out infinite; margin: 0; }
@keyframes flicker { 0%, 100% { opacity: .55; } 50% { opacity: 1; } }
.ready { font-size: .9rem; color: var(--muted); margin: 0; display: flex; gap: 1rem; }
.ready .done { color: var(--success); }
.roll-btn { font-family: var(--font-display); font-size: 1.15rem; padding: .65em 1.5em; animation: glow 1.6s ease-in-out infinite; }
@keyframes glow { 50% { box-shadow: 0 0 26px rgba(255, 210, 122, .55); } }

/* Character sheet */
.sheet { background: rgba(0, 0, 0, .25); border-left: 1px solid var(--border-soft); overflow-y: auto; padding: 1.25rem; }
.sheet h2 { font-size: 1.3rem; margin: 0; }
.hp-bar { height: 10px; background: var(--panel); border-radius: 5px; overflow: hidden; }
.hp-bar.thin { height: 6px; }
.hp-bar > div { height: 100%; background: linear-gradient(90deg, var(--hp-from), var(--hp-to)); transition: width .8s ease; }
.abilities { display: grid; grid-template-columns: repeat(3, 1fr); gap: .5rem; margin: 1rem 0; }
.ability { background: var(--panel); border: 1px solid transparent; border-radius: 6px; padding: .4rem; text-align: center; font-size: .75rem; color: var(--muted); font-family: inherit; }
.ability:disabled { opacity: 1; cursor: default; }
.ability b { display: block; font-size: 1.3rem; color: var(--text); line-height: 1.2; }
.ability small { color: var(--gold); font-size: .8rem; }
.ability[data-spendable="true"] { border-color: var(--gold); animation: glow 1.6s ease-in-out infinite; }
.inventory { list-style: none; padding: 0; margin: 0; }
.inventory li { padding: .35rem 0; border-bottom: 1px solid var(--border-soft); }
.item-new { color: var(--gold-bright); text-shadow: 0 0 10px rgba(255, 210, 122, .6); }
.badge-new { font-size: .7rem; color: var(--gold-bright); margin-left: .4em; }
.party-card { padding: .5rem 0; }
.sheet-toggle { display: none; }

/* Point buy */
.pointbuy { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: .5rem; }
.pointbuy .stepper { justify-content: center; gap: .25rem; margin-top: .3rem; }
.pointbuy .stepper .btn { padding: .1em .7em; }

@media (max-width: 899px) {
  .play { grid-template-columns: 1fr; }
  .sheet { position: fixed; inset: 0 0 0 auto; width: min(88vw, 360px); transform: translateX(100%); transition: transform .25s ease; z-index: 20; background: #1f150d; }
  .sheet.open { transform: none; box-shadow: -10px 0 40px rgba(0, 0, 0, .6); }
  .sheet-toggle { display: inline-flex; }
  .story, .action-bar, .play-header { padding-left: 16px; padding-right: 16px; }
}

/* Dice */
#dice-stage { position: fixed; inset: 0; pointer-events: none; z-index: 50; opacity: 0; transition: opacity .3s; }
#dice-stage.active { opacity: 1; }
.dice-overlay { position: fixed; inset: 0; z-index: 51; pointer-events: none; display: grid; place-items: center; }
.dice-overlay.rolling { background: rgba(10, 6, 3, .35); }
.dice-result { background: rgba(26, 18, 12, .94); border: 1px solid var(--border); border-radius: 14px; padding: 1.1rem 2rem; text-align: center; box-shadow: 0 0 40px rgba(224, 168, 74, .35); animation: pop .35s ease-out; margin-top: 35vh; }
.dice-name { font-family: var(--font-display); color: var(--gold); letter-spacing: .1em; font-size: .85rem; text-transform: uppercase; }
.dice-total { font-family: var(--font-display); font-size: 1.5rem; }
.dice-total .die { color: var(--gold-bright); font-size: 2.2rem; }
.dice-result.nat20 { border-color: var(--gold-bright); animation: pop .35s ease-out, goldburst 1.4s ease-out; }
.dice-result.nat1 { border-color: var(--danger); animation: pop .35s ease-out, shake .5s .35s; }
@keyframes pop { from { transform: scale(.7); opacity: 0; } }
@keyframes goldburst { 0% { box-shadow: 0 0 0 rgba(255, 210, 122, .9); } 40% { box-shadow: 0 0 140px 50px rgba(255, 210, 122, .55); } 100% { box-shadow: 0 0 40px rgba(224, 168, 74, .35); } }
@keyframes shake { 20%, 60% { transform: translateX(-8px); } 40%, 80% { transform: translateX(8px); } }
.fallback-die { width: 120px; height: 120px; animation: tumble 1.2s cubic-bezier(.2, .7, .3, 1); filter: drop-shadow(0 0 18px rgba(224, 168, 74, .5)); }
@keyframes tumble { from { transform: translate(-40vw, -20vh) rotate(-720deg) scale(.6); } to { transform: none; } }
@media (prefers-reduced-motion: reduce) { .fallback-die, .dice-result, .roll-btn, .thinking, .ability[data-spendable="true"] { animation: none !important; } }
```

- [ ] **Step 5: API, router, storage, socket hook**

```ts
// src/client/lib/api.ts
import type {
  AdventureInfo, Campaign, CampaignSummary, Character, KitItem, NewCampaignRequest, NewCharacterRequest, Preset, Snapshot, Ability,
} from "../../shared/types";

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function request<T>(method: "GET" | "POST", url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (res.status === 401 && url !== "/api/login") {
    location.reload(); // signed out (e.g. password changed): show the gate again
  }
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  session: () => request<{ authed: boolean }>("GET", "/api/session"),
  login: (password: string) => request<{ ok: true }>("POST", "/api/login", { password }),
  presets: () => request<{ presets: Preset[]; adventures: AdventureInfo[] }>("GET", "/api/presets"),
  campaigns: () => request<{ campaigns: CampaignSummary[] }>("GET", "/api/campaigns"),
  createCampaign: (body: NewCampaignRequest) => request<{ campaign: Campaign }>("POST", "/api/campaigns", body),
  snapshot: (id: number) => request<{ snapshot: Snapshot }>("GET", `/api/campaigns/${id}`),
  kit: (body: { campaignId: number; name: string; concept: string }) => request<{ items: KitItem[] }>("POST", "/api/kit", body),
  createCharacter: (campaignId: number, body: NewCharacterRequest) =>
    request<{ character: Character }>("POST", `/api/campaigns/${campaignId}/characters`, body),
  spendPoint: (characterId: number, ability: Ability) =>
    request<{ character: Character }>("POST", `/api/characters/${characterId}/spend`, { ability }),
  packUp: () => request<{ ok: true }>("POST", "/api/pack-up"),
};
```

```ts
// src/client/lib/router.ts
import { useEffect, useState } from "react";

export function useHashRoute(): string[] {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);
  return hash.replace(/^#\/?/, "").split("/").filter(Boolean);
}

export const go = (path: string) => { location.hash = path; };
```

```ts
// src/client/lib/storage.ts
const key = (campaignId: number) => `adm.character.${campaignId}`;

/** Which hero this device plays in a campaign. Per-device convenience only. */
export function getMyCharacter(campaignId: number): number | null {
  try {
    const v = localStorage.getItem(key(campaignId));
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}

export function setMyCharacter(campaignId: number, characterId: number): void {
  try { localStorage.setItem(key(campaignId), String(characterId)); } catch { /* private mode: they'll pick again */ }
}
```

```ts
// src/client/lib/useGameSocket.ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMsg, ServerMsg, Snapshot } from "../../shared/types";

export function useGameSocket(campaignId: number) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [streaming, setStreaming] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let closed = false;
    let retry = 0;
    let timer: number | undefined;
    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/ws?campaign=${campaignId}`);
      wsRef.current = ws;
      ws.onopen = () => { retry = 0; setConnected(true); setError(null); };
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data as string) as ServerMsg;
        switch (msg.t) {
          case "snapshot": {
            setSnapshot(msg.snapshot);
            const s = msg.snapshot.campaign.roundState;
            if (s !== "opening" && s !== "resolving") setStreaming("");
            break;
          }
          case "narration_chunk": setStreaming((t) => t + msg.text); break;
          case "narration_reset": setStreaming(""); break;
          case "error": setError(msg.message); break;
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (closed) return;
        timer = window.setTimeout(connect, Math.min(10_000, 500 * 2 ** retry++));
      };
    };
    connect();
    return () => { closed = true; clearTimeout(timer); wsRef.current?.close(); };
  }, [campaignId]);

  const send = useCallback((msg: ClientMsg) => {
    setError(null);
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    else setError("Reconnecting to the table…");
  }, []);

  return { snapshot, streaming, error, connected, send };
}
```

- [ ] **Step 6: App shell and the first three screens**

```tsx
// src/client/App.tsx
import { useEffect, useState } from "react";
import { api } from "./lib/api";
import { useHashRoute } from "./lib/router";
import { CreateCharacter } from "./screens/CreateCharacter";
import { Lobby } from "./screens/Lobby";
import { NewCampaign } from "./screens/NewCampaign";
import { PasswordGate } from "./screens/PasswordGate";
import { Play } from "./screens/Play";

export function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const route = useHashRoute();
  useEffect(() => { api.session().then((s) => setAuthed(s.authed)).catch(() => setAuthed(false)); }, []);

  if (authed === null) return <main className="page muted">Lighting the candles…</main>;
  if (!authed) return <PasswordGate onUnlocked={() => setAuthed(true)} />;

  let screen;
  if (route[0] === "new") screen = <NewCampaign />;
  else if (route[0] === "c" && route[2] === "join") screen = <CreateCharacter campaignId={Number(route[1])} />;
  else if (route[0] === "c" && route[1]) screen = <Play key={route[1]} campaignId={Number(route[1])} />;
  else screen = <Lobby />;

  return <>{screen}<div id="dice-stage" /></>;
}
```

Until Tasks 12–13 exist, create `CreateCharacter.tsx` and `Play.tsx` as minimal placeholders that render `<main className="page">Coming soon</main>`, so the app compiles. Tasks 12 and 13 replace them.

```tsx
// src/client/screens/PasswordGate.tsx
import { useState, type FormEvent } from "react";
import { api } from "../lib/api";

export function PasswordGate({ onUnlocked }: { onUnlocked: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      onUnlocked();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page gate">
      <form className="panel stack" onSubmit={submit}>
        <p className="eyebrow">A table for adventurers</p>
        <h1>Speak, friend, and enter</h1>
        <input className="input" type="password" autoFocus autoComplete="current-password" aria-label="Table password"
          placeholder="Table password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary" disabled={busy || !password}>{busy ? "Opening…" : "Enter"}</button>
      </form>
    </main>
  );
}
```

```tsx
// src/client/screens/Lobby.tsx
import { useEffect, useState } from "react";
import type { CampaignSummary } from "../../shared/types";
import { api } from "../lib/api";
import { go } from "../lib/router";
import { getMyCharacter } from "../lib/storage";

export function Lobby() {
  const [campaigns, setCampaigns] = useState<CampaignSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [packNote, setPackNote] = useState<string | null>(null);
  const [packing, setPacking] = useState(false);

  useEffect(() => { api.campaigns().then((r) => setCampaigns(r.campaigns)).catch((e) => setError(e.message)); }, []);

  async function packUp() {
    setPacking(true);
    setPackNote(null);
    try {
      await api.packUp();
      setPackNote("The Dungeon Master has gone home for the night. Memory freed; the next turn will take a little longer to start.");
    } catch (e) {
      setPackNote((e as Error).message);
    } finally {
      setPacking(false);
    }
  }

  return (
    <main className="page stack">
      <header className="row spread">
        <div><p className="eyebrow">The Tavern</p><h1>Your campaigns</h1></div>
        <button className="btn btn-primary" onClick={() => go("/new")}>New campaign</button>
      </header>
      {error && <p className="error">{error}</p>}
      {campaigns?.length === 0 && <p className="muted">No tales yet. Start one!</p>}
      <div className="grid-cards">
        {campaigns?.map((c) => {
          const mine = getMyCharacter(c.id);
          return (
            <article key={c.id} className="panel stack">
              <div>
                <h3>{c.title}</h3>
                <p className="muted small">{c.mode === "solo" ? "Solo" : "Party"} · {c.sceneTitle || "Not yet begun"}</p>
                <p className="muted small">{c.characterNames.join(", ") || "No heroes yet"}</p>
              </div>
              <div className="row">
                {mine
                  ? <button className="btn btn-primary" onClick={() => go(`/c/${c.id}`)}>Continue</button>
                  : <button className="btn btn-primary" onClick={() => go(`/c/${c.id}/join`)}>Join</button>}
                {mine && <button className="btn btn-ghost" onClick={() => go(`/c/${c.id}/join`)}>Switch hero</button>}
              </div>
            </article>
          );
        })}
      </div>
      <footer className="row spread" style={{ marginTop: "3rem" }}>
        <p className="muted small" style={{ flex: 1, margin: 0 }}>{packNote ?? "Done for the evening? Free up the computer's memory."}</p>
        <button className="btn btn-ghost" onClick={packUp} disabled={packing}>{packing ? "Packing up…" : "🕯 Pack up for the night"}</button>
      </footer>
    </main>
  );
}
```

```tsx
// src/client/screens/NewCampaign.tsx
import { useEffect, useState } from "react";
import type { AdventureInfo, CampaignSource, Mode, Preset } from "../../shared/types";
import { api } from "../lib/api";
import { go } from "../lib/router";

type Kind = CampaignSource["kind"];
const KINDS: [Kind, string][] = [["preset", "Choose a setting"], ["pitch", "Write your own"], ["adventure", "Prepared adventure"]];

export function NewCampaign() {
  const [mode, setMode] = useState<Mode>("party");
  const [kind, setKind] = useState<Kind>("preset");
  const [presetId, setPresetId] = useState("");
  const [adventureId, setAdventureId] = useState("");
  const [pitch, setPitch] = useState("");
  const [title, setTitle] = useState("");
  const [data, setData] = useState<{ presets: Preset[]; adventures: AdventureInfo[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.presets().then((d) => {
      setData(d);
      setPresetId(d.presets[0]?.id ?? "");
      setAdventureId(d.adventures[0]?.id ?? "");
    }).catch((e) => setError(e.message));
  }, []);

  const source: CampaignSource = kind === "preset" ? { kind, presetId } : kind === "adventure" ? { kind, adventureId } : { kind, pitch };
  const ready = kind === "pitch" ? pitch.trim().length >= 10 : kind === "preset" ? !!presetId : !!adventureId;

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const { campaign } = await api.createCampaign({ mode, title: title.trim() || undefined, source });
      go(`/c/${campaign.id}/join`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="page stack">
      <a href="#/">← Back to the tavern</a>
      <h1>A new tale</h1>

      <section className="stack">
        <h3>Who's playing?</h3>
        <div className="row">
          <button className="btn" aria-pressed={mode === "party"} onClick={() => setMode("party")}>Party: play together</button>
          <button className="btn" aria-pressed={mode === "solo"} onClick={() => setMode("solo")}>Solo</button>
        </div>
      </section>

      <section className="stack">
        <h3>Where does it begin?</h3>
        <div className="row">
          {KINDS.map(([k, label]) => (
            <button key={k} className="btn btn-ghost" aria-pressed={kind === k} onClick={() => setKind(k)}>{label}</button>
          ))}
        </div>
        {kind === "preset" && (
          <div className="grid-cards">
            {data?.presets.map((p) => (
              <button key={p.id} className="panel card-choice" aria-pressed={presetId === p.id} onClick={() => setPresetId(p.id)}>
                <h3>{p.name}</h3><p className="muted">{p.blurb}</p>
              </button>
            ))}
          </div>
        )}
        {kind === "pitch" && (
          <textarea className="input" rows={4} maxLength={1000} value={pitch} onChange={(e) => setPitch(e.target.value)}
            placeholder="e.g. Two smugglers wake on a ghost ship drifting toward a city that vanished a hundred years ago." />
        )}
        {kind === "adventure" && (
          <div className="grid-cards">
            {data?.adventures.map((a) => (
              <button key={a.id} className="panel card-choice" aria-pressed={adventureId === a.id} onClick={() => setAdventureId(a.id)}>
                <h3>{a.title}</h3><p className="muted">{a.pitch}</p>
              </button>
            ))}
          </div>
        )}
      </section>

      <label className="stack">
        <span>Title (optional)</span>
        <input className="input" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>

      {error && <p className="error">{error}</p>}
      <button className="btn btn-primary" disabled={!ready || busy} onClick={create}>{busy ? "Preparing…" : "Create campaign"}</button>
    </main>
  );
}
```

- [ ] **Step 7: Verify in the browser**

Run, in two terminals: `TABLE_PASSWORD=dragon npm run dev` and `npm run dev:client`. Open the Vite URL (http://localhost:5173). Check:
- A wrong password shows "That's not the password."; the right one shows the lobby.
- New campaign: all three source tabs work; a pitch under 10 characters keeps Create disabled; creating navigates to `#/c/<id>/join` (the placeholder for now).
- "Pack up for the night" with Ollama not running shows the "Could not reach Ollama" message.
- At 390 px wide (devtools phone mode) nothing overflows horizontally.

Run `npm run typecheck` and `npx vitest run`. Both clean.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: client shell, Candlelit Tavern theme, gate, lobby and new campaign"
```

---

### Task 12: Character creation screen

**Files:**
- Modify (replace placeholder): `src/client/screens/CreateCharacter.tsx`

**Interfaces:**
- Consumes: `api.snapshot`, `api.kit`, `api.createCharacter`; `baseScores`, `pointBuyCost`, `POINT_BUY_BUDGET`, `modifier`, `formatModifier`, `maxHpFor`; `setMyCharacter`; `go`.

- [ ] **Step 1: Implement**

```tsx
// src/client/screens/CreateCharacter.tsx
import { useEffect, useState } from "react";
import { baseScores, formatModifier, maxHpFor, modifier, pointBuyCost, POINT_BUY_BUDGET } from "../../shared/abilities";
import { ABILITIES, type Ability, type KitItem, type Scores, type Snapshot } from "../../shared/types";
import { api } from "../lib/api";
import { go } from "../lib/router";
import { setMyCharacter } from "../lib/storage";

export function CreateCharacter({ campaignId }: { campaignId: number }) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [name, setName] = useState("");
  const [concept, setConcept] = useState("");
  const [scores, setScores] = useState<Scores>(baseScores());
  const [kit, setKit] = useState<KitItem[] | null>(null);
  const [kitBusy, setKitBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { api.snapshot(campaignId).then((r) => setSnap(r.snapshot)).catch((e) => setError(e.message)); }, [campaignId]);

  const left = POINT_BUY_BUDGET - (pointBuyCost(scores) ?? 0);
  const stepped = (a: Ability, d: 1 | -1): Scores | null => {
    const next = { ...scores, [a]: scores[a] + d };
    const cost = pointBuyCost(next);
    return cost === null || cost > POINT_BUY_BUDGET ? null : next;
  };
  const named = name.trim() !== "" && concept.trim() !== "";
  const soloTaken = snap?.campaign.mode === "solo" && snap.characters.length > 0;

  function playAs(characterId: number) {
    setMyCharacter(campaignId, characterId);
    go(`/c/${campaignId}`);
  }

  async function suggestKit() {
    setKitBusy(true);
    setError(null);
    try {
      setKit((await api.kit({ campaignId, name: name.trim(), concept: concept.trim() })).items);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setKitBusy(false);
    }
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const { character } = await api.createCharacter(campaignId, { name: name.trim(), concept: concept.trim(), scores, items: kit ?? [] });
      playAs(character.id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="page stack">
      <a href="#/">← Back to the tavern</a>
      <p className="eyebrow">{snap?.campaign.title ?? "…"}</p>

      {snap && snap.characters.length > 0 && (
        <section className="panel stack">
          <h3>Play as an existing hero</h3>
          <div className="row">
            {snap.characters.map((c) => (
              <button key={c.id} className="btn" onClick={() => playAs(c.id)}>{c.name} <span className="muted">· {c.concept}</span></button>
            ))}
          </div>
        </section>
      )}

      {snap && !soloTaken && (
        <section className="panel stack">
          <h2>Create a hero</h2>
          <label className="stack"><span>Name</span>
            <input className="input" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="stack"><span>Concept</span>
            <input className="input" maxLength={120} value={concept} placeholder="e.g. disgraced knight seeking redemption" onChange={(e) => setConcept(e.target.value)} />
          </label>

          <div className="stack">
            <div className="row spread">
              <h3 style={{ margin: 0 }}>Abilities</h3>
              <span className={left === 0 ? "muted" : "gold"}>{left} of {POINT_BUY_BUDGET} points left</span>
            </div>
            <div className="pointbuy">
              {ABILITIES.map((a) => (
                <div key={a} className="ability">
                  {a}<b>{scores[a]}</b><small>{formatModifier(modifier(scores[a]))}</small>
                  <div className="row stepper">
                    <button className="btn btn-ghost" aria-label={`Lower ${a}`} disabled={!stepped(a, -1)} onClick={() => setScores(stepped(a, -1)!)}>−</button>
                    <button className="btn btn-ghost" aria-label={`Raise ${a}`} disabled={!stepped(a, 1)} onClick={() => setScores(stepped(a, 1)!)}>+</button>
                  </div>
                </div>
              ))}
            </div>
            <p className="muted small" style={{ margin: 0 }}>Max HP {maxHpFor(scores.CON, 1)} (from CON). Scores range 8–15 at creation.</p>
          </div>

          <div className="stack">
            <div className="row spread">
              <h3 style={{ margin: 0 }}>Starting kit</h3>
              <button className="btn" disabled={!named || kitBusy} onClick={suggestKit}>{kitBusy ? "Packing…" : kit ? "Suggest another" : "Suggest a kit"}</button>
            </div>
            {!kit && <p className="muted small" style={{ margin: 0 }}>Name your hero and describe them, then let the Dungeon Master pack their bag.</p>}
            {kit && <ul className="inventory">{kit.map((i) => <li key={i.name}><b>{i.name}</b>: <span className="muted">{i.description}</span></li>)}</ul>}
          </div>

          {error && <p className="error">{error}</p>}
          <button className="btn btn-primary" disabled={!named || busy} onClick={create}>{busy ? "Creating…" : "Begin as this hero"}</button>
        </section>
      )}
      {!snap && error && <p className="error">{error}</p>}
    </main>
  );
}
```

- [ ] **Step 2: Verify in the browser**

With both dev servers and Ollama running (`ollama serve`; `ollama pull qwen3.6:27b` if you haven't), check:
- The steppers can't exceed 27 points or leave the 8–15 range. "points left" updates, and Max HP changes with CON.
- "Suggest a kit" returns 3–5 items within ~30 s. With Ollama stopped it shows "couldn't pack a kit".
- Creating a hero navigates to `#/c/<id>` (placeholder). The lobby now shows "Continue".
- A duplicate name shows the 409 message. A second hero in a solo campaign isn't offered.

`npm run typecheck` clean.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat: character creation with 5e point buy and suggested kit"
```

---

### Task 13: Play screen: story, action bar, character sheet

**Files:**
- Modify (replace placeholder): `src/client/screens/Play.tsx`
- Create: `src/client/components/Story.tsx`, `src/client/components/ActionBar.tsx`, `src/client/components/CharacterSheet.tsx`
- Create (stub, finished in Task 14): `src/client/components/DiceOverlay.tsx` exporting `DiceOverlay` that calls `onDone()` after 1500 ms and renders the result card

**Interfaces:**
- Consumes: `useGameSocket`, `buildStory`, `newItemNames`, `nameOf`, `isRoll`, `getMyCharacter`, `api.spendPoint`.
- Produces: `<DiceOverlay roll={StoredRoll} name={string} onDone={() => void} />` (contract Task 14 fulfils).

- [ ] **Step 1: Story component**

```tsx
// src/client/components/Story.tsx
import { formatModifier } from "../../shared/abilities";
import type { StoryEntry } from "../lib/story";

export function Story({ entries, streaming }: { entries: StoryEntry[]; streaming: string }) {
  return (
    <>
      {entries.map((e) => {
        switch (e.kind) {
          case "narration": return <p key={e.id} className="narration">{e.text}</p>;
          case "action": return <p key={e.id} className="action-line"><b>{e.name}</b> {e.text}</p>;
          case "skip": return <p key={e.id} className="action-line">{e.text}</p>;
          case "roll": {
            const r = e.roll;
            return (
              <div key={e.id}>
                <span className="roll-chip">
                  <span className="die-glyph" aria-hidden>⚄</span>
                  {e.name} · {r.ability} DC {r.dc} · {r.die} {formatModifier(r.modifier)} = <b>{r.total}</b>
                  <span className={r.success ? "ok" : "fail"}>{r.crit === "nat20" ? "Natural 20!" : r.crit === "nat1" ? "Natural 1" : r.success ? "success" : "failure"}</span>
                </span>
              </div>
            );
          }
        }
      })}
      {streaming && <p className="narration caret">{streaming}</p>}
    </>
  );
}
```

- [ ] **Step 2: Action bar**

```tsx
// src/client/components/ActionBar.tsx
import { useEffect, useState, type ReactNode } from "react";
import type { Character, ClientMsg, Snapshot } from "../../shared/types";
import { nameOf } from "../lib/story";

interface Props { snapshot: Snapshot; me: Character | null; campaignId: number; error: string | null; send: (m: ClientMsg) => void }

export function ActionBar({ snapshot, me, campaignId, error, send }: Props) {
  const { campaign, characters, round, activeIds } = snapshot;
  const [text, setText] = useState("");
  useEffect(() => setText(""), [campaign.roundNumber]);

  const name = (id: number) => nameOf(characters, id);
  const responded = (id: number) => round.actions.some((a) => a.characterId === id) || round.skippedIds.includes(id);
  const readyLine = (
    <p className="ready">
      {activeIds.map((id) => <span key={id} className={responded(id) ? "done" : ""}>{name(id)} {responded(id) ? "✓" : "…"}</span>)}
    </p>
  );

  let body: ReactNode;
  if (!me) {
    body = <p style={{ margin: 0 }}>You're watching. <a href={`#/c/${campaignId}/join`}>Join with a hero</a> to play.</p>;
  } else {
    switch (campaign.roundState) {
      case "lobby":
        body = (
          <div className="row">
            <p className="muted" style={{ flex: 1, margin: 0 }}>At the table: {characters.map((c) => c.name).join(", ")}. Begin when everyone has joined.</p>
            <button className="btn btn-primary" onClick={() => send({ t: "begin" })}>Begin the adventure</button>
          </div>
        );
        break;
      case "opening":
      case "adjudicating":
      case "resolving":
        body = <p className="thinking">The Dungeon Master is weaving the tale…</p>;
        break;
      case "stalled":
        body = (
          <div className="row">
            <p className="thinking" style={{ flex: 1 }}>The Dungeon Master pauses, lost in thought…</p>
            <button className="btn btn-primary" onClick={() => send({ t: "retry" })}>Try again</button>
          </div>
        );
        break;
      case "awaiting_rolls":
        body = (
          <div className="stack">
            {round.checks.map((ch) => (
              <div key={ch.characterId} className="row">
                <span style={{ flex: 1 }}>
                  <b className="gold">{name(ch.characterId)}</b>: {ch.ability} check, DC {ch.dc} <span className="muted">({ch.reason})</span>
                </span>
                {ch.roll
                  ? <span className={ch.roll.success ? "ok" : "fail"}>{ch.roll.total} {ch.roll.success ? "✓" : "✗"}</span>
                  : ch.characterId === me.id
                    ? <button className="btn btn-primary roll-btn" onClick={() => send({ t: "roll", characterId: ch.characterId })}>Roll d20</button>
                    : <button className="btn btn-ghost" onClick={() => send({ t: "roll", characterId: ch.characterId })}>Roll for {name(ch.characterId)}</button>}
              </div>
            ))}
          </div>
        );
        break;
      case "collecting": {
        const meActive = activeIds.includes(me.id);
        const waitingOn = activeIds.filter((id) => id !== me.id && !responded(id));
        const canGoAhead = activeIds.some((id) => id !== me.id && !round.skippedIds.includes(id));
        if (!meActive) {
          body = <div className="stack">{readyLine}<p className="muted" style={{ margin: 0 }}>{me.name} is down and can't act until healed.</p></div>;
        } else if (!responded(me.id)) {
          body = (
            <form className="stack" onSubmit={(e) => { e.preventDefault(); if (text.trim()) send({ t: "action", characterId: me.id, text }); }}>
              {campaign.mode === "party" && readyLine}
              <textarea className="input" rows={2} maxLength={1000} value={text} placeholder={`What does ${me.name} do?`}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} />
              <div className="row">
                <button className="btn btn-primary" disabled={!text.trim()}>Act</button>
                {canGoAhead && <button type="button" className="btn btn-ghost" onClick={() => send({ t: "skip", characterId: me.id, by: me.id })}>Go ahead without me</button>}
              </div>
            </form>
          );
        } else {
          body = (
            <div className="stack">
              {readyLine}
              <div className="row">
                {waitingOn.map((id) => (
                  <button key={id} className="btn btn-ghost" onClick={() => send({ t: "skip", characterId: id, by: me.id })}>Don't wait for {name(id)}</button>
                ))}
              </div>
            </div>
          );
        }
        break;
      }
    }
  }
  return <div className="action-bar">{body}{error && <p className="error">{error}</p>}</div>;
}
```

- [ ] **Step 3: Character sheet**

```tsx
// src/client/components/CharacterSheet.tsx
import { useState } from "react";
import { formatModifier, modifier } from "../../shared/abilities";
import { ABILITIES, type Ability, type Character, type Snapshot } from "../../shared/types";
import { api } from "../lib/api";
import { newItemNames } from "../lib/story";

interface Props { snapshot: Snapshot; me: Character | null; open: boolean; onClose: () => void }

const pct = (c: Character) => `${Math.max(0, Math.min(100, (c.hp / c.maxHp) * 100))}%`;

export function CharacterSheet({ snapshot, me, open, onClose }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const others = snapshot.characters.filter((c) => c.id !== me?.id);
  const fresh = me ? newItemNames(snapshot.events, me.name, snapshot.campaign.roundNumber) : new Set<string>();

  async function spend(a: Ability) {
    if (!me) return;
    setBusy(true);
    setError(null);
    try { await api.spendPoint(me.id, a); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <aside className={`sheet ${open ? "open" : ""}`} aria-label="Character sheet">
      <div className="row spread"><span /><button className="btn btn-ghost sheet-toggle" onClick={onClose}>Close</button></div>
      {me ? (
        <section className="stack">
          <div>
            <h2>{me.name}</h2>
            <p className="muted" style={{ margin: 0 }}><i>{me.concept}</i> · Level {me.level}</p>
          </div>
          <div>
            <div className="row spread small"><span>HP</span><span>{me.hp} / {me.maxHp}{me.hp <= 0 && <b className="fail"> · DOWN</b>}</span></div>
            <div className="hp-bar"><div style={{ width: pct(me) }} /></div>
          </div>
          {me.pendingAbilityPoints > 0 && <p className="gold" style={{ margin: 0 }}>Level up! Tap an ability to spend {me.pendingAbilityPoints} point{me.pendingAbilityPoints > 1 ? "s" : ""}.</p>}
          <div className="abilities">
            {ABILITIES.map((a) => {
              const canSpend = me.pendingAbilityPoints > 0 && me.scores[a] < 20;
              return (
                <button key={a} className="ability" data-spendable={canSpend} disabled={!canSpend || busy} onClick={() => spend(a)}>
                  {a}<b>{me.scores[a]}</b><small>{formatModifier(modifier(me.scores[a]))}</small>
                </button>
              );
            })}
          </div>
          {error && <p className="error">{error}</p>}
          <div>
            <h3>Pack</h3>
            <ul className="inventory">
              {me.items.length === 0 && <li className="muted">Empty</li>}
              {me.items.map((i) => {
                const isNew = fresh.has(i.name.toLowerCase());
                return (
                  <li key={i.name} className={isNew ? "item-new" : ""}>
                    {i.name}{i.qty > 1 && ` ×${i.qty}`}{isNew && <span className="badge-new">✦ new</span>}
                    {i.description && <div className="muted small">{i.description}</div>}
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      ) : <p className="muted">Pick a hero to see your sheet.</p>}
      {others.length > 0 && (
        <section style={{ marginTop: "1.5rem" }}>
          <h3>Party</h3>
          {others.map((c) => (
            <div key={c.id} className="party-card">
              <div className="row spread small"><b>{c.name}</b><span className="muted">HP {c.hp}/{c.maxHp}</span></div>
              <div className="hp-bar thin"><div style={{ width: pct(c) }} /></div>
            </div>
          ))}
        </section>
      )}
      {rejected.length > 0 && (
        <details style={{ marginTop: "1.5rem" }}>
          <summary className="muted small">DM notes ({rejected.length})</summary>
          <ul className="inventory small">
            {rejected.map((e) => (
              <li key={e.id} className="muted">Round {e.round}: ignored <code>{JSON.stringify(e.op)}</code> ({e.reason})</li>
            ))}
          </ul>
        </details>
      )}
    </aside>
  );
}
```

The **DM notes** panel lists changes the rules engine refused (the spec's debugging aid). It is collapsed by default and is never part of the story. Add this line next to `fresh` near the top of the component:

```tsx
  const rejected = snapshot.events.filter((e): e is Extract<typeof e, { type: "op_rejected" }> => e.type === "op_rejected").slice(-10);
```

- [ ] **Step 4: Dice overlay stub and Play screen**

```tsx
// src/client/components/DiceOverlay.tsx  (stub, replaced in Task 14)
import { useEffect } from "react";
import type { StoredRoll } from "../../shared/types";

export function DiceOverlay({ roll, name, onDone }: { roll: StoredRoll; name: string; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 1500); return () => clearTimeout(t); }, [roll.id]);
  return <div className="dice-overlay"><div className="dice-result"><div className="dice-name">{name}</div><div className="dice-total">{roll.total}</div></div></div>;
}
```

```tsx
// src/client/screens/Play.tsx
import { useEffect, useRef, useState } from "react";
import type { StoredRoll } from "../../shared/types";
import { ActionBar } from "../components/ActionBar";
import { CharacterSheet } from "../components/CharacterSheet";
import { DiceOverlay } from "../components/DiceOverlay";
import { Story } from "../components/Story";
import { getMyCharacter } from "../lib/storage";
import { buildStory, isRoll, nameOf } from "../lib/story";
import { useGameSocket } from "../lib/useGameSocket";

export function Play({ campaignId }: { campaignId: number }) {
  const { snapshot, streaming, error, connected, send } = useGameSocket(campaignId);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [diceQueue, setDiceQueue] = useState<StoredRoll[]>([]);
  const lastSeenRoll = useRef<number | null>(null);
  const storyRef = useRef<HTMLDivElement>(null);
  const myId = getMyCharacter(campaignId);

  // Animate rolls that arrive while we're watching (not ones already in the log when we joined).
  useEffect(() => {
    if (!snapshot) return;
    const rolls = snapshot.events.filter(isRoll);
    if (lastSeenRoll.current === null) { lastSeenRoll.current = rolls.at(-1)?.id ?? 0; return; }
    const fresh = rolls.filter((r) => r.id > lastSeenRoll.current!);
    if (fresh.length) {
      lastSeenRoll.current = fresh.at(-1)!.id;
      setDiceQueue((q) => [...q, ...fresh]);
    }
  }, [snapshot]);

  useEffect(() => {
    const el = storyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [snapshot?.events.length, streaming]);

  if (!snapshot) return <main className="page muted">{error ?? "Pulling up a chair…"}</main>;

  const me = snapshot.characters.find((c) => c.id === myId) ?? null;
  const current = diceQueue[0];

  return (
    <div className="play">
      <div className="play-main">
        <header className="play-header">
          <a href="#/" className="muted">← Tavern</a>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="eyebrow" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {snapshot.campaign.sceneTitle || snapshot.campaign.title}
            </p>
          </div>
          <span className={connected ? "dot ok" : "dot"} title={connected ? "Connected" : "Reconnecting…"} />
          <button className="btn btn-ghost sheet-toggle" onClick={() => setSheetOpen(true)}>Sheet</button>
        </header>
        <div className="story" ref={storyRef}>
          <div className="story-inner">
            <Story entries={buildStory(snapshot.events, snapshot.characters)} streaming={streaming} />
          </div>
        </div>
        <ActionBar snapshot={snapshot} me={me} campaignId={campaignId} error={error} send={send} />
      </div>
      <CharacterSheet snapshot={snapshot} me={me} open={sheetOpen} onClose={() => setSheetOpen(false)} />
      {current && (
        <DiceOverlay key={current.id} roll={current} name={nameOf(snapshot.characters, current.characterId)}
          onDone={() => setDiceQueue((q) => q.slice(1))} />
      )}
    </div>
  );
}
```

- [ ] **Step 5: Verify with two browsers**

With Ollama, `npm run dev` and `npm run dev:client` running, open the Vite URL in two browser profiles (or one normal + one private window), each with its own hero in one party campaign:
- Begin: the opening narration streams word by word in **both** windows, then the scene title shows in the header.
- The ready line updates live ("Wren ✓ · Corvin …"). "Go ahead without me" and "Don't wait for …" both work.
- When a check is requested, the owner sees the glowing **Roll d20** and the other sees "Roll for …". Rolling resolves the round in both windows.
- Stop Ollama mid-round: "The Dungeon Master pauses…" appears. Restart Ollama and press Try again: the round completes.
- Items the DM adds glow with "✦ new". The HP bar animates on damage.
- If the DM tries an invalid change (e.g. removing an item nobody has), it shows up under **DM notes** at the bottom of the sheet, not in the story.
- Phone width (390 px): the story is full width, **Sheet** opens the drawer, the action bar stays at the bottom, and there's no horizontal scroll.
- Ctrl-C the server during "weaving the tale…", then restart it. The client reconnects (the dot goes green) and shows Try again.

`npm run typecheck` and `npx vitest run` clean.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: live play screen with story stream, action bar and character sheet"
```

---

### Task 14: 3D dice overlay

**Files:**
- Create: `src/client/lib/dice.ts`, `src/client/lib/dice-box.d.ts`
- Modify (replace stub): `src/client/components/DiceOverlay.tsx`

**Interfaces:**
- Consumes: `StoredRoll`; `#dice-stage` element rendered by `App`.
- Produces: `getDiceBox(): Promise<DiceBoxLike | null>`, `wait(ms)`; final `DiceOverlay`.

- [ ] **Step 1: Confirm the library API before writing code**

Run:
```bash
ls node_modules/@3d-dice/dice-box-threejs/ node_modules/@3d-dice/dice-box-threejs/dist 2>/dev/null
grep -nE "initialize|clearDice|theme_customColorset|async roll" -r node_modules/@3d-dice/dice-box-threejs/src | head -30
sed -n 1,60p node_modules/@3d-dice/dice-box-threejs/src/const/colorsets.js
```
Confirm: (a) the default export is a class constructed as `new DiceBox(selector, config)`; (b) the name of the async setup method (expected `initialize()`); (c) a method that removes dice from the scene (expected `clearDice()`); (d) the field names of a custom colorset (expected `{ name, foreground, background, outline, texture, material }`). If any name differs, use the real one in Step 3 below and in `dice-box.d.ts`. Also note whether the renderer has a transparent background. If it doesn't, the `#dice-stage` opacity toggle in `theme.css` already hides it between rolls.

- [ ] **Step 2: Type declaration**

```ts
// src/client/lib/dice-box.d.ts
declare module "@3d-dice/dice-box-threejs" {
  export default class DiceBox {
    constructor(selector: string, config?: Record<string, unknown>);
    initialize(): Promise<void>;
    roll(notation: string): Promise<unknown>;
    clearDice?(): void;
  }
}
```

- [ ] **Step 3: Loader with graceful fallback**

```ts
// src/client/lib/dice.ts
export interface DiceBoxLike { roll(notation: string): Promise<unknown>; clearDice?(): void }

let boxPromise: Promise<DiceBoxLike | null> | null = null;

export const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Lazily creates the 3D dice box once. Resolves to null if 3D isn't possible (no WebGL, reduced motion, load error). */
export function getDiceBox(): Promise<DiceBoxLike | null> {
  boxPromise ??= (async () => {
    try {
      if (matchMedia("(prefers-reduced-motion: reduce)").matches) return null;
      if (!document.createElement("canvas").getContext("webgl2")) return null;
      const { default: DiceBox } = await import("@3d-dice/dice-box-threejs");
      const box = new DiceBox("#dice-stage", {
        sounds: false,
        shadows: true,
        theme_surface: "green-felt",
        theme_material: "metal",
        theme_customColorset: {
          name: "candlelit", foreground: "#ffd27a", background: "#5a3a1c", outline: "#1a120c", texture: "none", material: "metal",
        },
        light_intensity: 0.9,
        gravity_multiplier: 400,
        baseScale: 110,
        strength: 1.4,
      });
      await box.initialize();
      return box;
    } catch (e) {
      console.warn("3D dice unavailable, using simple dice instead:", e);
      return null;
    }
  })();
  return boxPromise;
}
```

If `theme_surface: "green-felt"` paints an opaque green table across the screen, try `theme_surface: ""` or the library's transparent option found in Step 1. The look to aim for is dice over the dimmed story, not over a felt table.

- [ ] **Step 4: Final DiceOverlay**

```tsx
// src/client/components/DiceOverlay.tsx
import { useEffect, useState } from "react";
import { formatModifier } from "../../shared/abilities";
import type { StoredRoll } from "../../shared/types";
import { getDiceBox, wait } from "../lib/dice";

const D20_SVG = (
  <svg viewBox="0 0 100 100" className="fallback-die" aria-hidden>
    <polygon points="50,4 93,27 93,73 50,96 7,73 7,27" fill="#5a3a1c" stroke="#ffd27a" strokeWidth="3" />
    <polygon points="50,20 78,66 22,66" fill="none" stroke="#e0a84a" strokeWidth="2" />
  </svg>
);

export function DiceOverlay({ roll, name, onDone }: { roll: StoredRoll; name: string; onDone: () => void }) {
  const [phase, setPhase] = useState<"rolling" | "result">("rolling");
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const stage = document.getElementById("dice-stage");
    (async () => {
      const box = await getDiceBox();
      if (cancelled) return;
      if (box) {
        stage?.classList.add("active");
        try {
          await box.roll(`1d20@${roll.die}`);
        } catch (e) {
          console.warn("Dice roll animation failed:", e);
          setFallback(true);
          await wait(1200);
        }
      } else {
        setFallback(true);
        await wait(matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1200);
      }
      if (cancelled) return;
      setPhase("result");
      timer = window.setTimeout(() => {
        stage?.classList.remove("active");
        box?.clearDice?.();
        onDone();
      }, 2600);
    })();
    return () => { cancelled = true; clearTimeout(timer); stage?.classList.remove("active"); };
  }, [roll.id]);

  const verdict = roll.crit === "nat20" ? "Natural 20!" : roll.crit === "nat1" ? "Natural 1…" : roll.success ? "Success" : "Failure";
  return (
    <div className={`dice-overlay ${phase}`} role="status" aria-live="polite">
      {fallback && phase === "rolling" && D20_SVG}
      {phase === "result" && (
        <div className={`dice-result ${roll.crit ?? ""}`}>
          <div className="dice-name">{name} · {roll.ability} check</div>
          <div className="dice-total">
            <span className="die">{roll.die}</span> {formatModifier(roll.modifier)} = <b>{roll.total}</b> <span className="muted">vs DC {roll.dc}</span>
          </div>
          <div className={roll.success ? "ok" : "fail"}>{verdict}</div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Verify in the browser**

- In a solo campaign, do something risky (e.g. "I leap the chasm"). On **Roll d20** a 3D d20 tumbles and lands showing the same number as the result card and the story chip.
- Force crits for a visual check: temporarily start the server with a fixed die by editing `buildApp` call in `main.ts` to pass `dice: () => 20` (then `() => 1`). You should see the gold burst and the red shake. **Revert this edit afterwards.**
- In a two-window party game, both windows animate the same roll.
- With "Emulate CSS prefers-reduced-motion" on in devtools, there's no 3D and no tumble, just the result card.
- On a phone (or devtools phone emulation), the roll animates without freezing the page for more than a moment. If it's sluggish on a real phone, note it for the README; the fallback path is fine.

`npm run typecheck` clean.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: animated 3D d20 that lands on the server's roll"
```

---

### Task 15: Smoke test, README, and end-to-end acceptance

**Files:**
- Create: `scripts/smoke.ts`, `README.md`
- Modify: `docs/superpowers/specs/2026-10-03-ai-dungeon-master-design.md` only if acceptance reveals a needed spec change (note it in the commit)

**Interfaces:**
- Consumes: `createStore`, `createOllamaClient`, `createDungeonMaster`, `TurnService`, `lightRules`, `loadConfig`, `rollD20`.

- [ ] **Step 1: Smoke script**

```ts
// scripts/smoke.ts
// Plays a short solo-party game against your real Ollama model and reports how well it follows the format.
import { loadConfig } from "../src/server/config";
import { createDungeonMaster } from "../src/server/dm/dm";
import { createOllamaClient } from "../src/server/dm/ollama";
import { rollD20 } from "../src/server/rules/dice";
import { lightRules } from "../src/server/rules/engine";
import { createStore } from "../src/server/store/store";
import { TurnService } from "../src/server/turns/turns";

try { process.loadEnvFile(); } catch { /* optional */ }
const config = loadConfig({ TABLE_PASSWORD: "smoke", ...process.env });
const chat = createOllamaClient({ url: config.ollamaUrl, model: config.ollamaModel, keepAlive: config.ollamaKeepAlive });
const dm = createDungeonMaster({ chat, rules: lightRules, budgetTokens: config.promptBudgetTokens });
const store = createStore(":memory:");
const turns = new TurnService({ store, rules: lightRules, dm, hub: { broadcast() {} }, dice: rollD20 });

const campaign = store.createCampaign({ title: "Smoke", mode: "party", setting: "Classic high fantasy", pitch: "", outline: null });
const scores = { STR: 15, DEX: 14, CON: 13, INT: 12, WIS: 10, CHA: 8 };
const heroes = await Promise.all([["Corvin", "disgraced knight"], ["Wren", "nimble scout"]].map(async ([name, concept]) => {
  const t = Date.now();
  const kit = await dm.startingKit({ name, concept, setting: campaign.setting });
  console.log(`kit for ${name} (${((Date.now() - t) / 1000).toFixed(1)}s): ${kit.map((i) => i.name).join(", ")}`);
  const maxHp = lightRules.startingMaxHp(scores);
  return store.createCharacter({ campaignId: campaign.id, name, concept, scores, hp: maxHp, maxHp, items: kit.map((i) => ({ ...i, qty: 1 })) });
}));

const script = [
  ["I ask the innkeeper about the trouble up the road", "I watch the room for anyone acting suspicious"],
  ["I lead us down the forest path", "I scout ahead, staying in the shadows"],
  ["I try to force open the old gate", "I look for another way in"],
  ["I draw my sword and challenge whatever is inside", "I ready my bow and cover Corvin"],
  ["I search the room for anything valuable", "I check the bodies for clues"],
];

const timed = async (label: string, fn: () => Promise<void>) => {
  const t = Date.now();
  await fn();
  console.log(`  ${label}: ${((Date.now() - t) / 1000).toFixed(1)}s`);
};

await timed("opening", () => turns.begin(campaign.id));
for (const [i, [a, b]] of script.entries()) {
  console.log(`round ${i + 1}`);
  await turns.submitAction(campaign.id, heroes[0].id, a);
  await timed("actions", () => turns.submitAction(campaign.id, heroes[1].id, b));
  for (let guard = 0; store.getCampaign(campaign.id)!.roundState === "awaiting_rolls" && guard < 4; guard++) {
    const ev = store.getEvents(campaign.id, { fromRound: store.getCampaign(campaign.id)!.roundNumber });
    const pending = ev.filter((e) => e.type === "check_request").map((e) => (e as { characterId: number }).characterId)
      .find((cid) => !ev.some((e) => e.type === "roll" && e.characterId === cid));
    if (pending !== undefined) await timed("roll + resolve", () => turns.roll(campaign.id, pending));
  }
  if (store.getCampaign(campaign.id)!.roundState === "stalled") {
    console.log("  stalled, retrying once");
    await turns.retry(campaign.id);
  }
}
await turns.settle();

const events = store.getEvents(campaign.id);
const count = (t: string) => events.filter((e) => e.type === t).length;
console.log("\n── Story ──");
for (const e of events) if (e.type === "narration") console.log(`\n${e.text}`);
console.log("\n── Report ──");
console.log(`model: ${config.ollamaModel}`);
console.log(`narrations: ${count("narration")}, checks: ${count("check_request")}, rolls: ${count("roll")}`);
console.log(`ops applied: ${count("op_applied")}, ops rejected: ${count("op_rejected")}, stalls: ${count("stall")}`);
for (const e of events) if (e.type === "op_rejected") console.log(`  rejected: ${JSON.stringify(e.op)} (${e.reason})`);
for (const c of store.getCharacters(campaign.id)) console.log(`${c.name}: HP ${c.hp}/${c.maxHp}, items: ${c.items.map((i) => i.name).join(", ")}`);
store.close();
process.exit(count("stall") > 0 ? 1 : 0);
```

- [ ] **Step 2: Run the smoke test against the real model**

```bash
ollama pull qwen3.6:27b
npm run smoke
```
Expected: exit code 0, six narrations (opening + 5 rounds), at least one check/roll, rejected ops ≤ 2. Record the timings.
- If replies take over ~45 s each or the Mac struggles: rerun with `OLLAMA_MODEL=qwen3.5:9b npm run smoke` and compare quality and speed. Make the better choice the default in `.env.example`, `config.ts` (and its test) and the spec's config table.
- If stalls happen: read the logged error. Typical fixes are in `prompts.ts` (clearer JSON instructions), not in the parser.

- [ ] **Step 3: README**

````markdown
# AI Dungeon Master

A tabletop adventure for your home network. You and your party say what your heroes do; a local AI (Qwen, via Ollama) is the Dungeon Master. The app keeps the character sheets and rolls the dice.

## Setup (Mac)

1. Install Node 24+ and Ollama (`brew install ollama`, or the app from ollama.com).
2. Start Ollama and fetch the model:
   ```bash
   ollama serve            # skip if the Ollama app is running
   ollama pull qwen3.6:27b # ~17 GB; for a faster, lighter DM use qwen3.5:9b
   ```
3. Install and configure:
   ```bash
   npm install
   cp .env.example .env    # then set TABLE_PASSWORD
   ```
4. Build and run:
   ```bash
   npm run build
   npm start
   ```
   The server prints addresses like `http://192.168.1.20:3000`. Open that on any phone or laptop on your Wi-Fi.
   The first time, macOS asks whether to allow incoming connections. Click **Allow**.

## Playing

- **New campaign**: choose a setting, write your own pitch, or pick a prepared adventure. Party = play together, Solo = just you.
- **Join**: each player creates a hero (5e point buy) on their own device, or picks an existing one.
- **Begin**, then each round type what you do. The DM asks for checks when things are risky; press **Roll d20**.
- **Go ahead without me** / **Don't wait for …** keeps the game moving.
- **Try again** appears if the DM gets stuck (e.g. Ollama was closed).
- **Pack up for the night** (bottom of the lobby) unloads the model to free memory. Ollama also unloads it after `OLLAMA_KEEP_ALIVE` (default 30 minutes) of quiet.

Saves are automatic: everything lives in `data/game.sqlite`. Copy that file to back it up.

## Keeping it private

The server only answers devices on private network addresses, and asks for the table password. Your router blocks the internet from reaching it unless you've set up **port forwarding** for this port. Check your router's admin page and make sure nothing forwards to port 3000.

## Development

```bash
npm run dev          # API server with reload (port 3000)
npm run dev:client   # Vite dev server (port 5173, proxies to 3000)
npm test             # unit + integration tests (no AI needed)
npm run smoke        # plays 5 rounds against your real model and reports
```

Add a prepared adventure by dropping a JSON file in `src/server/campaigns/adventures/` (copy `drowned-chapel.json`).

## Moving to a Raspberry Pi or old laptop

A Pi can host the website but is far too slow to run the model, so split them:

1. **On the Mac (the DM's brain):** make Ollama listen on the network.
   - Ollama app: `launchctl setenv OLLAMA_HOST 0.0.0.0` and restart the app.
   - Or run `OLLAMA_HOST=0.0.0.0 ollama serve`.
   Ollama has no password, so only do this on your home network.
2. **On the Pi (64-bit Raspberry Pi OS, Pi 4/5):** install Node 24, copy this folder (or `git clone`), then:
   ```bash
   npm install && npm run build
   cp .env.example .env   # set TABLE_PASSWORD and OLLAMA_URL=http://<mac-ip>:11434
   npm start
   ```
3. To start it at boot, create a systemd service that runs `npm start` in this folder.

The Mac only needs to be awake while you play. Everything else (saves, website) lives on the Pi.
````

- [ ] **Step 4: End-to-end acceptance (the spec's §10)**

Run `npm run build && npm start` on the Mac (production mode, single port). Then check each item and tick it:
1. On a **second device** (Rach's laptop, or a phone) on the same Wi-Fi, open the printed LAN URL and enter the password. You and the second device create heroes and join one **party** campaign.
2. Play ~15 minutes: both act each round, dice animate on both screens, narration streams, at least one item and one stat change land on the sheets.
3. Each player can start a **solo** campaign.
4. Ctrl-C the server mid-campaign and run `npm start` again. Nothing is lost, and the clients reconnect.
5. One player uses a **phone** for a few rounds.
6. **Pack up for the night**: Activity Monitor shows Ollama's memory drop. The next turn reloads it and still works.
7. From a phone on **mobile data** (Wi-Fi off), the LAN URL doesn't load.

Record anything that failed as a follow-up. Don't silently patch spec behaviour.

- [ ] **Step 5: Final checks and commit**

```bash
npx vitest run && npm run typecheck && npm run build
git add -A
git commit -m "docs: README with setup, Pi migration and smoke test"
```
