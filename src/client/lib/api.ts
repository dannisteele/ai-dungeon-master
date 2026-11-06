import type {
  DiceMode, Person, Realism,
  AdventureInfo, Campaign, CampaignSummary, Character, KitItem, NewCampaignRequest, NewCharacterRequest, Preset, Snapshot, Ability,
} from "../../shared/types";

export interface FeedbackRequest {
  kind: "bug" | "idea"; title: string; details: string; screen: string; campaignId?: number; characterId?: number;
  /** Reports are public on GitHub, so the story goes in only when ticked. */
  includeStory: boolean;
}

/** The story so far: the players' pinned text plus the DM's summary since, and when they last edited it. */
export interface Recap { summary: string; throughRound: number; editedThrough: number | null }

export interface HelpTurn { role: "user" | "assistant"; content: string }

export interface ModelChoice { name: string; label: string; installed: boolean }

/** One of the host computer's addresses on the local network (see src/server/invite.ts). */
export interface InviteAddress { url: string; adapter: string }

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function request<T>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: "same-origin",
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (res.status === 401 && url !== "/api/login") {
    location.reload(); // signed out (e.g. password changed): show the gate again
  }
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`);
  return data as T;
}

export const api = {
  session: () => request<{ authed: boolean }>("GET", "/api/session"),
  login: (password: string) => request<{ ok: true }>("POST", "/api/login", { password }),
  presets: () => request<{ presets: Preset[]; adventures: AdventureInfo[] }>("GET", "/api/presets"),
  campaigns: () => request<{ campaigns: CampaignSummary[] }>("GET", "/api/campaigns"),
  createCampaign: (body: NewCampaignRequest) => request<{ campaign: Campaign }>("POST", "/api/campaigns", body),
  updateSettings: (id: number, patch: { dice?: DiceMode; realism?: Realism; dmNotes?: string }) =>
    request<{ campaign: Campaign }>("PATCH", `/api/campaigns/${id}/settings`, patch),
  updatePerson: (campaignId: number, name: string, patch: { about?: string; notes?: string; letDmUpdate?: true }) =>
    request<{ people: Person[] }>("PATCH", `/api/campaigns/${campaignId}/people/${encodeURIComponent(name)}`, patch),
  renameCampaign: (id: number, title: string) => request<{ campaign: Campaign }>("PATCH", `/api/campaigns/${id}`, { title }),
  deleteCampaign: (id: number) => request<{ ok: true }>("DELETE", `/api/campaigns/${id}`),
  snapshot: (id: number) => request<{ snapshot: Snapshot }>("GET", `/api/campaigns/${id}`),
  kit: (body: { campaignId: number; name: string; concept: string }) => request<{ items: KitItem[] }>("POST", "/api/kit", body),
  createCharacter: (campaignId: number, body: NewCharacterRequest) =>
    request<{ character: Character }>("POST", `/api/campaigns/${campaignId}/characters`, body),
  spendPoint: (characterId: number, ability: Ability) =>
    request<{ character: Character }>("POST", `/api/characters/${characterId}/spend`, { ability }),
  packUp: () => request<{ ok: true }>("POST", "/api/pack-up"),
  recap: (campaignId: number) => request<Recap>("POST", `/api/campaigns/${campaignId}/recap`),
  manual: () => request<{ manual: string }>("GET", "/api/manual"),
  help: (question: string, history: HelpTurn[]) => request<{ answer: string }>("POST", "/api/help", { question, history }),
  editReply: (campaignId: number, eventId: number, text: string) => request<void>("PUT", `/api/campaigns/${campaignId}/replies/${eventId}`, { text }),
  editSummary: (campaignId: number, summary: string) => request<Recap>("PUT", `/api/campaigns/${campaignId}/summary`, { summary }),
  models: () => request<{ current: string; models: ModelChoice[] }>("GET", "/api/models"),
  setModel: (model: string) => request<{ current: string }>("POST", "/api/models", { model }),
  version: () => request<{ version: string; latest: string | null; updateAvailable: boolean }>("GET", "/api/version"),
  dmStatus: () => request<{ loaded: boolean }>("GET", "/api/dm-status"),
  invite: () => request<{ addresses: InviteAddress[] }>("GET", "/api/invite"),
  feedbackEnabled: () => request<{ enabled: boolean }>("GET", "/api/feedback"),
  sendFeedback: (body: FeedbackRequest) => request<{ url: string }>("POST", "/api/feedback", body),
};
