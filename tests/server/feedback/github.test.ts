import { describe, expect, it } from "vitest";
import { buildIssueBody, createGitHubIssueFiler, IssueFilerError } from "../../../src/server/feedback/github";

const ctx = {
  includeStory: false,
  kind: "bug" as const, details: "", screen: "lobby", appVersion: "1.0.0", model: "m", characters: [], events: [],
  now: new Date("2026-11-05T20:00:00Z"),
};

describe("buildIssueBody", () => {
  it("puts the description first and context in a fold", () => {
    const body = buildIssueBody({ ...ctx, details: "  It broke.  " });
    expect(body.startsWith("It broke.\n")).toBe(true);
    expect(body).toContain("<details><summary>Context (added automatically)</summary>");
    expect(body).toContain("- **Sent:** 2026-11-05T20:00:00.000Z");
    expect(body).not.toContain("Campaign");
  });

  it("leaves out the story, scene and summary unless asked, for bugs and ideas alike", () => {
    const withStory = {
      ...ctx,
      campaign: { id: 2, title: "Derelict", setting: "Sci-fi Derelict", sceneTitle: "The Airlock", round: 3 },
      summary: "They boarded the ship.",
      events: [{ id: 1, campaignId: 2, round: 1, createdAt: "", type: "narration" as const, text: "The hatch hisses." }],
    };
    for (const kind of ["bug", "idea"] as const) {
      const hidden = buildIssueBody({ ...withStory, kind, includeStory: false });
      expect(hidden).not.toContain("Recent story");
      expect(hidden).not.toContain("The hatch hisses");
      expect(hidden).not.toContain("The Airlock");
      expect(hidden).not.toContain("They boarded the ship");
      expect(hidden).toContain("**Campaign:** Derelict (campaign 2), round 3");
      const shown = buildIssueBody({ ...withStory, kind, includeStory: true });
      expect(shown).toContain("**Campaign:** Derelict (campaign 2), round 3, The Airlock");
      expect(shown).toContain("**Story so far**");
      expect(shown).toContain("They boarded the ship.");
      expect(shown).toContain("> [round 1] **DM:** The hatch hisses.");
    }
  });

  it("never writes #number, which GitHub would turn into a link to another issue", () => {
    const body = buildIssueBody({
      ...ctx, includeStory: true,
      campaign: { id: 2, title: "Derelict", setting: "Sci-fi Derelict", sceneTitle: "", round: 0 },
      events: [{ id: 1, campaignId: 2, round: 1, createdAt: "", type: "action", characterId: 9, text: "I look." }],
    });
    expect(body).toContain("**Campaign:** Derelict (campaign 2), not started yet");
    expect(body).toContain("**Setting:** Sci-fi Derelict");
    expect(body).toContain("**hero 9:** I look.");
    expect(body).not.toMatch(/#\d/);
  });

  it("notes an empty description and flattens multi-line narration", () => {
    const body = buildIssueBody({
      ...ctx, includeStory: true,
      events: [{ id: 1, campaignId: 1, round: 2, createdAt: "", type: "narration", text: "One.\n\nTwo." }],
    });
    expect(body).toContain("_No details given._");
    expect(body).toContain("> [round 2] **DM:** One. Two.");
  });
});

describe("createGitHubIssueFiler", () => {
  it("posts to the repo's issues endpoint with the token", async () => {
    let seen: { url: string; init: RequestInit } | undefined;
    const filer = createGitHubIssueFiler({
      token: "tok", repo: "a/b",
      fetch: (async (url: string, init: RequestInit) => {
        seen = { url, init };
        return new Response(JSON.stringify({ number: 3, html_url: "https://github.com/a/b/issues/3" }), { status: 201 });
      }) as typeof fetch,
    });
    expect(await filer.file({ title: "t", body: "b", labels: ["bug"] })).toEqual({ number: 3, url: "https://github.com/a/b/issues/3" });
    expect(seen!.url).toBe("https://api.github.com/repos/a/b/issues");
    expect((seen!.init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    expect(JSON.parse(seen!.init.body as string)).toEqual({ title: "t", body: "b", labels: ["bug"] });
  });

  it("turns GitHub errors and network failures into IssueFilerError", async () => {
    const refused = createGitHubIssueFiler({
      token: "bad", repo: "a/b",
      fetch: (async () => new Response(JSON.stringify({ message: "Bad credentials" }), { status: 401 })) as typeof fetch,
    });
    await expect(refused.file({ title: "t", body: "b", labels: [] })).rejects.toThrow(/401: Bad credentials/);
    const offline = createGitHubIssueFiler({ token: "t", repo: "a/b", fetch: (async () => { throw new Error("ENOTFOUND"); }) as typeof fetch });
    await expect(offline.file({ title: "t", body: "b", labels: [] })).rejects.toBeInstanceOf(IssueFilerError);
  });
});
