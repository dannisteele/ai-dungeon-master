import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { ABILITIES, AI_PHASES, DICE_MODES, REALISMS, type AdventureOutline } from "../../shared/types";
import { campaignInputFrom, PRESETS, settingLabel } from "../campaigns/presets";
import { DmError, type DungeonMaster } from "../dm/dm";
import { OllamaError, type ChatClient } from "../dm/ollama";
import { memoryText } from "../dm/context";
import { buildIssueBody, IssueFilerError, type IssueFiler } from "../feedback/github";
import { isNewer, type UpdateChecker } from "../updates";
import type { RulesEngine } from "../rules/engine";
import { NameTakenError, type Store } from "../store/store";
import { buildSnapshot } from "../turns/snapshot";
import { GameError, type TurnService } from "../turns/turns";

export const NewCampaignSchema = z.object({
  mode: z.enum(["solo", "party"]),
  title: z.string().trim().max(80).optional(),
  source: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("preset"), presetId: z.string() }),
    z.object({
      kind: z.literal("pitch"), pitch: z.string().trim().min(10, "Write at least a sentence for your pitch.").max(1000),
      realism: z.enum(REALISMS).optional(),
    }),
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
const SettingsSchema = z.object({ dice: z.enum(DICE_MODES).optional(), realism: z.enum(REALISMS).optional() })
  .refine((v) => v.dice !== undefined || v.realism !== undefined, { message: "Nothing to change." });
const PersonEditSchema = z.object({
  about: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(500).optional(),
  /** Hand the description back to the DM after the player edited it. */
  letDmUpdate: z.literal(true).optional(),
}).refine((v) => v.about !== undefined || v.notes !== undefined || v.letDmUpdate, { message: "Nothing to change." });
const SummaryEditSchema = z.object({ summary: z.string().trim().min(1, "Write something for the story so far.").max(4000) });
const RenameSchema = z.object({ title: z.string().trim().min(1, "Give it a name.").max(80) });
const ModelSchema = z.object({ model: z.string().min(1) });

/** Friendly names for the models we've tested; anything else shows its Ollama name. */
const MODEL_LABELS: Record<string, string> = {
  "qwen3.6:27b": "Qwen 27B (best storytelling, slower)",
  "qwen3.5:9b": "Qwen 9B (quicker)",
};
/** Where the chosen model is remembered between restarts. */
export const MODEL_SETTING = "ollamaModel";

export const FeedbackSchema = z.object({
  kind: z.enum(["bug", "idea"]),
  title: z.string().trim().min(1, "Give it a short title.").max(100),
  details: z.string().trim().max(4000),
  screen: z.string().trim().max(40),
  campaignId: z.number().int().optional(),
  characterId: z.number().int().optional(),
  /** Reports are public on GitHub, so story text goes in only when the player asks. */
  includeStory: z.boolean().default(false),
});

/** How many recent events go into a bug report. */
const FEEDBACK_EVENTS = 30;

export interface ApiDeps {
  store: Store; rules: RulesEngine; dm: DungeonMaster; chat: ChatClient; turns: TurnService; adventures: AdventureOutline[];
  /** Absent when no GitHub token is configured: the feedback button stays hidden. */
  feedback?: { issues: IssueFiler };
  /** This copy's release, e.g. "v1.4.0" (see src/server/version.ts). */
  version: string;
  updates: UpdateChecker;
}

export async function registerApi(app: FastifyInstance, deps: ApiDeps): Promise<void> {
  const { store, rules, dm, chat, turns, adventures, feedback, version, updates } = deps;
  const bad = (error: z.ZodError) => ({ error: z.prettifyError(error) });
  const dmBusy = () => store.listCampaigns().some((c) => (AI_PHASES as readonly string[]).includes(c.roundState));
  const midSentence = { error: "The Dungeon Master is mid-sentence. Try again once the story settles." };

  app.get("/api/presets", async () => ({
    presets: PRESETS,
    adventures: adventures.map(({ id, title, pitch, realism }) => ({ id, title, pitch, realism })),
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

  app.patch<{ Params: { id: string } }>("/api/campaigns/:id", async (req, reply) => {
    const id = Number(req.params.id);
    if (!store.getCampaign(id)) return reply.code(404).send({ error: "No such campaign." });
    const parsed = RenameSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(bad(parsed.error));
    store.updateCampaign(id, { title: parsed.data.title });
    turns.broadcastSnapshot(id);
    return { campaign: store.getCampaign(id) };
  });

  app.patch<{ Params: { id: string } }>("/api/campaigns/:id/settings", async (req, reply) => {
    const id = Number(req.params.id);
    const campaign = store.getCampaign(id);
    if (!campaign) return reply.code(404).send({ error: "No such campaign." });
    const parsed = SettingsSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(bad(parsed.error));
    if ((AI_PHASES as readonly string[]).includes(campaign.roundState)) return reply.code(409).send(midSentence);
    store.updateCampaign(id, parsed.data);
    turns.broadcastSnapshot(id);
    return { campaign: store.getCampaign(id) };
  });

  app.patch<{ Params: { id: string; name: string } }>("/api/campaigns/:id/people/:name", async (req, reply) => {
    const id = Number(req.params.id);
    const campaign = store.getCampaign(id);
    if (!campaign) return reply.code(404).send({ error: "No such campaign." });
    const parsed = PersonEditSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(bad(parsed.error));
    if ((AI_PHASES as readonly string[]).includes(campaign.roundState)) return reply.code(409).send(midSentence);
    const { about, notes, letDmUpdate } = parsed.data;
    // Editing the description locks it against the DM; "let the DM update this" unlocks it.
    const found = store.updatePerson(id, req.params.name, {
      about, notes, ...(about !== undefined ? { aboutEdited: true } : letDmUpdate ? { aboutEdited: false } : {}),
    });
    if (!found) return reply.code(404).send({ error: "Nobody by that name." });
    turns.broadcastSnapshot(id);
    return { people: store.getPeople(id) };
  });

  app.delete<{ Params: { id: string } }>("/api/campaigns/:id", async (req, reply) => {
    const id = Number(req.params.id);
    const campaign = store.getCampaign(id);
    if (!campaign) return reply.code(404).send({ error: "No such campaign." });
    if ((AI_PHASES as readonly string[]).includes(campaign.roundState)) {
      return reply.code(409).send({ error: "The Dungeon Master is mid-sentence in that tale. Try again once it settles." });
    }
    store.deleteCampaign(id);
    return { ok: true };
  });

  app.post("/api/kit", async (req, reply) => {
    const parsed = KitRequestSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(bad(parsed.error));
    const campaign = store.getCampaign(parsed.data.campaignId);
    if (!campaign) return reply.code(404).send({ error: "No such campaign." });
    try {
      return { items: await dm.startingKit({ name: parsed.data.name, concept: parsed.data.concept, setting: campaign.setting, realism: campaign.realism }) };
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

  app.post<{ Params: { id: string } }>("/api/campaigns/:id/recap", async (req, reply) => {
    const id = Number(req.params.id);
    if (!store.getCampaign(id)) return reply.code(404).send({ error: "No such campaign." });
    try {
      return await turns.recap(id);
    } catch (e) {
      if (e instanceof DmError) return reply.code(503).send({ error: "The Dungeon Master couldn't recall the story just now. Try again." });
      throw e;
    }
  });


  app.put<{ Params: { id: string } }>("/api/campaigns/:id/summary", async (req, reply) => {
    const id = Number(req.params.id);
    if (!store.getCampaign(id)) return reply.code(404).send({ error: "No such campaign." });
    const parsed = SummaryEditSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(bad(parsed.error));
    try {
      return await turns.editSummary(id, parsed.data.summary);
    } catch (e) {
      if (e instanceof GameError) return reply.code(409).send({ error: e.message });
      throw e;
    }
  });

  app.post("/api/pack-up", async (_req, reply) => {
    if (dmBusy()) return reply.code(409).send(midSentence);
    try {
      await chat.unload();
      return { ok: true };
    } catch (e) {
      if (e instanceof OllamaError) return reply.code(503).send({ error: e.message });
      throw e;
    }
  });

  app.get("/api/version", async () => {
    const latest = await updates.latest();
    return { version, latest, updateAvailable: latest !== null && isNewer(latest, version) };
  });

  app.get("/api/feedback", async () => ({ enabled: Boolean(feedback) }));

  app.post("/api/feedback", async (req, reply) => {
    if (!feedback) return reply.code(503).send({ error: "Feedback isn't set up on this computer." });
    const parsed = FeedbackSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(bad(parsed.error));
    const { kind, title, details, screen, campaignId, characterId, includeStory } = parsed.data;
    const campaign = campaignId === undefined ? undefined : store.getCampaign(campaignId);
    const characters = campaign ? store.getCharacters(campaign.id) : [];
    const body = buildIssueBody({
      kind, details, screen, includeStory, summary: campaign && memoryText(campaign), appVersion: version, model: chat.getModel(), userAgent: req.headers["user-agent"],
      campaign: campaign && { id: campaign.id, title: campaign.title, setting: settingLabel(campaign, { includePitch: includeStory }), sceneTitle: campaign.sceneTitle, round: campaign.roundNumber },
      character: characters.find((c) => c.id === characterId),
      characters,
      events: campaign && includeStory ? store.getEvents(campaign.id, { limit: FEEDBACK_EVENTS }) : [],
      now: new Date(),
    });
    try {
      const issue = await feedback.issues.file({ title, body, labels: [kind === "bug" ? "bug" : "enhancement"] });
      return { url: issue.url };
    } catch (e) {
      if (!(e instanceof IssueFilerError)) throw e;
      req.log.error({ err: e }, "filing feedback failed");
      return reply.code(502).send({ error: "Couldn't send that just now. Check the internet connection and try again." });
    }
  });

  // Lets the play screen say "waking up" while Ollama loads the model before the first turn.
  app.get("/api/dm-status", async () => {
    try {
      return { loaded: await chat.isLoaded() };
    } catch (e) {
      if (e instanceof OllamaError) return { loaded: false };
      throw e;
    }
  });

  app.get("/api/models", async (_req, reply) => {
    try {
      const installed = await chat.installedModels();
      const current = chat.getModel();
      const names = installed.includes(current) ? installed : [current, ...installed];
      return {
        current,
        models: names.map((name) => ({ name, label: MODEL_LABELS[name] ?? name, installed: installed.includes(name) })),
      };
    } catch (e) {
      if (e instanceof OllamaError) return reply.code(503).send({ error: e.message });
      throw e;
    }
  });

  app.post("/api/models", async (req, reply) => {
    const parsed = ModelSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send(bad(parsed.error));
    const { model } = parsed.data;
    if (model === chat.getModel()) return { current: model };
    if (dmBusy()) return reply.code(409).send(midSentence);
    try {
      if (!(await chat.installedModels()).includes(model)) return reply.code(400).send({ error: `${model} isn't downloaded. Run: ollama pull ${model}` });
      // Free the old model's memory; if it wasn't loaded, or Ollama hiccups, switching still works.
      await chat.unload().catch(() => {});
    } catch (e) {
      if (e instanceof OllamaError) return reply.code(503).send({ error: e.message });
      throw e;
    }
    chat.setModel(model);
    store.setSetting(MODEL_SETTING, model);
    return { current: model };
  });
}
