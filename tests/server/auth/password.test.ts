import { describe, expect, it } from "vitest";
import { cookieSecret, loadOrCreateServerSecret, LoginRateLimiter, passwordMatches } from "../../../src/server/auth/password";
import { mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

describe("password", () => {
  it("matches exactly", () => {
    expect(passwordMatches("dragon", "dragon")).toBe(true);
    expect(passwordMatches("Dragon", "dragon")).toBe(false);
    expect(passwordMatches("", "dragon")).toBe(false);
    expect(passwordMatches("a much longer guess", "dragon")).toBe(false);
  });
  it("derives a stable secret that changes with the password and server secret", () => {
    const ss = "server-secret-1";
    expect(cookieSecret("a", ss)).toBe(cookieSecret("a", ss));
    expect(cookieSecret("a", ss)).not.toBe(cookieSecret("b", ss));
    expect(cookieSecret("a", ss)).not.toBe(cookieSecret("a", "server-secret-2"));
    expect(cookieSecret("a", ss).length).toBeGreaterThanOrEqual(32);
  });
});

describe("loadOrCreateServerSecret", () => {
  it("creates the file if it does not exist", () => {
    const tmpdir = mkdtempSync("/tmp/auth-test-");
    const path = join(tmpdir, "subdir", "secret");
    const secret = loadOrCreateServerSecret(path);
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(readFileSync(path, "utf-8").trim()).toBe(secret);
  });
  it("returns the same value on subsequent calls", () => {
    const tmpdir = mkdtempSync("/tmp/auth-test-");
    const path = join(tmpdir, "secret");
    const secret1 = loadOrCreateServerSecret(path);
    const secret2 = loadOrCreateServerSecret(path);
    expect(secret2).toBe(secret1);
  });
  it("creates the file with mode 0o600", () => {
    const tmpdir = mkdtempSync("/tmp/auth-test-");
    const path = join(tmpdir, "secret");
    loadOrCreateServerSecret(path);
    const stat = statSync(path);
    expect(stat.mode & 0o777).toBe(0o600);
  });
  it("treats an existing but empty or whitespace-only file as missing and regenerates", () => {
    const tmpdir = mkdtempSync("/tmp/auth-test-");
    const path = join(tmpdir, "secret");
    writeFileSync(path, "   \n", { mode: 0o600 });
    const secret = loadOrCreateServerSecret(path);
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
    expect(readFileSync(path, "utf-8").trim()).toBe(secret);
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
