import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * The release this copy is on, from git tags: "v1.4.0" on a release, "v1.4.0-3-gabc1234" a few
 * commits past one, "-dirty" with local edits. Releases are tagged by CI (scripts/release).
 */
export function appVersion(): string {
  try {
    return execFileSync("git", ["describe", "--tags", "--match", "v*", "--always", "--dirty"], {
      cwd: ROOT, stdio: ["ignore", "pipe", "ignore"],
    }).toString().trim() || "unknown";
  } catch {
    return "unknown"; // not a git checkout, or no git installed
  }
}
