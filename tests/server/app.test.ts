import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { buildApp } from "../../src/server/app";
import { loadConfig } from "../../src/server/config";
import type { DungeonMaster } from "../../src/server/dm/dm";
import { DmError } from "../../src/server/dm/dm";
import { OllamaError, type ChatClient } from "../../src/server/dm/ollama";
import { IssueFilerError, type IssueFiler, type NewIssue } from "../../src/server/feedback/github";
import { createStore, type Store } from "../../src/server/store/store";
import type { AddressInfo } from "node:net";
import type { FastifyInstance } from "fastify";

const LAN = "192.168.1.10";
const scores = { STR: 15, DEX: 14, CON: 13, INT: 12, WIS: 10, CHA: 8 };

const fakeDm = (over: Partial<DungeonMaster> = {}): DungeonMaster => ({
  adjudicate: async () => [],
  resolve: async (_c, input) => ({ narration: `Resolved ${input.actions.length}`, changes: [] }),
  opening: async () => ({ narration: "It begins.", changes: [] }),
  revive: async () => ({ narration: "You wake.", changes: [] }),
  startingKit: async () => [{ name: "Rope", description: "30ft" }],
  summarise: async () => ({ summary: "summary", people: [] }),
  ...over,
});

let app: FastifyInstance;
let store: Store;
let unloads = 0;
let loaded = false;
afterEach(async () => {
  await app?.close();
  store?.close();
});

async function start(dm = fakeDm(), unload: ChatClient["unload"] = async () => { unloads++; }, issues?: IssueFiler, latest: string | null = null) {
  store = createStore(":memory:");
  unloads = 0;
  let model = "qwen3.6:27b";
  const chat: ChatClient = {
    chat: async () => '{"answer":"Press Roll d20."}', unload,
    getModel: () => model, setModel: (m) => { model = m; },
    installedModels: async () => ["qwen3.5:9b", "qwen3.6:27b", "llama3:8b"],
    isLoaded: async () => loaded,
  };
  ({ app } = await buildApp({ config: loadConfig({ TABLE_PASSWORD: "dragon" }), store, dm, chat, issues, version: "v1.0.0", updates: { latest: async () => latest } }));
  const login = await app.inject({ method: "POST", url: "/api/login", remoteAddress: LAN, payload: { password: "dragon" } });
  const cookie = `table=${login.cookies.find((c) => c.name === "table")!.value}`;
  const req = (method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, payload?: object) =>
    app.inject({ method, url, payload, remoteAddress: LAN, headers: { cookie } });
  return { req, cookie };
}

// `app.injectWS` doesn't give the upgrade request a real socket, so our LAN check (which reads
// `req.ip`) throws for it. Use a real listening server and the `ws` package instead, per the
// task brief's documented fallback.
async function connectWs(path: string, headers?: Record<string, string>): Promise<WebSocket> {
  await app.listen({ port: 0, host: "127.0.0.1" });
  const { port } = app.server.address() as AddressInfo;
  return new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers });
}

describe("API", () => {
  it("lists presets and adventures", async () => {
    const { req } = await start();
    const body = (await req("GET", "/api/presets")).json();
    expect(body.presets.map((p: { id: string }) => p.id)).toContain("gothic-horror");
    expect(body.presets.map((p: { id: string }) => p.id)).toContain("victorian-civil-service");
    expect(body.adventures).toEqual([
      expect.objectContaining({ id: "drowned-chapel", title: "The Drowned Chapel", realism: "fantastical" }),
      expect.objectContaining({ id: "misfiled-petition", title: "The Misfiled Petition", realism: "grounded" }),
    ]);
    expect(body.presets.find((p: { id: string }) => p.id === "victorian-civil-service").realism).toBe("grounded");
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

  it("renames and deletes campaigns, but not mid-sentence", async () => {
    const { req } = await start();
    const { campaign } = (await req("POST", "/api/campaigns", { mode: "solo", source: { kind: "preset", presetId: "gothic-horror" } })).json();
    await req("POST", `/api/campaigns/${campaign.id}/characters`, { name: "Wren", concept: "scout", scores, items: [] });
    store.appendEvent(campaign.id, 1, { type: "narration", text: "Fog." });

    expect((await req("PATCH", `/api/campaigns/${campaign.id}`, { title: "  The Fog  " })).json().campaign.title).toBe("The Fog");
    expect((await req("PATCH", `/api/campaigns/${campaign.id}`, { title: " " })).statusCode).toBe(400);
    expect((await req("PATCH", "/api/campaigns/999", { title: "x" })).statusCode).toBe(404);

    store.updateCampaign(campaign.id, { roundState: "resolving" });
    expect((await req("DELETE", `/api/campaigns/${campaign.id}`)).statusCode).toBe(409);
    store.updateCampaign(campaign.id, { roundState: "collecting" });
    expect((await req("DELETE", `/api/campaigns/${campaign.id}`)).json()).toEqual({ ok: true });
    expect((await req("GET", "/api/campaigns")).json().campaigns).toEqual([]);
    expect(store.getEvents(campaign.id)).toEqual([]);
    expect(store.getCharacters(campaign.id)).toEqual([]);
    expect((await req("DELETE", `/api/campaigns/${campaign.id}`)).statusCode).toBe(404);
  });

  it("changes dice and realism settings, but not while the DM is writing", async () => {
    const { req } = await start();
    const { campaign } = (await req("POST", "/api/campaigns", { mode: "solo", source: { kind: "preset", presetId: "gothic-horror" } })).json();
    const r = await req("PATCH", `/api/campaigns/${campaign.id}/settings`, { dice: "off" });
    expect(r.json().campaign).toMatchObject({ dice: "off", realism: "fantastical" });
    expect((await req("PATCH", `/api/campaigns/${campaign.id}/settings`, { realism: "grounded" })).json().campaign)
      .toMatchObject({ dice: "off", realism: "grounded" });
    expect((await req("PATCH", `/api/campaigns/${campaign.id}/settings`, {})).statusCode).toBe(400);
    expect((await req("PATCH", `/api/campaigns/${campaign.id}/settings`, { dice: "sometimes" })).statusCode).toBe(400);
    expect((await req("PATCH", "/api/campaigns/999/settings", { dice: "big" })).statusCode).toBe(404);
    store.updateCampaign(campaign.id, { roundState: "resolving" });
    expect((await req("PATCH", `/api/campaigns/${campaign.id}/settings`, { dice: "big" })).statusCode).toBe(409);
  });

  it("edits people cards: notes, the description, and handing it back to the DM", async () => {
    const { req } = await start();
    const { campaign } = (await req("POST", "/api/campaigns", { mode: "solo", source: { kind: "preset", presetId: "gothic-horror" } })).json();
    store.saveNpcs(campaign.id, [{ name: "Mrs Bell", attitude: "friendly", condition: "unhurt", about: "A baker." }], 1);
    const url = (name: string) => `/api/campaigns/${campaign.id}/people/${encodeURIComponent(name)}`;

    const notes = await req("PATCH", url("mrs bell"), { notes: "My aunt." });
    expect(notes.json().people[0]).toMatchObject({ name: "Mrs Bell", notes: "My aunt.", about: "A baker.", aboutEdited: false });
    const about = await req("PATCH", url("Mrs Bell"), { about: "My aunt, the baker." });
    expect(about.json().people[0]).toMatchObject({ about: "My aunt, the baker.", aboutEdited: true });
    const back = await req("PATCH", url("Mrs Bell"), { letDmUpdate: true });
    expect(back.json().people[0]).toMatchObject({ about: "My aunt, the baker.", aboutEdited: false });
    await req("PATCH", url("Mrs Bell"), { about: "Mine." });
    // Clearing the description hands it back to the DM rather than locking it empty.
    const cleared = await req("PATCH", url("Mrs Bell"), { about: "" });
    expect(cleared.json().people[0]).toMatchObject({ about: "", aboutEdited: false });

    expect((await req("PATCH", url("Mrs Bell"), { notes: "x".repeat(501) })).statusCode).toBe(400);
    expect((await req("PATCH", url("Mrs Bell"), {})).statusCode).toBe(400);
    expect((await req("PATCH", url("Nobody"), { notes: "x" })).statusCode).toBe(404);
    expect((await req("PATCH", "/api/campaigns/999/people/Bell", { notes: "x" })).statusCode).toBe(404);
    store.updateCampaign(campaign.id, { roundState: "resolving" });
    expect((await req("PATCH", url("Mrs Bell"), { notes: "x" })).statusCode).toBe(409);
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

  it("writes a story-so-far recap on request", async () => {
    const { req } = await start(fakeDm({ summarise: async () => ({ summary: "They wandered in the fog.", people: [] }) }));
    const { campaign } = (await req("POST", "/api/campaigns", { mode: "solo", source: { kind: "preset", presetId: "gothic-horror" } })).json();
    expect((await req("POST", `/api/campaigns/${campaign.id}/recap`)).json()).toEqual({ summary: "", throughRound: 0, editedThrough: null });
    store.appendEvent(campaign.id, 1, { type: "narration", text: "Fog everywhere." });
    store.updateCampaign(campaign.id, { roundState: "collecting", roundNumber: 2 });
    expect((await req("POST", `/api/campaigns/${campaign.id}/recap`)).json()).toEqual({ summary: "They wandered in the fog.", throughRound: 1, editedThrough: null });
    expect((await req("POST", "/api/campaigns/999/recap")).statusCode).toBe(404);
  });

  it("lets players rewrite one of the DM's replies", async () => {
    const { req } = await start();
    const { campaign } = (await req("POST", "/api/campaigns", { mode: "solo", source: { kind: "preset", presetId: "gothic-horror" } })).json();
    const reply = store.appendEvent(campaign.id, 0, { type: "narration", text: "Fog everywhere." });
    store.updateCampaign(campaign.id, { roundState: "collecting", roundNumber: 1 });
    const url = `/api/campaigns/${campaign.id}/replies/${reply.id}`;
    expect((await req("PUT", url, { text: "Clear skies." })).statusCode).toBe(204);
    expect(store.getEvents(campaign.id).find((e) => e.id === reply.id)).toMatchObject({ text: "Clear skies." });
    expect((await req("PUT", url, { text: " " })).statusCode).toBe(400);
    expect((await req("PUT", `/api/campaigns/${campaign.id}/replies/99999`, { text: "x" })).statusCode).toBe(409);
    expect((await req("PUT", `/api/campaigns/999/replies/${reply.id}`, { text: "x" })).statusCode).toBe(404);
  });

  it("answers questions about the game, and serves the manual", async () => {
    const { req } = await start();
    expect((await req("GET", "/api/manual")).json().manual).toContain("# How to play");
    expect((await req("POST", "/api/help", { question: "  " })).statusCode).toBe(400);
    expect((await req("POST", "/api/help", { question: "x".repeat(501) })).statusCode).toBe(400);
    expect((await req("POST", "/api/help", { question: "How do I roll?", history: [] })).json()).toEqual({ answer: "Press Roll d20." });
  });

  it("lets players rewrite the story so far", async () => {
    const { req } = await start();
    const { campaign } = (await req("POST", "/api/campaigns", { mode: "solo", source: { kind: "preset", presetId: "gothic-horror" } })).json();
    const url = `/api/campaigns/${campaign.id}/summary`;
    expect((await req("PUT", url, { summary: "We are cousins." })).json()).toEqual({ summary: "We are cousins.", throughRound: 0, editedThrough: -1 });
    expect((await req("POST", `/api/campaigns/${campaign.id}/recap`)).json().summary).toBe("We are cousins.");
    expect((await req("PUT", url, { summary: "  " })).statusCode).toBe(400);
    expect((await req("PUT", url, { summary: "x".repeat(4001) })).statusCode).toBe(400);
    expect((await req("PUT", "/api/campaigns/999/summary", { summary: "x" })).statusCode).toBe(404);
    store.updateCampaign(campaign.id, { roundState: "resolving" });
    expect((await req("PUT", url, { summary: "x" })).statusCode).toBe(409);
  });

  it("returns 503 when the DM can't write the recap", async () => {
    const { req } = await start(fakeDm({ summarise: async () => { throw new DmError("down"); } }));
    const { campaign } = (await req("POST", "/api/campaigns", { mode: "solo", source: { kind: "preset", presetId: "gothic-horror" } })).json();
    store.appendEvent(campaign.id, 1, { type: "narration", text: "Fog everywhere." });
    store.updateCampaign(campaign.id, { roundState: "collecting", roundNumber: 2 });
    const r = await req("POST", `/api/campaigns/${campaign.id}/recap`);
    expect(r.statusCode).toBe(503);
    expect(r.json().error).toBe("The Dungeon Master couldn't recall the story just now. Try again.");
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

  it("says whether the model has finished loading", async () => {
    const { req } = await start();
    loaded = false;
    expect((await req("GET", "/api/dm-status")).json()).toEqual({ loaded: false });
    loaded = true;
    expect((await req("GET", "/api/dm-status")).json()).toEqual({ loaded: true });
  });

  it("lists installed models with friendly names", async () => {
    const { req } = await start();
    expect((await req("GET", "/api/models")).json()).toEqual({
      current: "qwen3.6:27b",
      models: [
        { name: "qwen3.5:9b", label: "Qwen 9B (quicker)", installed: true },
        { name: "qwen3.6:27b", label: "Qwen 27B (best storytelling, slower)", installed: true },
        { name: "llama3:8b", label: "llama3:8b", installed: true },
      ],
    });
  });

  it("switches model, unloading the old one and remembering the choice", async () => {
    const { req } = await start();
    expect((await req("POST", "/api/models", { model: "qwen3.5:9b" })).json()).toEqual({ current: "qwen3.5:9b" });
    expect(unloads).toBe(1);
    expect(store.getSetting("ollamaModel")).toBe("qwen3.5:9b");
    expect((await req("GET", "/api/models")).json().current).toBe("qwen3.5:9b");
    expect((await req("POST", "/api/models", { model: "nope:1b" })).statusCode).toBe(400);
  });

  it("won't switch model mid-sentence", async () => {
    const { req } = await start();
    const { campaign } = (await req("POST", "/api/campaigns", { mode: "solo", source: { kind: "preset", presetId: "classic-fantasy" } })).json();
    store.updateCampaign(campaign.id, { roundState: "resolving" });
    const r = await req("POST", "/api/models", { model: "qwen3.5:9b" });
    expect(r.statusCode).toBe(409);
    expect((await req("GET", "/api/models")).json().current).toBe("qwen3.6:27b");
  });

  it("reports its version and whether a newer release is out", async () => {
    const none = await start();
    const v = (await none.req("GET", "/api/version")).json();
    expect(v).toEqual({ version: "v1.0.0", latest: null, updateAvailable: false });
    await app.close();
    const newer = await start(fakeDm(), undefined, undefined, "v999.0.0");
    expect((await newer.req("GET", "/api/version")).json()).toMatchObject({ latest: "v999.0.0", updateAvailable: true });
  });

  it("hides feedback when no GitHub token is set", async () => {
    const { req } = await start();
    expect((await req("GET", "/api/feedback")).json()).toEqual({ enabled: false });
    const r = await req("POST", "/api/feedback", { kind: "idea", title: "Hi", details: "", screen: "lobby" });
    expect(r.statusCode).toBe(503);
  });

  it("files a bug report with the recent story attached", async () => {
    const filed: NewIssue[] = [];
    const issues: IssueFiler = { file: async (i) => { filed.push(i); return { number: 7, url: "https://github.com/x/y/issues/7" }; } };
    const { req } = await start(fakeDm(), undefined, issues);
    expect((await req("GET", "/api/feedback")).json()).toEqual({ enabled: true });
    const { campaign } = (await req("POST", "/api/campaigns", { mode: "solo", source: { kind: "preset", presetId: "gothic-horror" } })).json();
    const { character } = (await req("POST", `/api/campaigns/${campaign.id}/characters`, { name: "Wren", concept: "scout", scores, items: [] })).json();
    store.appendEvent(campaign.id, 1, { type: "action", characterId: character.id, text: "I open the crypt." });
    store.appendEvent(campaign.id, 1, { type: "narration", text: "The door groans." });

    const r = await req("POST", "/api/feedback", {
      kind: "bug", title: "Dice froze", details: "The die never stopped.", screen: "play", campaignId: campaign.id, characterId: character.id,
      includeStory: true,
    });
    expect(r.json()).toEqual({ url: "https://github.com/x/y/issues/7" });
    expect(filed).toHaveLength(1);
    expect(filed[0]).toMatchObject({ title: "Dice froze", labels: ["bug"] });
    expect(filed[0].body).toMatch(/^The die never stopped\./);
    expect(filed[0].body).toContain("**Playing as:** Wren");
    expect(filed[0].body).toContain("**Setting:** Gothic Horror");
    expect(filed[0].body).toContain("**Model:** qwen3.6:27b");
    expect(filed[0].body).toContain("> [round 1] **Wren:** I open the crypt.");
    expect(filed[0].body).toContain("> [round 1] **DM:** The door groans.");

    await req("POST", "/api/feedback", { kind: "bug", title: "Again", details: "", screen: "play", campaignId: campaign.id });
    expect(filed[1].body).not.toContain("I open the crypt");
    expect(filed[1].body).toContain("**Setting:** Gothic Horror");
  });

  it("files a lobby report with the story box ticked, without a story", async () => {
    const filed: NewIssue[] = [];
    const issues: IssueFiler = { file: async (i) => { filed.push(i); return { number: 9, url: "u" }; } };
    const { req } = await start(fakeDm(), undefined, issues);
    expect((await req("POST", "/api/feedback", { kind: "idea", title: "Hi", details: "", screen: "lobby", includeStory: true })).statusCode).toBe(200);
    expect(filed[0].body).not.toContain("Story so far");
    expect(filed[0].body).not.toContain("Recent story");
  });

  it("files ideas without the story, and validates the form", async () => {
    const filed: NewIssue[] = [];
    const issues: IssueFiler = { file: async (i) => { filed.push(i); return { number: 8, url: "u" }; } };
    const { req } = await start(fakeDm(), undefined, issues);
    const { campaign } = (await req("POST", "/api/campaigns", { mode: "solo", source: { kind: "preset", presetId: "gothic-horror" } })).json();
    store.appendEvent(campaign.id, 1, { type: "narration", text: "Secret plot." });
    await req("POST", "/api/feedback", { kind: "idea", title: "Add maps", details: "", screen: "play", campaignId: campaign.id });
    expect(filed[0].labels).toEqual(["enhancement"]);
    expect(filed[0].body).not.toContain("Secret plot");
    expect((await req("POST", "/api/feedback", { kind: "idea", title: " ", details: "", screen: "lobby" })).statusCode).toBe(400);
  });

  it("says so when GitHub can't be reached", async () => {
    const issues: IssueFiler = { file: async () => { throw new IssueFilerError("offline"); } };
    const { req } = await start(fakeDm(), undefined, issues);
    const r = await req("POST", "/api/feedback", { kind: "bug", title: "x", details: "", screen: "lobby" });
    expect(r.statusCode).toBe(502);
    expect(r.json().error).toMatch(/internet/);
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
    const ws = await connectWs(`/ws?campaign=${campaign.id}`, { cookie });
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
    ws.send(JSON.stringify({ t: "revive" }));
    expect(await waitFor((m) => m.t === "error" && m.message === "Nobody needs reviving.")).toBeTruthy();
    ws.send("garbage");
    expect(await waitFor((m) => m.t === "error" && m.message === "That message didn't make sense.")).toBeTruthy();
    ws.terminate();
  });

  it("refuses WebSockets without the cookie", async () => {
    await start();
    const ws = await connectWs("/ws?campaign=1");
    const status = await new Promise<number>((resolve, reject) => {
      ws.on("unexpected-response", (_req, res) => { res.resume(); resolve(res.statusCode!); });
      ws.on("open", () => { ws.terminate(); reject(new Error("expected the connection to be refused")); });
      ws.on("error", reject);
    });
    expect(status).toBe(401);
  });
});
