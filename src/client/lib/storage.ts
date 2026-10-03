const key = (campaignId: number) => `adm.character.${campaignId}`;

/** Which hero this device plays in a campaign. Per-device convenience only. */
export function getMyCharacter(campaignId: number): number | null {
  try {
    const v = localStorage.getItem(key(campaignId));
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}

export function setMyCharacter(campaignId: number, characterId: number): void {
  try { localStorage.setItem(key(campaignId), String(characterId)); } catch { /* private mode: they'll pick again */ }
}
