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
