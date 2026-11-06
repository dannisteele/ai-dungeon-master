import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { createStore, SCHEMA_VERSION } from "../../../src/server/store/store";

// The schema as it was before versioned migrations (user_version 0): what saves made by
// v1.4.x and earlier contain.
const V0_SCHEMA = `
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
CREATE TABLE IF NOT EXISTS npcs (
  id INTEGER PRIMARY KEY,
  campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  attitude TEXT NOT NULL,
  condition TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_npcs_name ON npcs(campaign_id, lower(name));
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

function v0Save(): { path: string; campaignId: number } {
  const path = join(mkdtempSync(join(tmpdir(), "adm-mig-")), "game.sqlite");
  const db = new Database(path);
  db.exec(V0_SCHEMA);
  const id = Number(db.prepare(
    "INSERT INTO campaigns (title, mode, setting, round_state, round_number, summary) VALUES ('Old', 'solo', 'Fantasy', 'collecting', 3, 'So far.')",
  ).run().lastInsertRowid);
  db.prepare("INSERT INTO npcs (campaign_id, name, attitude, condition) VALUES (?, 'Mrs Bell', 'friendly', 'unhurt')").run(id);
  db.prepare("INSERT INTO npcs (campaign_id, name, attitude, condition) VALUES (?, 'The Guard', 'wary', 'wounded')").run(id);
  db.close();
  return { path, campaignId: id };
}

describe("save upgrades", () => {
  it("upgrades a save from before migrations, keeping campaigns and NPCs", () => {
    const { path, campaignId } = v0Save();
    const store = createStore(path);
    expect(store.getCampaign(campaignId)).toMatchObject({
      title: "Old", roundState: "collecting", roundNumber: 3, summary: "So far.",
      realism: "fantastical", dice: "normal", pinnedSummary: "",
    });
    expect(store.getNpcs(campaignId)).toEqual([
      { name: "Mrs Bell", attitude: "friendly", condition: "unhurt" },
      { name: "The Guard", attitude: "wary", condition: "wounded" },
    ]);
    expect(store.getPeople(campaignId)).toEqual([
      expect.objectContaining({ name: "Mrs Bell", present: true, about: "", notes: "", aboutEdited: false }),
      expect.objectContaining({ name: "The Guard", present: true, about: "", notes: "", aboutEdited: false }),
    ]);
    store.close();
    expect(new Database(path).pragma("user_version", { simple: true })).toBe(SCHEMA_VERSION);
  });

  it("doesn't re-run the upgrade on the next start", () => {
    const { path, campaignId } = v0Save();
    createStore(path).close();
    const again = createStore(path);
    expect(again.getPeople(campaignId).map((p) => p.name)).toEqual(["Mrs Bell", "The Guard"]);
    again.close();
  });

  it("gives a brand-new save the same schema", () => {
    const store = createStore(":memory:");
    const c = store.createCampaign({ title: "New", mode: "solo", setting: "s", pitch: "", outline: null });
    expect(c).toMatchObject({ realism: "fantastical", dice: "normal", pinnedSummary: "", dmNotes: "" });
    expect(store.getPeople(c.id)).toEqual([]);
    store.close();
  });
});
