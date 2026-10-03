import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withTimeout } from "../../src/client/lib/dice";

describe("withTimeout", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("resolves with the inner value when it settles before the deadline", async () => {
    const fast = new Promise<string>((resolve) => setTimeout(() => resolve("ok"), 10));
    const result = withTimeout(fast, 1000);
    await vi.advanceTimersByTimeAsync(10);
    await expect(result).resolves.toBe("ok");
  });

  it("rejects once the deadline passes without the inner promise settling", async () => {
    const slow = new Promise<string>((resolve) => setTimeout(() => resolve("too late"), 5000));
    const result = withTimeout(slow, 1000);
    const assertion = expect(result).rejects.toThrow(/timed out/i);
    await vi.advanceTimersByTimeAsync(1000);
    await assertion;
  });

  it("propagates the inner promise's rejection without waiting for the deadline", async () => {
    const broken = Promise.reject(new Error("boom"));
    await expect(withTimeout(broken, 1000)).rejects.toThrow("boom");
  });
});
