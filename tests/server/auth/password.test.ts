import { describe, expect, it } from "vitest";
import { cookieSecret, LoginRateLimiter, passwordMatches } from "../../../src/server/auth/password";

describe("password", () => {
  it("matches exactly", () => {
    expect(passwordMatches("dragon", "dragon")).toBe(true);
    expect(passwordMatches("Dragon", "dragon")).toBe(false);
    expect(passwordMatches("", "dragon")).toBe(false);
    expect(passwordMatches("a much longer guess", "dragon")).toBe(false);
  });
  it("derives a stable secret that changes with the password", () => {
    expect(cookieSecret("a")).toBe(cookieSecret("a"));
    expect(cookieSecret("a")).not.toBe(cookieSecret("b"));
    expect(cookieSecret("a").length).toBeGreaterThanOrEqual(32);
  });
});

describe("LoginRateLimiter", () => {
  it("blocks after max failures within the window, then forgets", () => {
    let t = 0;
    const rl = new LoginRateLimiter(3, 1000, () => t);
    for (let i = 0; i < 3; i++) rl.recordFailure("1.1.1.1");
    expect(rl.isBlocked("1.1.1.1")).toBe(true);
    expect(rl.isBlocked("2.2.2.2")).toBe(false);
    t = 1001;
    expect(rl.isBlocked("1.1.1.1")).toBe(false);
  });
  it("reset clears an IP", () => {
    const rl = new LoginRateLimiter(1, 1000, () => 0);
    rl.recordFailure("x");
    rl.reset("x");
    expect(rl.isBlocked("x")).toBe(false);
  });
});
