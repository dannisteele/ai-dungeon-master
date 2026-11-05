/** Whether GitHub has a newer release than this copy, for the lobby's "update available" note. */

export interface UpdateChecker { latest(): Promise<string | null> }

const HOUR = 60 * 60_000;

/** "v1.4.0-3-gabc1234-dirty" -> [1, 4, 0]; null if it isn't a release version. */
export function versionParts(v: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function isNewer(candidate: string, current: string): boolean {
  const a = versionParts(candidate), b = versionParts(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}

/** Asks GitHub for the latest release at most once an hour; offline just means "no news". */
export function createUpdateChecker(opts: { repo: string; fetch?: typeof fetch; now?: () => number }): UpdateChecker {
  const doFetch = opts.fetch ?? fetch;
  const now = opts.now ?? Date.now;
  let cached: { at: number; tag: string | null } | null = null;
  return {
    async latest() {
      if (cached && now() - cached.at < HOUR) return cached.tag;
      let tag: string | null = null;
      try {
        const res = await doFetch(`https://api.github.com/repos/${opts.repo}/releases/latest`, {
          headers: { accept: "application/vnd.github+json", "user-agent": "ai-dungeon-master" },
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) tag = ((await res.json()) as { tag_name?: string }).tag_name ?? null;
      } catch { /* offline or GitHub unreachable */ }
      cached = { at: now(), tag };
      return tag;
    },
  };
}
