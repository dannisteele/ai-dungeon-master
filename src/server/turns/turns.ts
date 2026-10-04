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
const FALLEN_MESSAGE = "The party has fallen. Revive or start a new campaign.";
const isHpOp = (o: unknown) => typeof o === "object" && o !== null && ["damage", "heal"].includes(String((o as { op?: unknown }).op));
const hasResponded = (s: RoundStatus, id: number) => s.actions.some((a) => a.characterId === id) || s.skippedIds.includes(id);
const nameOf = (chars: Character[], id: number) => chars.find((c) => c.id === id)?.name ?? "Someone";

export class TurnService {
  private locks = new Map<number, Promise<unknown>>();
  private background = new Set<Promise<void>>();
  /** In-flight summary per campaign (background or recap), so the two never overlap. */
  private summarising = new Map<number, Promise<void>>();

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
      if (c.roundState === "fallen") throw new GameError(FALLEN_MESSAGE);
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
      if (c.roundState === "fallen") throw new GameError(FALLEN_MESSAGE);
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
      if (c.roundState === "fallen") throw new GameError(FALLEN_MESSAGE);
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
      else if (c.stalledPhase === "reviving") await this.runRevive(id);
      else await this.runResolve(id);
    });
  }

  revive(id: number): Promise<void> {
    return this.locked(id, async () => {
      const c = this.campaign(id);
      if (c.roundState !== "fallen") throw new GameError("Nobody needs reviving.");
      await this.runRevive(id);
    });
  }

  /**
   * The story so far, for the recap panel. Returns the stored summary when it already covers every
   * finished round; otherwise has the DM summarise just the new rounds. Never takes the campaign
   * lock (play carries on), but waits for any in-flight summary rather than overlapping it.
   */
  async recap(id: number): Promise<{ summary: string; throughRound: number }> {
    if (this.campaign(id).roundNumber - 1 < 1) return { summary: "", throughRound: 0 };
    for (let running = this.summarising.get(id); running; running = this.summarising.get(id)) {
      await running.catch(() => undefined);
    }
    const through = this.campaign(id).roundNumber - 1;
    const lastThrough = this.lastSummaryThrough(id);
    if (lastThrough >= through) return { summary: this.campaign(id).summary, throughRound: lastThrough };
    const p = this.summariseRange(id, lastThrough + 1, through);
    this.trackSummary(id, p);
    await p;
    this.broadcastSnapshot(id);
    return { summary: this.campaign(id).summary, throughRound: through };
  }

  /** Call once at startup: a phase that was running when the server stopped can never finish. */
  recoverInterrupted(): void {
    for (const s of this.deps.store.listCampaigns()) {
      if ((AI_PHASES as readonly string[]).includes(s.roundState)) {
        this.deps.store.updateCampaign(s.id, { roundState: "stalled", stalledPhase: s.roundState as AiPhase });
      }
      if (s.roundState === "collecting") {
        const chars = this.deps.store.getCharacters(s.id);
        if (chars.length > 0 && chars.every((ch) => this.deps.rules.isDowned(ch))) {
          const c = this.campaign(s.id);
          this.deps.store.appendEvent(s.id, Math.max(0, c.roundNumber - 1), { type: "party_fallen" });
          this.deps.store.updateCampaign(s.id, { roundState: "fallen" });
        }
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

  private runRevive(id: number): Promise<void> {
    return this.runPhase(id, "reviving", async () => {
      const out = await this.deps.dm.revive(buildContext(this.deps.store, id), this.stream(id));
      this.commitNarration(id, out, "revive");
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
      this.maybeSpawnSummary(id, c.roundNumber);
    });
  }

  /** Applies a DM reply atomically. Characters are re-read here so changes made during generation survive. */
  private commitNarration(id: number, out: ResolveOutput, mode: "normal" | "revive" = "normal"): void {
    const { store, rules } = this.deps;
    store.transaction(() => {
      const c = this.campaign(id);
      const blocked = mode === "revive" ? out.changes.filter(isHpOp) : [];
      const changes = mode === "revive" ? out.changes.filter((o) => !isHpOp(o)) : out.changes;
      const result = rules.applyOps(store.getCharacters(id), changes, store.getNpcs(id));
      if (mode === "revive") for (const ch of result.characters) ch.hp = Math.max(ch.hp, rules.reviveHp(ch));
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

  /** The last round covered by a successful summary, or 0 if none has ever landed. */
  private lastSummaryThrough(id: number): number {
    let last = 0;
    for (const e of this.deps.store.getEvents(id)) if (e.type === "summary") last = e.throughRound;
    return last;
  }

  /**
   * Summaries run in the background so they never block play. If one is already in flight for
   * this campaign, we skip rather than overlap it; if the gap since the last successful summary
   * has reached SUMMARY_EVERY rounds, spawn one covering the whole unsummarised gap. A failed
   * summary leaves the gap open, so it's naturally retried (widened) after the next round.
   */
  private maybeSpawnSummary(id: number, through: number): void {
    if (this.summarising.has(id)) return;
    const lastThrough = this.lastSummaryThrough(id);
    if (through - lastThrough >= SUMMARY_EVERY) this.spawnSummary(id, lastThrough + 1, through);
  }

  /** Summarises rounds fromRound..throughRound into the campaign summary (the DM's long-term memory). */
  private async summariseRange(id: number, fromRound: number, throughRound: number): Promise<void> {
    const { store, dm } = this.deps;
    const c = this.campaign(id);
    // The opening narration is stored as round 0, so the first summary must start there, or the
    // story so far (and the DM's long-term memory) loses the premise: where the party began and why.
    const events = store.getEvents(id, { fromRound: fromRound <= 1 ? 0 : fromRound, toRound: throughRound });
    const text = await dm.summarise(c.summary, transcriptFromEvents(events, store.getCharacters(id)));
    store.updateCampaign(id, { summary: text });
    store.appendEvent(id, this.campaign(id).roundNumber, { type: "summary", text, throughRound });
  }

  private trackSummary(id: number, p: Promise<void>): void {
    this.summarising.set(id, p);
    void p.catch(() => undefined).finally(() => { if (this.summarising.get(id) === p) this.summarising.delete(id); });
  }

  private spawnSummary(id: number, fromRound: number, throughRound: number): void {
    const p = this.summariseRange(id, fromRound, throughRound).catch((e) => {
      console.warn(`[campaign ${id}] summary failed (will retry after the next round):`, (e as Error).message);
    });
    this.trackSummary(id, p);
    this.background.add(p);
    void p.finally(() => this.background.delete(p));
  }
}
