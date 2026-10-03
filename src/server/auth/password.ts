import { createHash, timingSafeEqual } from "node:crypto";

const sha256 = (s: string) => createHash("sha256").update(s).digest();

export function passwordMatches(input: string, expected: string): boolean {
  return timingSafeEqual(sha256(input), sha256(expected));
}

/** Changing TABLE_PASSWORD changes the secret, which signs every device out. */
export function cookieSecret(password: string): string {
  return sha256(`ai-dungeon-master:cookie:${password}`).toString("hex");
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
