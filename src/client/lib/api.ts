import type {
  AdventureInfo, Campaign, CampaignSummary, Character, KitItem, NewCampaignRequest, NewCharacterRequest, Preset, Snapshot, Ability,
} from "../../shared/types";

export interface FeedbackRequest {
  kind: "bug" | "idea"; title: string; details: string; screen: string; campaignId?: number; characterId?: number;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function request<T>(method: "GET" | "POST", url: string, body?: unknown): Promise<T> {
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
  snapshot: (id: number) => request<{ snapshot: Snapshot }>("GET", `/api/campaigns/${id}`),
  kit: (body: { campaignId: number; name: string; concept: string }) => request<{ items: KitItem[] }>("POST", "/api/kit", body),
  createCharacter: (campaignId: number, body: NewCharacterRequest) =>
    request<{ character: Character }>("POST", `/api/campaigns/${campaignId}/characters`, body),
  spendPoint: (characterId: number, ability: Ability) =>
    request<{ character: Character }>("POST", `/api/characters/${characterId}/spend`, { ability }),
  packUp: () => request<{ ok: true }>("POST", "/api/pack-up"),
  recap: (campaignId: number) => request<{ summary: string; throughRound: number }>("POST", `/api/campaigns/${campaignId}/recap`),
  feedbackEnabled: () => request<{ enabled: boolean }>("GET", "/api/feedback"),
  sendFeedback: (body: FeedbackRequest) => request<{ url: string }>("POST", "/api/feedback", body),
};
