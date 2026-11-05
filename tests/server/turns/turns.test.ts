import { describe, expect, it } from "vitest";
import { buildContext, type DmContext } from "../../../src/server/dm/context";
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
  nextReviveChanges: unknown[] = [];
  failNext: "adjudicate" | "resolve" | "opening" | "revive" | null = null;
  summaries = 0;
  summariseFailNext = false;
  summariseGate: Promise<void> | null = null;
  summaryPeopleIn: { name: string; about: string }[][] = [];
  summaryCalls: { old: string; pinned: string }[] = [];
  summaryRounds: number[][] = [];
  nextSummaryPeople: { name: string; about: string }[] = [];
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
  async revive(_ctx: DmContext, stream: StreamHandlers) {
    await tick();
    if (this.failNext === "revive") { this.failNext = null; throw new DmError("revive failed"); }
    stream.onChunk("You wake");
    const changes = this.nextReviveChanges; this.nextReviveChanges = [];
    return { narration: "You wake in a cell.", changes };
  }
  async startingKit() { return [{ name: "Rope", description: "30ft" }]; }
  async summarise(old: string, rounds: unknown[], people: { name: string; about: string }[] = [], pinned = "") {
    this.summaries++;
    this.summaryCalls.push({ old, pinned });
    this.summaryRounds.push((rounds as { round: number }[]).map((r) => r.round));
    this.summaryPeopleIn.push(people);
    if (this.summariseGate) await this.summariseGate;
    if (this.summariseFailNext) { this.summariseFailNext = false; throw new Error("summary failed"); }
    const out = this.nextSummaryPeople; this.nextSummaryPeople = [];
    return { summary: `summary of ${rounds.length} rounds`, people: out };
  }
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

  it("dice off: resolves without adjudicating", async () => {
    const { store, dm, turns, id, chars } = await begun("solo", ["Corvin"]);
    store.updateCampaign(id, { dice: "off" });
    dm.nextChecks = [{ character: "Corvin", ability: "STR", dc: 14, reason: "heavy gate" }];
    await turns.submitAction(id, chars[0].id, "I force the gate");
    expect(dm.adjudicateCalls).toEqual([]);
    expect(dm.resolveCalls).toHaveLength(1);
    expect(dm.resolveCalls[0].rolls).toEqual([]);
    expect(store.getCampaign(id)!.roundState).toBe("collecting");
  });

  it("dice big: keeps at most one check a round", async () => {
    const { store, dm, turns, id, chars } = await begun("party", ["Corvin", "Wren"]);
    store.updateCampaign(id, { dice: "big" });
    dm.nextChecks = [
      { character: "Corvin", ability: "STR", dc: 14, reason: "heavy gate" },
      { character: "Wren", ability: "DEX", dc: 12, reason: "slip past" },
    ];
    await turns.submitAction(id, chars[0].id, "I force the gate");
    await turns.submitAction(id, chars[1].id, "I slip past");
    const checks = store.getEvents(id, { fromRound: 1, toRound: 1 }).filter((e) => e.type === "check_request");
    expect(checks).toHaveLength(1);
    expect(checks[0]).toMatchObject({ characterId: chars[0].id, reason: "heavy gate" });
  });

  it("switching dice off while rolls are pending still takes the roll this round", async () => {
    const { store, dm, turns, id, chars, setDie } = await begun("solo", ["Corvin"]);
    dm.nextChecks = [{ character: "Corvin", ability: "STR", dc: 14, reason: "heavy gate" }];
    await turns.submitAction(id, chars[0].id, "I force the gate");
    expect(store.getCampaign(id)!.roundState).toBe("awaiting_rolls");
    store.updateCampaign(id, { dice: "off" });
    setDie(15);
    await turns.roll(id, chars[0].id);
    expect(dm.resolveCalls[0].rolls).toHaveLength(1);
    expect(store.getCampaign(id)!.roundState).toBe("collecting");
    await turns.submitAction(id, chars[0].id, "I walk on");
    expect(dm.adjudicateCalls).toHaveLength(1);
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
    expect(store.getCampaign(id)).toMatchObject({ roundNumber: 3, roundState: "fallen" });
  });

  it("recoverInterrupted turns AI phases into stalls", async () => {
    const { store, turns, id } = await begun();
    store.updateCampaign(id, { roundState: "resolving" });
    turns.recoverInterrupted();
    expect(store.getCampaign(id)).toMatchObject({ roundState: "stalled", stalledPhase: "resolving" });
  });

  describe("story-so-far recap", () => {
    it("returns nothing before any round has been played, without asking the DM", async () => {
      const { dm, turns, id } = await begun("solo", ["Corvin"]);
      expect(await turns.recap(id)).toEqual({ summary: "", throughRound: 0, editedThrough: null });
      expect(dm.summaries).toBe(0);
    });

    it("summarises the played rounds, stores it, and reuses it until the story moves on", async () => {
      const { store, dm, turns, id, chars } = await begun("solo", ["Corvin"]);
      for (let i = 0; i < 3; i++) await turns.submitAction(id, chars[0].id, `act ${i}`);
      expect(await turns.recap(id)).toEqual({ summary: "summary of 4 rounds", throughRound: 3, editedThrough: null });
      expect(store.getCampaign(id)!.summary).toBe("summary of 4 rounds");
      expect(store.getEvents(id).filter((e) => e.type === "summary")).toEqual([expect.objectContaining({ throughRound: 3 })]);

      expect(await turns.recap(id)).toEqual({ summary: "summary of 4 rounds", throughRound: 3, editedThrough: null });
      expect(dm.summaries).toBe(1);

      await turns.submitAction(id, chars[0].id, "act 3");
      expect(await turns.recap(id)).toEqual({ summary: "summary of 1 rounds", throughRound: 4, editedThrough: null });
      expect(dm.summaries).toBe(2);
    });

    it("waits for a background summary instead of running alongside it", async () => {
      const { dm, turns, id, chars } = await begun("solo", ["Corvin"]);
      let release!: () => void;
      dm.summariseGate = new Promise((res) => { release = res; });
      for (let i = 0; i < 10; i++) await turns.submitAction(id, chars[0].id, `act ${i}`);
      expect(dm.summaries).toBe(1); // background summary started, stuck on the gate
      const pending = turns.recap(id);
      await tick();
      expect(dm.summaries).toBe(1); // recap is waiting, not overlapping
      release();
      expect(await pending).toEqual({ summary: "summary of 11 rounds", throughRound: 10, editedThrough: null });
      expect(dm.summaries).toBe(1);
    });

    it("passes a DM failure back to the caller and leaves the gap open", async () => {
      const { dm, turns, id, chars } = await begun("solo", ["Corvin"]);
      await turns.submitAction(id, chars[0].id, "act");
      dm.summariseFailNext = true;
      await expect(turns.recap(id)).rejects.toThrow("summary failed");
      expect(await turns.recap(id)).toEqual({ summary: "summary of 2 rounds", throughRound: 1, editedThrough: null });
    });
  });

  it("summarises every 10 rounds without blocking play", async () => {
    const { store, dm, turns, id, chars } = await begun("solo", ["Corvin"]);
    for (let i = 0; i < 10; i++) await turns.submitAction(id, chars[0].id, `act ${i}`);
    await turns.settle();
    expect(dm.summaries).toBe(1);
    expect(store.getCampaign(id)!.summary).toBe("summary of 11 rounds");
  });

  it("retries a failed summary on the next round, covering the whole gap", async () => {
    const { store, dm, turns, id, chars } = await begun("solo", ["Corvin"]);
    dm.summariseFailNext = true;
    for (let i = 0; i < 10; i++) await turns.submitAction(id, chars[0].id, `act ${i}`);
    await turns.settle();
    expect(dm.summaries).toBe(1);
    expect(store.getCampaign(id)!.summary).toBe("");
    expect(store.getEvents(id).some((e) => e.type === "summary")).toBe(false);

    await turns.submitAction(id, chars[0].id, "act 10");
    await turns.settle();
    expect(dm.summaries).toBe(2);
    expect(store.getCampaign(id)!.summary).toBe("summary of 12 rounds");
    expect(store.getEvents(id).filter((e) => e.type === "summary")).toEqual([
      expect.objectContaining({ text: "summary of 12 rounds", throughRound: 11 }),
    ]);
  });

  it("doesn't spawn a second summary while one is already in flight", async () => {
    const { store, dm, turns, id, chars } = await begun("solo", ["Corvin"]);
    let release: () => void = () => {};
    dm.summariseGate = new Promise((res) => { release = res; });
    for (let i = 0; i < 10; i++) await turns.submitAction(id, chars[0].id, `act ${i}`);
    // round 10's summary is now in flight, waiting on the gate.
    await turns.submitAction(id, chars[0].id, "act 10"); // round 11 completes while it's still pending
    expect(dm.summaries).toBe(1);

    release();
    await turns.settle();
    expect(dm.summaries).toBe(1);
    expect(store.getCampaign(id)!.summary).toBe("summary of 11 rounds");
  });

  it("broadcasts snapshots with round status", async () => {
    const { hub, turns, id, chars } = await begun();
    hub.msgs = [];
    await turns.submitAction(id, chars[0].id, "I wait");
    const snap = hub.msgs.filter((m) => m.t === "snapshot").at(-1);
    expect(snap && snap.t === "snapshot" && snap.snapshot.round.actions).toEqual([{ characterId: chars[0].id, text: "I wait" }]);
  });

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

  it("revive never lowers HP: a hero created fresh after the fall keeps full HP", async () => {
    const { store, dm, turns, id, chars } = await begun();
    dm.nextChanges = [{ op: "damage", character: "Corvin", amount: 50 }, { op: "damage", character: "Wren", amount: 50 }];
    await turns.submitAction(id, chars[0].id, "a");
    await turns.submitAction(id, chars[1].id, "b");
    expect(store.getCampaign(id)!.roundState).toBe("fallen");
    const fresh = store.createCharacter({
      campaignId: id, name: "Talia", concept: "hero", hp: 20, maxHp: 20, items: [],
      scores: { STR: 15, DEX: 10, CON: 10, INT: 8, WIS: 12, CHA: 8 },
    });
    await turns.revive(id);
    expect(store.getCharacter(fresh.id)!.hp).toBe(20);
    expect(store.getCharacter(chars[0].id)!.hp).toBe(10);
    expect(store.getCharacter(chars[1].id)!.hp).toBe(10);
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

  describe("editing the story so far", () => {
    it("pins the player's text word for word and clears the DM's summary", async () => {
      const { store, turns, id, chars } = await begun("solo", ["Corvin"]);
      for (let i = 0; i < 3; i++) await turns.submitAction(id, chars[0].id, `act ${i}`);
      await turns.recap(id);
      expect(await turns.editSummary(id, "  Corvin never found the key.  ")).toEqual({ summary: "Corvin never found the key.", throughRound: 3, editedThrough: 3 });
      expect(store.getCampaign(id)).toMatchObject({ pinnedSummary: "Corvin never found the key.", summary: "" });
      expect(store.getEvents(id).filter((e) => e.type === "summary").at(-1)).toMatchObject({ edited: true, throughRound: 3 });
    });

    it("later summaries cover only what came after, shown under 'Since then'", async () => {
      const { dm, turns, id, chars } = await begun("solo", ["Corvin"]);
      await turns.submitAction(id, chars[0].id, "act");
      await turns.editSummary(id, "Mine.");
      await turns.submitAction(id, chars[0].id, "act again");
      const recap = await turns.recap(id);
      expect(recap).toEqual({ summary: "Mine.\n\nSince then:\nsummary of 1 rounds", throughRound: 2, editedThrough: 1 });
      expect(dm.summaryCalls.at(-1)).toEqual({ old: "", pinned: "Mine." });
    });

    it("works before anything has happened, and the DM still sees its own opening", async () => {
      const { store, turns, id } = setup("solo", ["Corvin"]);
      expect(await turns.editSummary(id, "We are cousins who run a bakery.")).toEqual({ summary: "We are cousins who run a bakery.", throughRound: 0, editedThrough: -1 });
      expect(store.getCampaign(id)!.pinnedSummary).toBe("We are cousins who run a bakery.");
      expect(await turns.recap(id)).toEqual({ summary: "We are cousins who run a bakery.", throughRound: 0, editedThrough: -1 });
      await turns.begin(id);
      expect(buildContext(store, id).recentRounds.map((r) => r.round)).toEqual([0]);
    });

    it("an edit after the opening keeps the replaced opening away from the summariser", async () => {
      const { dm, turns, id, chars } = await begun("solo", ["Corvin"]);
      await turns.editSummary(id, "Mine.");
      await turns.submitAction(id, chars[0].id, "act");
      dm.summaryRounds = [];
      await turns.recap(id);
      expect(dm.summaryRounds.at(-1)).toEqual([1]);
    });

    it("is refused while the DM is writing or summarising", async () => {
      const { store, dm, turns, id, chars } = await begun("solo", ["Corvin"]);
      store.updateCampaign(id, { roundState: "resolving" });
      await expect(turns.editSummary(id, "x")).rejects.toThrow(GameError);
      store.updateCampaign(id, { roundState: "collecting" });
      await turns.submitAction(id, chars[0].id, "act");
      let release!: () => void;
      dm.summariseGate = new Promise((res) => { release = res; });
      const pending = turns.recap(id);
      await tick();
      await expect(turns.editSummary(id, "x")).rejects.toThrow(GameError);
      release();
      await pending;
    });
  });

  it("npc_gone keeps the card, and the DM is still told about them", async () => {
    const { store, dm, turns, id, chars } = await begun("solo", ["Corvin"]);
    dm.nextChanges = [{ op: "npc", name: "Mrs Bell", attitude: "friendly", condition: "unhurt", about: "Runs the bakery." }];
    await turns.submitAction(id, chars[0].id, "I buy bread");
    dm.nextChanges = [{ op: "npc_gone", name: "Mrs Bell" }];
    await turns.submitAction(id, chars[0].id, "I leave");
    expect(store.getNpcs(id)).toEqual([]);
    expect(store.getPeople(id)).toEqual([expect.objectContaining({ name: "Mrs Bell", present: false, about: "Runs the bakery." })]);
    expect(buildContext(store, id).people.map((p) => p.name)).toEqual(["Mrs Bell"]);
  });

  it("set_scene clears who is present but keeps the cards", async () => {
    const { store, dm, turns, id, chars } = await begun("solo", ["Corvin"]);
    dm.nextChanges = [{ op: "npc", name: "Guard", attitude: "wary", condition: "unhurt" }];
    await turns.submitAction(id, chars[0].id, "I look around");
    dm.nextChanges = [{ op: "set_scene", title: "The Market" }];
    await turns.submitAction(id, chars[0].id, "I walk on");
    expect(store.getPeople(id)).toEqual([expect.objectContaining({ name: "Guard", present: false })]);
  });

  it("an npc op's description never overwrites one the player wrote", async () => {
    const { store, dm, turns, id, chars } = await begun("solo", ["Corvin"]);
    dm.nextChanges = [{ op: "npc", name: "Bell", attitude: "friendly", condition: "unhurt", about: "A baker." }];
    await turns.submitAction(id, chars[0].id, "I buy bread");
    store.updatePerson(id, "Bell", { about: "My aunt.", aboutEdited: true });
    dm.nextChanges = [{ op: "npc", name: "Bell", attitude: "wary", condition: "unhurt", about: "A stranger." }];
    await turns.submitAction(id, chars[0].id, "I wave");
    expect(store.getPeople(id)[0]).toMatchObject({ about: "My aunt.", attitude: "wary" });
  });

  it("the summary pass refreshes cards of people in those rounds, except edited or unknown ones", async () => {
    const { store, dm, turns, id, chars } = await begun("solo", ["Corvin"]);
    dm.nextChanges = [
      { op: "npc", name: "Bell", attitude: "friendly", condition: "unhurt", about: "A baker." },
      { op: "npc", name: "Tom", attitude: "neutral", condition: "unhurt", about: "Her son." },
    ];
    await turns.submitAction(id, chars[0].id, "I buy bread");
    store.updatePerson(id, "Tom", { about: "My cousin.", aboutEdited: true });
    dm.nextSummaryPeople = [{ name: "bell", about: "A baker who owes Corvin a favour." }, { name: "Tom", about: "x" }, { name: "Nobody", about: "y" }];
    for (let i = 0; i < 9; i++) await turns.submitAction(id, chars[0].id, "I wait");
    await turns.settle();
    expect(dm.summaryPeopleIn[0]).toEqual([{ name: "Bell", about: "A baker." }, { name: "Tom", about: "My cousin." }]);
    expect(store.getPeople(id).map((p) => [p.name, p.about])).toEqual([["Bell", "A baker who owes Corvin a favour."], ["Tom", "My cousin."]]);
  });

  it("NPCs persist across rounds and appear in snapshots", async () => {
    const { store, dm, hub, turns, id, chars } = await begun("solo", ["Corvin"]);
    dm.nextChanges = [{ op: "npc", name: "Scarred Brute", attitude: "hostile", condition: "unhurt" }];
    await turns.submitAction(id, chars[0].id, "I look around");
    dm.nextChanges = [{ op: "npc", name: "scarred brute", attitude: "hostile", condition: "wounded" }];
    await turns.submitAction(id, chars[0].id, "I hit him");
    // One person however the DM capitalises them; the card keeps the name they were first given.
    expect(store.getNpcs(id)).toEqual([{ name: "Scarred Brute", attitude: "hostile", condition: "wounded" }]);
    const snap = hub.msgs.filter((m) => m.t === "snapshot").at(-1);
    expect(snap && snap.t === "snapshot" && snap.snapshot.npcs).toEqual([{ name: "Scarred Brute", attitude: "hostile", condition: "wounded" }]);
  });
});
