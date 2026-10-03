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
