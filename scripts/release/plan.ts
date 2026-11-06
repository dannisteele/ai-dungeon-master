// Pure logic for automatic releases: what changed since the last tag, how big a version bump
// that is, and the release notes. scripts/release/run.ts feeds it from git and GitHub.

export type Kind = "breaking" | "feat" | "fix" | "other";
export type Bump = "major" | "minor" | "patch";

/** One line of the release notes: a merged PR, or a commit pushed straight to main. */
export interface Change { title: string; kind: Kind; pr?: number }

const RANK: Record<Kind, number> = { other: 0, fix: 1, feat: 2, breaking: 3 };

/** Conventional-commit kind of one commit. perf counts as a fix; docs, ci, chore etc. as other. */
export function commitKind(subject: string, body = ""): Kind {
  const m = /^(\w+)(\([^)]*\))?(!)?:/.exec(subject);
  if (m?.[3] || /^BREAKING[ -]CHANGE:/m.test(body)) return "breaking";
  if (!m) return "other";
  if (m[1] === "feat") return "feat";
  if (m[1] === "fix" || m[1] === "perf") return "fix";
  return "other";
}

/** The most significant kind among several commits (e.g. all the commits in one PR). */
export function strongest(kinds: Kind[]): Kind {
  return kinds.reduce<Kind>((a, b) => (RANK[b] > RANK[a] ? b : a), "other");
}

/** Only features and fixes make a release; docs or CI changes alone don't. */
export function bumpFor(changes: Change[]): Bump | null {
  const kind = strongest(changes.map((c) => c.kind));
  return kind === "breaking" ? "major" : kind === "feat" ? "minor" : kind === "fix" ? "patch" : null;
}

export function nextVersion(current: string, bump: Bump): string {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(current);
  if (!m) throw new Error(`Not a version: ${current}`);
  const [major, minor, patch] = m.slice(1).map(Number);
  if (bump === "major") return `${major + 1}.0.0`;
  if (bump === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
}

/** "fix(ui): Foo bar" -> "Foo bar", for commits pushed without a PR. */
export function plainTitle(subject: string): string {
  const t = subject.replace(/^\w+(\([^)]*\))?!?:\s*/, "");
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function releaseNotes(changes: Change[]): string {
  const line = (c: Change) => `- ${c.title}${c.pr ? ` (#${c.pr})` : ""}`;
  const section = (heading: string, kinds: Kind[]) => {
    const items = changes.filter((c) => kinds.includes(c.kind));
    return items.length ? [`### ${heading}`, ...items.map(line), ""] : [];
  };
  return [
    ...section("Breaking", ["breaking"]),
    ...section("New", ["feat"]),
    ...section("Fixed", ["fix"]),
    ...section("Other", ["other"]),
  ].join("\n").trim() + "\n";
}

/** Parse `git log --first-parent --format=%H%x1f%P%x1f%s%x1e`. */
export function parseFirstParent(log: string): { sha: string; parents: string[]; subject: string }[] {
  return log.split("\x1e").map((r) => r.trim()).filter(Boolean).map((r) => {
    const [sha, parents, subject] = r.split("\x1f");
    return { sha, parents: parents.split(" ").filter(Boolean), subject };
  });
}

/** "Merge pull request #12 from owner/branch" -> 12. */
export function prNumber(subject: string): number | undefined {
  const m = /^Merge pull request #(\d+) /.exec(subject);
  return m ? Number(m[1]) : undefined;
}

/** Files attached to every release. The setup gets a space-free name so
 *  releases/latest/download/Setup-Dungeon-Master.bat is a link that never changes. */
export const RELEASE_ASSETS: { from: string; name: string }[] = [
  { from: "windows/Setup Dungeon Master.bat", name: "Setup-Dungeon-Master.bat" },
];
