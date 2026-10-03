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
  | { type: "summary"; text: string; throughRound: number }
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
