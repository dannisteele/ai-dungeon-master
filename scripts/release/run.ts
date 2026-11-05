// Run by CI on every push to main: if features or fixes landed since the last v* tag, tag a
// new version and publish a GitHub release with notes grouped by PR. Needs the gh CLI with
// GH_TOKEN, and a full clone (fetch-depth: 0). `--dry-run` prints what it would do.
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bumpFor, commitKind, nextVersion, parseFirstParent, plainTitle, prNumber, releaseNotes, strongest, type Change } from "./plan";

const dryRun = process.argv.includes("--dry-run");
const run = (cmd: string, args: string[]) => execFileSync(cmd, args, { encoding: "utf8" }).trim();

// Plain release tags only (v1.2.3), not e.g. v1.2.3-test.
const lastTag = run("git", ["describe", "--tags", "--abbrev=0", "--match", "v[0-9]*", "--exclude", "*-*"]);
const head = run("git", ["rev-parse", "HEAD"]);
const entries = parseFirstParent(run("git", ["log", "--first-parent", "--format=%H%x1f%P%x1f%s%x1e", `${lastTag}..HEAD`])).reverse();

const changes: Change[] = entries.map((e) => {
  const pr = prNumber(e.subject);
  if (pr === undefined || e.parents.length < 2) return { title: plainTitle(e.subject), kind: commitKind(e.subject) };
  const commits = run("git", ["log", "--no-merges", "--format=%s%x1f%b%x1e", `${e.parents[0]}..${e.parents[1]}`])
    .split("\x1e").map((r) => r.trim()).filter(Boolean).map((r) => r.split("\x1f"));
  const title = run("gh", ["pr", "view", String(pr), "--json", "title", "--jq", ".title"]);
  return { title, pr, kind: strongest(commits.map(([s, b]) => commitKind(s, b))) };
});

const bump = bumpFor(changes);
if (!bump) {
  console.log(`Nothing to release since ${lastTag} (${changes.length} change(s), none a feature or fix).`);
  process.exit(0);
}
const tag = `v${nextVersion(lastTag, bump)}`;
const notes = releaseNotes(changes);
console.log(`${lastTag} -> ${tag} (${bump})\n\n${notes}`);
if (dryRun) process.exit(0);

const file = join(mkdtempSync(join(tmpdir(), "release-")), "notes.md");
writeFileSync(file, notes);
run("gh", ["release", "create", tag, "--target", head, "--title", tag, "--notes-file", file]);
console.log(`Published ${tag}`);
