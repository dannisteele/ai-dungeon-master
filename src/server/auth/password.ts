import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const sha256 = (s: string) => createHash("sha256").update(s).digest();

export function passwordMatches(input: string, expected: string): boolean {
  return timingSafeEqual(sha256(input), sha256(expected));
}

export function loadOrCreateServerSecret(path: string): string {
  try {
    const existing = readFileSync(path, "utf-8").trim();
    if (existing) return existing;
  } catch { /* file missing: fall through to create one */ }
  const secret = randomBytes(32).toString("hex");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, secret, { mode: 0o600 });
  return secret;
}

/** Changing TABLE_PASSWORD or the server secret changes the cookie secret, which signs every device out. */
export function cookieSecret(password: string, serverSecret: string): string {
  return sha256(`ai-dungeon-master:cookie:${serverSecret}:${password}`).toString("hex");
}

export class LoginRateLimiter {
  private failures = new Map<string, number[]>();
  constructor(private max = 10, private windowMs = 10 * 60_000, private now: () => number = Date.now) {}

  private recent(ip: string): number[] {
    const cutoff = this.now() - this.windowMs;
    const list = (this.failures.get(ip) ?? []).filter((t) => t > cutoff);
    this.failures.set(ip, list);
    return list;
  }
  isBlocked(ip: string): boolean { return this.recent(ip).length >= this.max; }
  recordFailure(ip: string): void { this.recent(ip).push(this.now()); }
  reset(ip: string): void { this.failures.delete(ip); }
}
