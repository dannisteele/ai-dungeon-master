import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");

/** package.json version plus the git commit, when this copy is a git checkout. */
export function appVersion(): string {
  let version = "unknown";
  try { version = (JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { version: string }).version; } catch { /* keep "unknown" */ }
  try {
    const commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    if (commit) version += ` (${commit})`;
  } catch { /* not a git checkout, or no git installed */ }
  return version;
}
