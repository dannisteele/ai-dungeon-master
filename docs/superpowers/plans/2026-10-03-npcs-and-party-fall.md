# NPCs in the Scene and the Party Falling: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The DM tracks the NPCs in each scene: name, attitude and rough condition. Players see them as coloured chips they can tap to target. A party that is wiped out gets a clear ending with a Revive option at half HP.

**Architecture:** Two new state-change ops (`npc`, `npc_gone`) flow through the existing `changes` list, the rules engine and the commit transaction into a new `npcs` table, then out through the snapshot. A new `fallen` round state is entered when a resolved round leaves every hero at 0 HP. The `reviving` AI phase reuses `runPhase`, stall and retry, and the commit path. Here the app, not the DM, sets every hero's HP to half.

**Tech Stack:** As before: Node 24/TypeScript, Fastify, better-sqlite3, Zod 4, React 19, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-03-npcs-and-party-fall-design.md` (builds on `docs/superpowers/specs/2026-10-03-ai-dungeon-master-design.md`).

## Global Constraints

- Attitudes, exactly in this order: `hostile`, `wary`, `neutral`, `friendly`. Conditions, exactly in this order: `unhurt`, `wounded`, `badly hurt`, `down`.
- NPC names are 1–60 characters, trimmed and matched case-insensitively. At most **12** NPCs per campaign at a time.
- `set_scene` clears the NPC list at the point where it is applied. Ops apply in order.
- Rejection reasons, verbatim:
  - `no NPC called "<name>" is here`
  - `too many NPCs in the scene (max 12)`
  - `HP is set by the revive`
- Revive HP = `Math.ceil(maxHp / 2)` for every hero, set by the app.
- GameError texts, verbatim:
  - `The party has fallen. Revive or start a new campaign.`
  - `Nobody needs reviving.`
- Quick-action sentences, verbatim: `I attack <name>`, `I talk to <name>`, `I watch <name> closely`. Appending adds a single space between the existing text (trimmed at the end) and the sentence.
- Chip colours: hostile `--danger`, wary `--gold`, neutral `--muted`, friendly `--success`. A downed NPC is struck through at 50% opacity.
- The app is LAN-only, and Daniella may be playing on port 3000 from this working tree. Verification servers use `PORT=3100` with a `/tmp` `DB_PATH`. Never touch port 3000, `data/` or `.env`.
- Commit messages end with a `Co-Authored-By` trailer for the committing model, plus `Claude-Session: https://claude.ai/code/session_01LA8QNZY5gV8LKRAtxJA8B3`.
- Every task ends with `npx vitest run`, `npm run typecheck` and `npm run build` all clean.

## Review Focus

1. **A DM that renames an NPC slightly** ("the scarred brute" vs "Scarred Brute") must update the existing entry, not duplicate it. (Task 1: case-insensitive test.)
2. **The existing "Test fun oh yes" save** must come back revivable after a server restart, not stuck accepting actions from corpses. (Task 4: `recoverInterrupted` test.)
3. **A DM that sneaks `heal` or `damage` into a revive** must not change HP. The reason must be visible in DM notes. (Task 4: test.)
4. **Tapping a chip while text is already typed** must not wipe the player's words. (Task 5: `appendAction` test.)
5. **A Nearby strip with many NPCs on a 390 px phone** must not widen the page. The strip scrolls inside its own container. (Task 5: CSS `overflow-x: auto` on the strip, plus a manual check.)

---

## File Structure

```
src/shared/types.ts             + Attitude/Condition/Npc, npc ops (T1); Snapshot.npcs (T2); reviving/fallen/party_fallen/revive (T4)
src/server/rules/ops.ts         npc ops in OpSchema and applyOps (T1)
src/server/rules/engine.ts      applyOps(…, npcs), reviveHp, opsGuide lines (T1)
src/server/dm/context.ts        [NPC] transcript lines (T1); DmContext.npcs (T3)
src/client/lib/story.ts         npc chip text (T1); party_fallen entry (T5)
src/server/store/store.ts       npcs table, getNpcs/saveNpcs (T2)
src/server/turns/snapshot.ts    snapshot.npcs (T2)
src/server/dm/prompts.ts        Nearby block, NPC instructions, reviveTask (T3)
src/server/dm/dm.ts             revive() (T3)
src/server/turns/turns.ts       save npcs, fallen, revive, recovery (T4)
src/server/routes/ws.ts         revive message (T4)
src/client/lib/npcs.ts          quickActionText, appendAction (T5)
src/client/components/NearbyStrip.tsx   chips + quick-action menu (T5)
src/client/components/ActionBar.tsx     strip, fallen panel, reviving (T5)
src/client/components/Story.tsx         fallen entry (T5)
src/client/theme.css            nearby / npc / fallen styles (T5)
scripts/smoke.ts, README.md     npc counter, docs (T6)
```

---

### Task 1: NPC ops in the rules engine, transcript and story chips

**Files:**
- Modify: `src/shared/types.ts`, `src/server/rules/ops.ts`, `src/server/rules/engine.ts`, `src/server/dm/context.ts`, `src/client/lib/story.ts`
- Test: `tests/server/rules/ops.test.ts`, `tests/server/rules/engine.test.ts`, `tests/server/dm/context.test.ts`, `tests/client/story.test.ts`

**Interfaces:**
- Produces:
  - `ATTITUDES`, `Attitude`, `CONDITIONS`, `Condition`, `Npc`; the new `Op` members `{op:"npc"; name; attitude; condition}` and `{op:"npc_gone"; name}`.
  - `MAX_NPCS = 12`.
  - `ApplyResult.npcs: Npc[]`; `applyOps(characters, rawOps, npcs: Npc[] = [])`.
  - `RulesEngine.applyOps(characters, ops, npcs?)` and `RulesEngine.reviveHp(c: Character): number`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/server/rules/ops.test.ts`. Its `hero()` helper makes "Corvin Ash".

```ts
describe("NPC ops", () => {
  const brute = { op: "npc", name: "Scarred Brute", attitude: "hostile", condition: "unhurt" };

  it("adds NPCs and updates them case-insensitively, keeping the newest spelling", () => {
    const r = applyOps([hero()], [brute, { op: "npc", name: "  scarred BRUTE ", attitude: "hostile", condition: "wounded" }]);
    expect(r.npcs).toEqual([{ name: "scarred BRUTE", attitude: "hostile", condition: "wounded" }]);
    expect(r.applied).toHaveLength(2);
  });

  it("starts from the NPCs passed in and does not mutate them", () => {
    const before = [{ name: "Barkeep", attitude: "neutral" as const, condition: "unhurt" as const }];
    const r = applyOps([hero()], [brute], before);
    expect(r.npcs.map((n) => n.name)).toEqual(["Barkeep", "Scarred Brute"]);
    expect(before).toHaveLength(1);
  });

  it("npc_gone removes an NPC and rejects unknown names", () => {
    const start = [{ name: "Barkeep", attitude: "neutral" as const, condition: "unhurt" as const }];
    const r = applyOps([hero()], [{ op: "npc_gone", name: "barkeep" }, { op: "npc_gone", name: "Ghost" }], start);
    expect(r.npcs).toEqual([]);
    expect(r.rejected).toEqual([{ op: { op: "npc_gone", name: "Ghost" }, reason: 'no NPC called "Ghost" is here' }]);
  });

  it("set_scene clears the list, and later npc ops repopulate it", () => {
    const start = [{ name: "Barkeep", attitude: "neutral" as const, condition: "unhurt" as const }];
    const r = applyOps([hero()], [{ op: "set_scene", title: "The Cells" }, { op: "npc", name: "Jailer", attitude: "wary", condition: "unhurt" }], start);
    expect(r.sceneTitle).toBe("The Cells");
    expect(r.npcs).toEqual([{ name: "Jailer", attitude: "wary", condition: "unhurt" }]);
  });

  it("caps the scene at 12 NPCs", () => {
    const ops = Array.from({ length: 13 }, (_, i) => ({ op: "npc", name: `Rat ${i}`, attitude: "hostile", condition: "unhurt" }));
    const r = applyOps([hero()], ops);
    expect(r.npcs).toHaveLength(12);
    expect(r.rejected).toEqual([{ op: ops[12], reason: "too many NPCs in the scene (max 12)" }]);
  });

  it("rejects an invalid attitude or condition", () => {
    const r = applyOps([hero()], [{ op: "npc", name: "X", attitude: "angry", condition: "unhurt" }, { op: "npc", name: "Y", attitude: "wary", condition: "dead" }]);
    expect(r.npcs).toEqual([]);
    expect(r.rejected).toHaveLength(2);
    expect(r.rejected[0].reason).toMatch(/invalid op/);
  });
});
```

Append to the `lightRules` describe block in `tests/server/rules/engine.test.ts`:

```ts
  it("revives at half max HP, rounded up", () => {
    expect(lightRules.reviveHp(c({ maxHp: 25 }))).toBe(13);
    expect(lightRules.reviveHp(c({ maxHp: 22 }))).toBe(11);
  });
```

Append to `tests/server/dm/context.test.ts`. Use the file's existing `store` and character setup pattern to create a campaign and a character named Corvin, then:

```ts
  it("renders NPC ops as [NPC] lines", () => {
    const store = createStore(":memory:");
    const c = store.createCampaign({ title: "T", mode: "solo", setting: "S", pitch: "", outline: null });
    store.appendEvent(c.id, 1, { type: "op_applied", op: { op: "npc", name: "Scarred Brute", attitude: "hostile", condition: "badly hurt" } });
    store.appendEvent(c.id, 1, { type: "op_applied", op: { op: "npc_gone", name: "Scarred Brute" } });
    expect(transcriptFromEvents(store.getEvents(c.id), [])).toEqual([
      { round: 1, lines: ["[NPC] Scarred Brute: hostile, badly hurt", "[NPC] Scarred Brute leaves"] },
    ]);
  });
```

Append to `tests/client/story.test.ts`. Use its existing `ev` helper and `chars`.

```ts
describe("NPC story chips", () => {
  it("shows NPC changes as sheet chips", () => {
    const story = buildStory([
      ev(1, { type: "op_applied", op: { op: "npc", name: "Scarred Brute", attitude: "hostile", condition: "wounded" } }),
      ev(1, { type: "op_applied", op: { op: "npc_gone", name: "Scarred Brute" } }),
    ], chars);
    expect(story).toEqual([
      expect.objectContaining({ kind: "sheet", text: "Scarred Brute: hostile, wounded" }),
      expect.objectContaining({ kind: "sheet", text: "Scarred Brute leaves" }),
    ]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/server/rules tests/server/dm/context.test.ts tests/client/story.test.ts`
Expected: FAIL. `npcs` is undefined, `reviveHp` is not a function, and the new transcript lines and story chips are missing.

- [ ] **Step 3: Add the shared types**

In `src/shared/types.ts`, directly after `export type Scores = …`, add:

```ts
export const ATTITUDES = ["hostile", "wary", "neutral", "friendly"] as const;
export type Attitude = (typeof ATTITUDES)[number];
export const CONDITIONS = ["unhurt", "wounded", "badly hurt", "down"] as const;
export type Condition = (typeof CONDITIONS)[number];
export interface Npc { name: string; attitude: Attitude; condition: Condition }
```

In the `Op` union, after the `set_scene` member, add:

```ts
  | { op: "npc"; name: string; attitude: Attitude; condition: Condition }
  | { op: "npc_gone"; name: string };
```

(Move the trailing `;` from the `set_scene` line to the new last member.)

- [ ] **Step 4: Implement the ops**

In `src/server/rules/ops.ts`:

```ts
import { ABILITIES, ATTITUDES, CONDITIONS, type Character, type Npc, type Op } from "../../shared/types";

export const MAX_NPCS = 12;
```

Add these to the `z.discriminatedUnion` array, after `set_scene`:

```ts
  z.object({ op: z.literal("npc"), name, attitude: z.enum(ATTITUDES), condition: z.enum(CONDITIONS) }),
  z.object({ op: z.literal("npc_gone"), name }),
```

Change `ApplyResult` to:

```ts
export interface ApplyResult {
  characters: Character[];
  npcs: Npc[];
  applied: Op[];
  rejected: { op: unknown; reason: string }[];
  sceneTitle: string | null;
}
```

Change `applyOne`'s parameter type to `op: Extract<Op, { character: string }>`. The switch body is unchanged.

Replace `applyOps` with:

```ts
const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function applyOps(characters: Character[], rawOps: unknown[], npcs: Npc[] = []): ApplyResult {
  const chars = structuredClone(characters);
  const result: ApplyResult = { characters: chars, npcs: structuredClone(npcs), applied: [], rejected: [], sceneTitle: null };
  for (const raw of rawOps) {
    const parsed = OpSchema.safeParse(raw);
    if (!parsed.success) {
      result.rejected.push({ op: raw, reason: `invalid op: ${z.prettifyError(parsed.error)}` });
      continue;
    }
    const op = parsed.data;
    if (op.op === "set_scene") {
      result.sceneTitle = op.title;
      result.npcs = [];
      result.applied.push(op);
      continue;
    }
    if (op.op === "npc") {
      const npc: Npc = { name: op.name, attitude: op.attitude, condition: op.condition };
      const at = result.npcs.findIndex((n) => sameName(n.name, op.name));
      if (at >= 0) result.npcs[at] = npc;
      else if (result.npcs.length >= MAX_NPCS) { result.rejected.push({ op, reason: `too many NPCs in the scene (max ${MAX_NPCS})` }); continue; }
      else result.npcs.push(npc);
      result.applied.push(op);
      continue;
    }
    if (op.op === "npc_gone") {
      const at = result.npcs.findIndex((n) => sameName(n.name, op.name));
      if (at < 0) { result.rejected.push({ op, reason: `no NPC called "${op.name}" is here` }); continue; }
      result.npcs.splice(at, 1);
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

- [ ] **Step 5: Update the engine**

In `src/server/rules/engine.ts`:
- Import `Npc`.
- Change the interface line to `applyOps(characters: Character[], ops: unknown[], npcs?: Npc[]): ApplyResult;`.
- Add `/** HP every hero wakes with after the party is revived. */ reviveHp(c: Character): number;` to the interface.
- In `lightRules`, add `reviveHp: (c) => Math.ceil(c.maxHp / 2),`.
- Append these two lines to `opsGuide`:

```ts
    '- {"op":"npc","name":NAME,"attitude":"hostile"|"wary"|"neutral"|"friendly","condition":"unhurt"|"wounded"|"badly hurt"|"down"}  (add or update someone in the scene)',
    '- {"op":"npc_gone","name":NAME}  (they leave or are no longer relevant)',
```

- [ ] **Step 6: Render the new ops**

`src/server/dm/context.ts`: inside the `op_applied` switch, add:

```ts
          case "npc": lines.push(`[NPC] ${op.name}: ${op.attitude}, ${op.condition}`); break;
          case "npc_gone": lines.push(`[NPC] ${op.name} leaves`); break;
```

`src/client/lib/story.ts`: inside the `op_applied` text switch, add:

```ts
          case "npc": text = `${op.name}: ${op.attitude}, ${op.condition}`; break;
          case "npc_gone": text = `${op.name} leaves`; break;
```

- [ ] **Step 7: Run all the checks, then commit**

Run: `npx vitest run && npm run typecheck && npm run build`
Expected: all green.

```bash
git add -A src tests
git commit -m "feat: npc and npc_gone ops tracked by the rules engine"
```

---

### Task 2: Store NPCs and include them in the snapshot

**Files:**
- Modify: `src/server/store/store.ts`, `src/server/turns/snapshot.ts`, `src/shared/types.ts`
- Test: `tests/server/store/store.test.ts`

**Interfaces:**
- Consumes: `Npc` (Task 1).
- Produces: `Store.getNpcs(campaignId: number): Npc[]` (ordered by insertion); `Store.saveNpcs(campaignId: number, npcs: Npc[]): void` (replaces the list; for duplicate names, case-insensitive, the last one wins); `Snapshot.npcs: Npc[]`.

- [ ] **Step 1: Write the failing test**

Append to `tests/server/store/store.test.ts` (inside the existing describe, which uses its `seed` helper):

```ts
  it("saves and replaces a campaign's NPCs", () => {
    store = createStore(":memory:");
    const { campaign } = seed(store);
    expect(store.getNpcs(campaign.id)).toEqual([]);
    store.saveNpcs(campaign.id, [
      { name: "Scarred Brute", attitude: "hostile", condition: "unhurt" },
      { name: "Barkeep", attitude: "neutral", condition: "unhurt" },
      { name: "scarred brute", attitude: "hostile", condition: "wounded" },
    ]);
    expect(store.getNpcs(campaign.id)).toEqual([
      { name: "scarred brute", attitude: "hostile", condition: "wounded" },
      { name: "Barkeep", attitude: "neutral", condition: "unhurt" },
    ]);
    store.saveNpcs(campaign.id, []);
    expect(store.getNpcs(campaign.id)).toEqual([]);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run tests/server/store`
Expected: FAIL (`store.getNpcs is not a function`).

- [ ] **Step 3: Implement**

`src/server/store/store.ts`:
- Import `Npc`.
- Add to `SCHEMA`, after the events index:

```sql
CREATE TABLE IF NOT EXISTS npcs (
  id INTEGER PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  attitude TEXT NOT NULL,
  condition TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_npcs_name ON npcs(campaign_id, lower(name));
```

(`CREATE … IF NOT EXISTS` adds the table to existing save files on the next start.)

- Add to the `Store` interface:

```ts
  getNpcs(campaignId: number): Npc[];
  saveNpcs(campaignId: number, npcs: Npc[]): void;
```

- Add to the implementation object:

```ts
    getNpcs(campaignId) {
      return db.prepare<[number], Npc>("SELECT name, attitude, condition FROM npcs WHERE campaign_id = ? ORDER BY id").all(campaignId);
    },
    saveNpcs(campaignId, npcs) {
      const byName = new Map<string, Npc>();
      for (const n of npcs) byName.set(n.name.trim().toLowerCase(), n);
      db.transaction(() => {
        db.prepare("DELETE FROM npcs WHERE campaign_id = ?").run(campaignId);
        const insert = db.prepare("INSERT INTO npcs (campaign_id, name, attitude, condition) VALUES (?, ?, ?, ?)");
        for (const n of byName.values()) insert.run(campaignId, n.name, n.attitude, n.condition);
      })();
    },
```

`src/shared/types.ts`: add `npcs: Npc[];` to `Snapshot` (after `characters`).

`src/server/turns/snapshot.ts`: in `buildSnapshot`, add `npcs: store.getNpcs(campaignId),` after `characters,`.

- [ ] **Step 4: Run all the checks, then commit**

Run: `npx vitest run && npm run typecheck && npm run build`. All green.

```bash
git add -A src tests
git commit -m "feat: persist NPCs per campaign and send them in snapshots"
```

---

### Task 3: Show the DM the Nearby list and add the revive call

**Files:**
- Modify: `src/server/dm/context.ts`, `src/server/dm/prompts.ts`, `src/server/dm/dm.ts`
- Modify (test fakes, to keep types green): `tests/server/turns/turns.test.ts` (FakeDm), `tests/server/app.test.ts` (fakeDm)
- Test: `tests/server/dm/prompts.test.ts`, `tests/server/dm/dm.test.ts`, `tests/server/dm/context.test.ts`

**Interfaces:**
- Consumes: `Store.getNpcs` (Task 2); `Npc` (Task 1).
- Produces:
  - `DmContext.npcs: Npc[]`.
  - `nearbyBlock(npcs: Npc[]): string`.
  - `reviveTask(): string`.
  - `DungeonMaster.revive(ctx: DmContext, stream: StreamHandlers): Promise<ResolveOutput>`.

- [ ] **Step 1: Write the failing tests**

`tests/server/dm/prompts.test.ts`:
- Add `npcs: []` to the existing `DmContext` literals at lines ~57 and ~69.
- Import `nearbyBlock`, `openingTask` and `reviveTask`.
- Append:

```ts
  it("shows the DM who is nearby", () => {
    expect(nearbyBlock([])).toBe("Nearby: nobody notable.");
    expect(nearbyBlock([{ name: "Scarred Brute", attitude: "hostile", condition: "wounded" }]))
      .toBe("Nearby (authoritative):\n- Scarred Brute: hostile, wounded");
    const ctx: DmContext = { campaign, characters: [corvin], recentRounds: [], npcs: [{ name: "Jailer", attitude: "wary", condition: "unhurt" }] };
    const [system, user] = buildMessages(ctx, lightRules, "TASK", 12000);
    expect(user.content).toContain("- Jailer: wary, unhurt");
    expect(system.content).toContain("Keep the Nearby list true");
    expect(openingTask()).toContain("npc op for each notable character or group");
  });

  it("asks for a revive twist without HP changes", () => {
    const t = reviveTask();
    expect(t).toContain("The whole party has fallen.");
    expect(t).toContain("Do not add heal ops: the app restores everyone to half health.");
  });
```

`tests/server/dm/dm.test.ts`:
- Add `npcs: []` to its `ctx` literal.
- Append:

```ts
  it("revives with a streamed narration", async () => {
    const { dm } = make(['{"narration":"You wake in a cell.","changes":[{"op":"set_scene","title":"The Cells"}]}']);
    const { r, handlers } = recorder();
    const out = await dm.revive(ctx, handlers);
    expect(out.narration).toBe("You wake in a cell.");
    expect(r.chunks.join("")).toBe("You wake in a cell.");
  });
```

`tests/server/dm/context.test.ts`: in the "buildContext includes only completed rounds" test, add `store.saveNpcs(c.id, [{ name: "Rat", attitude: "hostile", condition: "unhurt" }]);` before `buildContext`, and add `expect(ctx.npcs).toEqual([{ name: "Rat", attitude: "hostile", condition: "unhurt" }]);`.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/server/dm`. Expected: FAIL (missing exports, `revive` and `npcs`).

- [ ] **Step 3: Implement**

`src/server/dm/context.ts`:
- Import `Npc`.
- `export interface DmContext { campaign: Campaign; characters: Character[]; npcs: Npc[]; recentRounds: RoundTranscript[] }`.
- In `buildContext`, return `{ campaign, characters, npcs: store.getNpcs(campaignId), recentRounds: … }`.

`src/server/dm/prompts.ts`:
- Import `Npc`.
- In `systemPrompt`, directly after the `"- Use set_scene whenever the party arrives somewhere new.",` line, add:

```ts
    "- Keep the Nearby list true: when a notable NPC or group appears, add them with an npc op; when their attitude or condition changes (an attack lands, they are persuaded, they flee), update them; when they leave, npc_gone them. Put set_scene before npc ops when the party moves.",
```

- Add:

```ts
export function nearbyBlock(npcs: Npc[]): string {
  if (npcs.length === 0) return "Nearby: nobody notable.";
  return ["Nearby (authoritative):", ...npcs.map((n) => `- ${n.name}: ${n.attitude}, ${n.condition}`)].join("\n");
}

export function reviveTask(): string {
  return [
    "The whole party has fallen. Narrate, in 2-3 short paragraphs, how they survive against the odds: they might be captured, rescued by someone unexpected, or wake somewhere strange.",
    "Keep consequences: enemies who beat them may still be around, and things may have been taken from them (remove_item those).",
    "Do not add heal ops: the app restores everyone to half health. You may use set_scene, npc and npc_gone. End by inviting the players to act.",
    'Reply as JSON: {"narration": "<story text>", "changes": [<ops>]}.',
  ].join("\n");
}
```

- In `openingTask`, change its second line to:
  `"Include a set_scene op naming the opening location, and an npc op for each notable character or group present. Do not add items: the characters already have their starting kits.",`
- In `buildMessages`' `render`, insert `nearbyBlock(ctx.npcs),` directly after `partyBlock(ctx.characters),`.

`src/server/dm/dm.ts`:
- Import `reviveTask`.
- Add `revive(ctx: DmContext, stream: StreamHandlers): Promise<ResolveOutput>;` to the interface.
- Add to the returned object:

```ts
    revive(ctx, stream) {
      return callStructured(buildMessages(ctx, rules, reviveTask(), budgetTokens), ResolveParseSchema, resolveFormat, stream);
    },
```

Test fakes:
- `tests/server/app.test.ts` `fakeDm`: add `revive: async () => ({ narration: "You wake.", changes: [] }),`.
- `tests/server/turns/turns.test.ts` `FakeDm`: add `async revive() { return { narration: "Revived.", changes: [] }; }`. Task 4 replaces this with a configurable version.

- [ ] **Step 4: Run all the checks, then commit**

Run: `npx vitest run && npm run typecheck && npm run build`. All green.

```bash
git add -A src tests
git commit -m "feat: show the DM the Nearby list and add the revive prompt"
```

---

### Task 4: The fallen state, revive, NPC persistence and recovery

**Files:**
- Modify: `src/shared/types.ts`, `src/server/turns/turns.ts`, `src/server/routes/ws.ts`
- Test: `tests/server/turns/turns.test.ts`, `tests/server/app.test.ts`

**Interfaces:**
- Consumes: `rules.applyOps(chars, ops, npcs)`, `rules.reviveHp`, `store.getNpcs/saveNpcs`, `dm.revive`.
- Produces:
  - `AiPhase` includes `"reviving"` (and so does `AI_PHASES`).
  - `RoundState` includes `"fallen"`.
  - The `GameEvent` `{ type: "party_fallen" }`.
  - The `ClientMsg` `{ t: "revive" }`.
  - `TurnService.revive(id): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

In `tests/server/turns/turns.test.ts`:

(a) Make `FakeDm` revive configurable:
- Add `"revive"` to the `failNext` union type.
- Add the field `nextReviveChanges: unknown[] = [];`.
- Replace its `revive` with:

```ts
  async revive(_ctx: DmContext, stream: StreamHandlers) {
    await tick();
    if (this.failNext === "revive") { this.failNext = null; throw new DmError("revive failed"); }
    stream.onChunk("You wake");
    const changes = this.nextReviveChanges; this.nextReviveChanges = [];
    return { narration: "You wake in a cell.", changes };
  }
```

(b) Replace the body of the test "downed characters can't act, unless the whole party is down" from its second `store.saveCharacter` line onwards, so its tail reads:

```ts
    store.saveCharacter({ ...store.getCharacter(chars[0].id)!, hp: 0 });
    await turns.submitAction(id, chars[1].id, "I crawl");
    expect(store.getCampaign(id)!.roundState).toBe("collecting"); // waiting for Corvin too
    await turns.submitAction(id, chars[0].id, "I gasp");
    expect(store.getCampaign(id)).toMatchObject({ roundNumber: 3, roundState: "fallen" });
```

(c) Append these tests:

```ts
  it("the party falls when every hero ends a round at 0 HP, and nobody can act", async () => {
    const { store, dm, turns, id, chars } = await begun();
    dm.nextChanges = [{ op: "damage", character: "Corvin", amount: 50 }, { op: "damage", character: "Wren", amount: 50 }];
    await turns.submitAction(id, chars[0].id, "I charge");
    await turns.submitAction(id, chars[1].id, "I charge too");
    expect(store.getCampaign(id)).toMatchObject({ roundState: "fallen", roundNumber: 2 });
    expect(store.getEvents(id).some((e) => e.type === "party_fallen")).toBe(true);
    const msg = "The party has fallen. Revive or start a new campaign.";
    await expect(turns.submitAction(id, chars[0].id, "I crawl")).rejects.toThrow(msg);
    await expect(turns.skip(id, chars[0].id, chars[0].id)).rejects.toThrow(msg);
    await expect(turns.roll(id, chars[0].id)).rejects.toThrow(msg);
  });

  it("revive brings everyone back at half HP and ignores HP changes from the DM", async () => {
    const { store, dm, turns, id, chars } = await begun();
    dm.nextChanges = [{ op: "damage", character: "Corvin", amount: 50 }, { op: "damage", character: "Wren", amount: 50 }];
    await turns.submitAction(id, chars[0].id, "a");
    await turns.submitAction(id, chars[1].id, "b");
    dm.nextReviveChanges = [
      { op: "heal", character: "Corvin", amount: 20 },
      { op: "damage", character: "Wren", amount: 3 },
      { op: "set_scene", title: "The Cells" },
      { op: "npc", name: "Jailer", attitude: "wary", condition: "unhurt" },
    ];
    await turns.revive(id);
    expect(store.getCharacters(id).map((c) => c.hp)).toEqual([10, 10]);
    expect(store.getCampaign(id)).toMatchObject({ roundState: "collecting", roundNumber: 3, sceneTitle: "The Cells" });
    expect(store.getNpcs(id)).toEqual([{ name: "Jailer", attitude: "wary", condition: "unhurt" }]);
    const rejected = store.getEvents(id).filter((e) => e.type === "op_rejected");
    expect(rejected.map((e) => e.type === "op_rejected" && e.reason)).toEqual(["HP is set by the revive", "HP is set by the revive"]);
    await expect(turns.revive(id)).rejects.toThrow("Nobody needs reviving.");
  });

  it("a failed revive stalls and can be retried", async () => {
    const { store, dm, turns, id, chars } = await begun("solo", ["Corvin"]);
    dm.nextChanges = [{ op: "damage", character: "Corvin", amount: 50 }];
    await turns.submitAction(id, chars[0].id, "a");
    dm.failNext = "revive";
    await turns.revive(id);
    expect(store.getCampaign(id)).toMatchObject({ roundState: "stalled", stalledPhase: "reviving" });
    await turns.retry(id);
    expect(store.getCampaign(id)!.roundState).toBe("collecting");
    expect(store.getCharacter(chars[0].id)!.hp).toBe(10);
  });

  it("recoverInterrupted turns a collecting campaign whose heroes are all at 0 HP into fallen", async () => {
    const a = await begun();
    for (const ch of a.chars) a.store.saveCharacter({ ...a.store.getCharacter(ch.id)!, hp: 0 });
    a.turns.recoverInterrupted();
    expect(a.store.getCampaign(a.id)!.roundState).toBe("fallen");
    expect(a.store.getEvents(a.id).some((e) => e.type === "party_fallen")).toBe(true);

    const b = await begun();
    b.store.saveCharacter({ ...b.store.getCharacter(b.chars[0].id)!, hp: 0 });
    b.turns.recoverInterrupted();
    expect(b.store.getCampaign(b.id)!.roundState).toBe("collecting");
  });

  it("NPCs persist across rounds and appear in snapshots", async () => {
    const { store, dm, hub, turns, id, chars } = await begun("solo", ["Corvin"]);
    dm.nextChanges = [{ op: "npc", name: "Scarred Brute", attitude: "hostile", condition: "unhurt" }];
    await turns.submitAction(id, chars[0].id, "I look around");
    dm.nextChanges = [{ op: "npc", name: "scarred brute", attitude: "hostile", condition: "wounded" }];
    await turns.submitAction(id, chars[0].id, "I hit him");
    expect(store.getNpcs(id)).toEqual([{ name: "scarred brute", attitude: "hostile", condition: "wounded" }]);
    const snap = hub.msgs.filter((m) => m.t === "snapshot").at(-1);
    expect(snap && snap.t === "snapshot" && snap.snapshot.npcs).toEqual([{ name: "scarred brute", attitude: "hostile", condition: "wounded" }]);
  });
```

(d) In `tests/server/app.test.ts`, inside the existing "plays over the WebSocket" test, after the existing `roll` error assertion, add:

```ts
    ws.send(JSON.stringify({ t: "revive" }));
    expect(await waitFor((m) => m.t === "error" && m.message === "Nobody needs reviving.")).toBeTruthy();
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/server/turns tests/server/app.test.ts`
Expected: FAIL (`revive` is missing, there is no fallen state, and NPCs aren't saved).

- [ ] **Step 3: Update the shared types**

In `src/shared/types.ts`:

```ts
export type AiPhase = "opening" | "adjudicating" | "resolving" | "reviving";
export type RoundState = "lobby" | "collecting" | "awaiting_rolls" | "stalled" | "fallen" | AiPhase;
export const AI_PHASES: readonly AiPhase[] = ["opening", "adjudicating", "resolving", "reviving"];
```

- Add `| { type: "party_fallen" }` to `GameEvent`, before the `stall` member.
- Add `| { t: "revive" }` to `ClientMsg`.

- [ ] **Step 4: Update the turn service**

In `src/server/turns/turns.ts`:

(1) Add near the top:

```ts
const FALLEN_MESSAGE = "The party has fallen. Revive or start a new campaign.";
const isHpOp = (o: unknown) => typeof o === "object" && o !== null && ["damage", "heal"].includes(String((o as { op?: unknown }).op));
```

(2) In `submitAction`, `skip` and `roll`, add this as the first line after `const c = this.campaign(id);`:

```ts
      if (c.roundState === "fallen") throw new GameError(FALLEN_MESSAGE);
```

(3) Add a public method after `retry`:

```ts
  revive(id: number): Promise<void> {
    return this.locked(id, async () => {
      const c = this.campaign(id);
      if (c.roundState !== "fallen") throw new GameError("Nobody needs reviving.");
      await this.runRevive(id);
    });
  }
```

(4) In `retry`, before the final `else`, add `else if (c.stalledPhase === "reviving") await this.runRevive(id);`.

(5) In `recoverInterrupted`, inside the loop after the existing `if`, add:

```ts
      if (s.roundState === "collecting") {
        const chars = this.deps.store.getCharacters(s.id);
        if (chars.length > 0 && chars.every((ch) => this.deps.rules.isDowned(ch))) {
          const c = this.campaign(s.id);
          this.deps.store.appendEvent(s.id, Math.max(0, c.roundNumber - 1), { type: "party_fallen" });
          this.deps.store.updateCampaign(s.id, { roundState: "fallen" });
        }
      }
```

(6) Add the revive phase next to `runOpening`:

```ts
  private runRevive(id: number): Promise<void> {
    return this.runPhase(id, "reviving", async () => {
      const out = await this.deps.dm.revive(buildContext(this.deps.store, id), this.stream(id));
      this.commitNarration(id, out, "revive");
    });
  }
```

(7) Replace `commitNarration` with:

```ts
  /** Applies a DM reply atomically. Characters are re-read here so changes made during generation survive. */
  private commitNarration(id: number, out: ResolveOutput, mode: "normal" | "revive" = "normal"): void {
    const { store, rules } = this.deps;
    store.transaction(() => {
      const c = this.campaign(id);
      const blocked = mode === "revive" ? out.changes.filter(isHpOp) : [];
      const changes = mode === "revive" ? out.changes.filter((o) => !isHpOp(o)) : out.changes;
      const result = rules.applyOps(store.getCharacters(id), changes, store.getNpcs(id));
      if (mode === "revive") for (const ch of result.characters) ch.hp = rules.reviveHp(ch);
      for (const ch of result.characters) store.saveCharacter(ch);
      store.saveNpcs(id, result.npcs);
      store.appendEvent(id, c.roundNumber, { type: "narration", text: out.narration });
      for (const op of result.applied) store.appendEvent(id, c.roundNumber, { type: "op_applied", op });
      for (const r of result.rejected) store.appendEvent(id, c.roundNumber, { type: "op_rejected", op: r.op, reason: r.reason });
      for (const op of blocked) store.appendEvent(id, c.roundNumber, { type: "op_rejected", op, reason: "HP is set by the revive" });
      const fallen = mode === "normal" && result.characters.length > 0 && result.characters.every((ch) => rules.isDowned(ch));
      if (fallen) store.appendEvent(id, c.roundNumber, { type: "party_fallen" });
      store.updateCampaign(id, {
        roundState: fallen ? "fallen" : "collecting", stalledPhase: null, roundNumber: c.roundNumber + 1,
        ...(result.sceneTitle ? { sceneTitle: result.sceneTitle } : {}),
      });
    });
  }
```

(8) In `src/server/routes/ws.ts`:
- Add `z.object({ t: z.literal("revive") }),` to `ClientMsgSchema`.
- Add `case "revive": return turns.revive(campaignId);` to `dispatch`.

- [ ] **Step 5: Run all the checks, then commit**

Run: `npx vitest run && npm run typecheck && npm run build`. All green.

If the client fails to typecheck because `ActionBar`'s `switch (campaign.roundState)` doesn't handle `"fallen"`/`"reviving"`, add only:

```ts
      case "reviving":
```

below `case "resolving":`. Task 5 builds the fallen panel.

```bash
git add -A src tests
git commit -m "feat: party falls at 0 HP, revive at half HP, NPCs persist"
```

---

### Task 5: Play screen: the Nearby strip, quick actions, the fallen panel and story entry

**Files:**
- Create: `src/client/lib/npcs.ts`, `src/client/components/NearbyStrip.tsx`
- Modify: `src/client/components/ActionBar.tsx`, `src/client/lib/story.ts`, `src/client/components/Story.tsx`, `src/client/theme.css`
- Test: `tests/client/npcs.test.ts`, `tests/client/story.test.ts`

**Interfaces:**
- Consumes: `Snapshot.npcs`, `Npc`, `RoundState` `"fallen"`/`"reviving"`, `ClientMsg` `{t:"revive"}`, the `party_fallen` event.
- Produces:
  - `QuickAction = "attack" | "talk" | "watch"`.
  - `quickActionText(kind, name): string`.
  - `appendAction(current, sentence): string`.
  - `<NearbyStrip npcs={Npc[]} canAct={boolean} onPick={(sentence: string) => void} />`.
  - `StoryEntry` kind `"fallen"`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/client/npcs.test.ts
import { describe, expect, it } from "vitest";
import { appendAction, quickActionText } from "../../src/client/lib/npcs";

describe("quick actions", () => {
  it("builds the sentence for each action", () => {
    expect(quickActionText("attack", "Scarred Brute")).toBe("I attack Scarred Brute");
    expect(quickActionText("talk", "Barkeep")).toBe("I talk to Barkeep");
    expect(quickActionText("watch", "Mercenaries (3)")).toBe("I watch Mercenaries (3) closely");
  });

  it("fills an empty box and appends to typed text without losing it", () => {
    expect(appendAction("", "I attack Scarred Brute")).toBe("I attack Scarred Brute");
    expect(appendAction("   ", "I attack Scarred Brute")).toBe("I attack Scarred Brute");
    expect(appendAction("I scream and", "I attack Scarred Brute")).toBe("I scream and I attack Scarred Brute");
    expect(appendAction("I scream and  ", "I attack Scarred Brute")).toBe("I scream and I attack Scarred Brute");
  });
});
```

Append to `tests/client/story.test.ts`:

```ts
describe("party fallen", () => {
  it("adds a fallen entry to the story", () => {
    const story = buildStory([ev(9, { type: "party_fallen" })], chars);
    expect(story).toEqual([expect.objectContaining({ kind: "fallen" })]);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/client`. Expected: FAIL (the module is missing and there is no fallen entry).

- [ ] **Step 3: Write the helpers and the story entry**

```ts
// src/client/lib/npcs.ts
export type QuickAction = "attack" | "talk" | "watch";

export function quickActionText(kind: QuickAction, name: string): string {
  switch (kind) {
    case "attack": return `I attack ${name}`;
    case "talk": return `I talk to ${name}`;
    case "watch": return `I watch ${name} closely`;
  }
}

/** Adds a quick-action sentence to whatever the player has already typed, never discarding it. */
export function appendAction(current: string, sentence: string): string {
  const kept = current.trimEnd();
  return kept ? `${kept} ${sentence}` : sentence;
}
```

`src/client/lib/story.ts`:
- Add `| { kind: "fallen"; id: number }` to `StoryEntry`.
- In the main `switch (e.type)`, add `case "party_fallen": out.push({ kind: "fallen", id: e.id }); break;`.

`src/client/components/Story.tsx`: add `case "fallen": return <p key={e.id} className="story-fallen">The party has fallen.</p>;`.

- [ ] **Step 4: Build the Nearby strip**

```tsx
// src/client/components/NearbyStrip.tsx
import { useEffect, useRef, useState } from "react";
import type { Npc } from "../../shared/types";
import { quickActionText, type QuickAction } from "../lib/npcs";

const ACTIONS: [QuickAction, string][] = [["attack", "⚔ Attack"], ["talk", "💬 Talk to"], ["watch", "👁 Watch"]];

export function NearbyStrip({ npcs, canAct, onPick }: { npcs: Npc[]; canAct: boolean; onPick: (sentence: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  useEffect(() => { if (!canAct) setOpen(null); }, [canAct]);

  if (npcs.length === 0) return null;
  return (
    <div className="nearby" ref={ref}>
      <span className="nearby-label">Nearby</span>
      <div className="nearby-chips">
        {npcs.map((n) => (
          <div key={n.name} className="npc-wrap">
            <button type="button" className={`npc-chip npc-${n.attitude}${n.condition === "down" ? " npc-down" : ""}`}
              disabled={!canAct} aria-expanded={open === n.name} title={`${n.attitude}, ${n.condition}`}
              onClick={() => setOpen(open === n.name ? null : n.name)}>
              <span className="npc-name">{n.name}</span>
              <small className="npc-condition">{n.condition}</small>
            </button>
            {open === n.name && (
              <div className="npc-menu" role="menu">
                {ACTIONS.map(([kind, label]) => (
                  <button key={kind} type="button" role="menuitem" onClick={() => { onPick(quickActionText(kind, n.name)); setOpen(null); }}>{label}</button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Update the ActionBar**

In `src/client/components/ActionBar.tsx`:
- Import `NearbyStrip` and `appendAction`.
- After the `responded` helper, compute:

```ts
  const canAct = !!me && campaign.roundState === "collecting" && activeIds.includes(me.id) && !responded(me.id);
  const fallenPanel = (
    <div className="stack">
      <p className="fallen-title">The party has fallen</p>
      <div className="row">
        <button className="btn btn-primary" onClick={() => send({ t: "revive" })}>Revive</button>
        <a className="btn btn-ghost" href="#/new">Start a new campaign</a>
      </div>
    </div>
  );
```

- Change `if (!me) {` to `if (campaign.roundState === "fallen") { body = fallenPanel; } else if (!me) {`.
- Add `case "reviving":` directly below `case "resolving":` (keep it if Task 4 already added it).
- Change the final return to:

```tsx
  return (
    <div className="action-bar">
      <NearbyStrip npcs={snapshot.npcs} canAct={canAct} onPick={(s) => setText((t) => appendAction(t, s))} />
      {body}
      {error && <p className="error">{error}</p>}
    </div>
  );
```

- [ ] **Step 6: Add the styles**

Append to `src/client/theme.css`, before the `@media (max-width: 899px)` block:

```css
/* Nearby NPCs */
.nearby { display: flex; align-items: center; gap: .6rem; margin-bottom: .75rem; min-width: 0; }
.nearby-label { font-family: var(--font-display); font-size: .7rem; letter-spacing: .14em; text-transform: uppercase; color: var(--muted); flex: none; }
.nearby-chips { display: flex; gap: .5rem; overflow-x: auto; padding-bottom: 2px; min-width: 0; }
.npc-wrap { position: relative; flex: none; }
.npc-chip { display: flex; flex-direction: column; align-items: flex-start; background: var(--panel); border: 1px solid var(--border-soft); border-left: 3px solid var(--muted); border-radius: 8px; padding: .25em .7em; color: var(--text); font: inherit; line-height: 1.2; cursor: pointer; }
.npc-chip:disabled { cursor: default; }
.npc-chip .npc-name { font-size: .9rem; white-space: nowrap; }
.npc-chip .npc-condition { font-size: .7rem; color: var(--muted); }
.npc-hostile { border-left-color: var(--danger); }
.npc-hostile .npc-name { color: var(--danger); }
.npc-wary { border-left-color: var(--gold); }
.npc-neutral { border-left-color: var(--muted); }
.npc-friendly { border-left-color: var(--success); }
.npc-down { opacity: .5; }
.npc-down .npc-name { text-decoration: line-through; }
.npc-menu { position: absolute; bottom: calc(100% + 6px); left: 0; z-index: 30; display: flex; flex-direction: column; min-width: 9rem; background: #1f150d; border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 8px 24px rgba(0,0,0,.5); overflow: hidden; }
.npc-menu button { background: none; border: 0; color: var(--text); text-align: left; padding: .5em .9em; font: inherit; cursor: pointer; }
.npc-menu button:hover, .npc-menu button:focus-visible { background: var(--panel); outline: none; }
/* The party falls */
.fallen-title { font-family: var(--font-display); color: var(--danger); letter-spacing: .06em; margin: 0; font-size: 1.1rem; }
.story-fallen { display: inline-block; font-family: var(--font-display); color: var(--danger); border: 1px solid var(--danger); border-radius: 6px; padding: .3em .8em; margin: 0 0 1em; }
```

The menu opens upwards from the bottom-anchored action bar. `.nearby-chips` scrolls sideways on its own, so the page never gets wider.

Note: `.nearby-chips { overflow-x: auto }` clips an absolutely positioned menu vertically. If the menu is clipped, move the menu out of the scroll container:
- render it as a sibling of `.nearby-chips` inside `.nearby`, which needs `position: relative`;
- position it using the clicked chip's `offsetLeft` minus the container's `scrollLeft`.

Check this in Step 7 and pick whichever renders correctly.

- [ ] **Step 7: Verify, then commit**

Run: `npx vitest run && npm run typecheck && npm run build`. All green.

Then run a non-interactive server check:
- start `PORT=3100 TABLE_PASSWORD=x DB_PATH=/tmp/adm-npc/game.sqlite npm start` in the background;
- curl `/` and the built JS;
- stop it.

List these browser checks as deferred: chip colours, the menu opening upwards and not being clipped, quick-action fill and append, the fallen panel, and no horizontal scroll at 390 px.

```bash
git add -A src tests
git commit -m "feat: Nearby NPC strip with quick actions and the party-fallen panel"
```

---

### Task 6: Smoke counter, real 9b run and README

**Files:**
- Modify: `scripts/smoke.ts`, `README.md`

- [ ] **Step 1: Add the NPC counter to the smoke report**

In `scripts/smoke.ts`, after the `sheet changes` lines, add:

```ts
const npcUpdates = opCount("npc") + opCount("npc_gone");
console.log(`npc updates: ${npcUpdates}`);
if (npcUpdates === 0) console.log("WARNING: the DM never updated the Nearby list");
```

(`opCount` already exists; check that its parameter type accepts these op names, and widen it to `Op["op"]` if needed.)

- [ ] **Step 2: Run against the real model**

Run: `OLLAMA_MODEL=qwen3.5:9b npm run smoke` (it takes about 3–5 minutes; use a long timeout and don't use `timeout`, which isn't installed). Record the full Report section.

Expected:
- exit code 0;
- `npc updates` ≥ 1;
- `stalls: 0`.

If `npc updates` is 0, report DONE_WITH_CONCERNS with the evidence. Don't add another AI call.

- [ ] **Step 3: README**

Under "## Playing", add two bullets:

```markdown
- **Nearby**: the people in the scene appear above the action box, coloured by attitude (red hostile, amber wary, grey neutral, green friendly) with their condition. Tap one for Attack / Talk to / Watch, which fills in your action so names are never misspelt.
- **When the whole party falls**, play stops with a choice: **Revive** (everyone wakes at half HP and the Dungeon Master decides how you survived) or **Start a new campaign**.
```

- [ ] **Step 4: Commit**

```bash
git add scripts/smoke.ts README.md
git commit -m "docs: Nearby and party-fall in README; smoke counts NPC updates"
```
