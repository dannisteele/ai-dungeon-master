export const ABILITIES = ["STR", "DEX", "CON", "INT", "WIS", "CHA"] as const;
export type Ability = (typeof ABILITIES)[number];
export type Scores = Record<Ability, number>;

export const ATTITUDES = ["hostile", "wary", "neutral", "friendly"] as const;
export type Attitude = (typeof ATTITUDES)[number];
export const CONDITIONS = ["unhurt", "wounded", "badly hurt", "down"] as const;
export type Condition = (typeof CONDITIONS)[number];
/** Someone in the current scene (the Nearby strip). `about` is the DM's description, when it gives one. */
export interface Npc { name: string; attitude: Attitude; condition: Condition; about?: string }
/** Everyone the heroes have met, present or not: the People cards. */
export interface Person {
  name: string;
  /** The DM's description; the player may edit it, which sets aboutEdited. */
  about: string;
  /** The player's own notes; the DM never writes these. */
  notes: string;
  attitude: Attitude;
  condition: Condition;
  present: boolean;
  lastSeenRound: number;
  /** The player rewrote `about`, so the DM must not overwrite it. */
  aboutEdited: boolean;
}

export const REALISMS = ["grounded", "fantastical"] as const;
export type Realism = (typeof REALISMS)[number];
export const DICE_MODES = ["normal", "big", "off"] as const;
export type DiceMode = (typeof DICE_MODES)[number];

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
export type AiPhase = "opening" | "adjudicating" | "resolving" | "reviving";
export type RoundState = "lobby" | "collecting" | "awaiting_rolls" | "stalled" | "fallen" | AiPhase;
export const AI_PHASES: readonly AiPhase[] = ["opening", "adjudicating", "resolving", "reviving"];

export interface AdventureOutline {
  id: string;
  title: string;
  setting: string;
  pitch: string;
  goal: string;
  villain: string;
  locations: string[];
  beats: string[];
  realism: Realism;
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
  /** The players' own story-so-far, kept word for word; `summary` then covers only what came after. */
  pinnedSummary: string;
  /** The players' standing wishes for the story ("more dialogue"), which the DM always follows. */
  dmNotes: string;
  realism: Realism;
  dice: DiceMode;
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
  | { op: "set_scene"; title: string }
  | { op: "npc"; name: string; attitude: Attitude; condition: Condition; about?: string }
  | { op: "npc_gone"; name: string };

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
  | { type: "summary"; text: string; throughRound: number; edited?: boolean }
  | { type: "party_fallen" }
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
  npcs: Npc[];
  people: Person[];
  events: StoredEvent[];
  round: RoundStatus;
  activeIds: number[];
  /** The latest DM reply can be undone and written again. */
  canTryAgain: boolean;
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
  | { t: "retry" }
  | { t: "revive" }
  | { t: "try_again" };

export interface Preset { id: string; name: string; blurb: string; setting: string; realism: Realism }
export interface AdventureInfo { id: string; title: string; pitch: string; realism: Realism }
export interface KitItem { name: string; description: string }

export type CampaignSource =
  | { kind: "preset"; presetId: string }
  /** realism defaults to grounded: players' own pitches have tended to be everyday stories. */
  | { kind: "pitch"; pitch: string; realism?: Realism }
  | { kind: "adventure"; adventureId: string };

export interface NewCampaignRequest { mode: Mode; title?: string; source: CampaignSource }
export interface NewCharacterRequest { name: string; concept: string; scores: Scores; items: KitItem[] }
