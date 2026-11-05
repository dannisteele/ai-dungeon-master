import { describe, expect, it } from "vitest";
import { createUpdateChecker, isNewer, versionParts } from "../../src/server/updates";

describe("update checks", () => {
  it("compares release versions, ignoring describe suffixes", () => {
    expect(versionParts("v1.4.0-3-gabc1234-dirty")).toEqual([1, 4, 0]);
    expect(versionParts("abc1234")).toBeNull();
    expect(isNewer("v1.4.1", "v1.4.0")).toBe(true);
    expect(isNewer("v1.10.0", "v1.9.9")).toBe(true);
    expect(isNewer("v1.4.0", "v1.4.0-3-gabc1234")).toBe(false);
    expect(isNewer("v1.3.9", "v1.4.0")).toBe(false);
    expect(isNewer("v1.4.0", "unknown")).toBe(false);
  });

  it("asks GitHub at most hourly, and treats failures as no news", async () => {
    let calls = 0;
    let t = 0;
    const checker = createUpdateChecker({
      repo: "a/b", now: () => t,
      fetch: (async (url: string) => {
        calls++;
        expect(url).toBe("https://api.github.com/repos/a/b/releases/latest");
        return new Response(JSON.stringify({ tag_name: "v2.0.0" }));
      }) as typeof fetch,
    });
    expect(await checker.latest()).toBe("v2.0.0");
    t = 30 * 60_000;
    expect(await checker.latest()).toBe("v2.0.0");
    expect(calls).toBe(1);
    t = 61 * 60_000;
    await checker.latest();
    expect(calls).toBe(2);

    const offline = createUpdateChecker({ repo: "a/b", fetch: (async () => { throw new Error("ENOTFOUND"); }) as typeof fetch });
    expect(await offline.latest()).toBeNull();
  });
});
