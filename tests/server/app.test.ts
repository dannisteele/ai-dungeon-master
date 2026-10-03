import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { buildApp } from "../../src/server/app";
import { loadConfig } from "../../src/server/config";
import type { DungeonMaster } from "../../src/server/dm/dm";
import { DmError } from "../../src/server/dm/dm";
import { OllamaError, type ChatClient } from "../../src/server/dm/ollama";
import { createStore, type Store } from "../../src/server/store/store";
import type { AddressInfo } from "node:net";
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
afterEach(async () => {
  await app?.close();
  store?.close();
});

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
