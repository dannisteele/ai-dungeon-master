import { describe, expect, it } from "vitest";
import { bumpFor, commitKind, nextVersion, parseFirstParent, plainTitle, prNumber, releaseNotes, strongest } from "../../scripts/release/plan";

describe("release plan", () => {
  it("reads conventional commit kinds", () => {
    expect(commitKind("feat: picker")).toBe("feat");
    expect(commitKind("feat(ui): picker")).toBe("feat");
    expect(commitKind("fix: crash")).toBe("fix");
    expect(commitKind("perf: faster")).toBe("fix");
    expect(commitKind("docs: readme")).toBe("other");
    expect(commitKind("Spec: note the follow-up")).toBe("other");
    expect(commitKind("feat!: new save format")).toBe("breaking");
    expect(commitKind("fix: x", "BREAKING CHANGE: saves reset")).toBe("breaking");
  });

  it("picks the bump from the strongest change, and skips docs-only", () => {
    expect(strongest(["fix", "feat", "other"])).toBe("feat");
    expect(bumpFor([{ title: "a", kind: "fix" }, { title: "b", kind: "feat" }])).toBe("minor");
    expect(bumpFor([{ title: "a", kind: "fix" }])).toBe("patch");
    expect(bumpFor([{ title: "a", kind: "breaking" }])).toBe("major");
    expect(bumpFor([{ title: "a", kind: "other" }])).toBeNull();
    expect(bumpFor([])).toBeNull();
  });

  it("bumps versions", () => {
    expect(nextVersion("v1.2.3", "patch")).toBe("1.2.4");
    expect(nextVersion("v1.2.3", "minor")).toBe("1.3.0");
    expect(nextVersion("1.2.3", "major")).toBe("2.0.0");
    expect(() => nextVersion("v1.2", "patch")).toThrow();
  });

  it("writes notes grouped by kind, linking PRs", () => {
    expect(releaseNotes([
      { title: "Fix Ollama check on Windows", kind: "fix", pr: 5 },
      { title: "Model picker", kind: "feat", pr: 2 },
      { title: "Tidy readme", kind: "other" },
    ])).toBe("### New\n- Model picker (#2)\n\n### Fixed\n- Fix Ollama check on Windows (#5)\n\n### Other\n- Tidy readme\n");
  });

  it("parses first-parent history and PR merges", () => {
    const log = "aaa\x1fp1 p2\x1fMerge pull request #7 from x/y\x1e\nbbb\x1fp0\x1ffix(ui): tidy header\x1e\n";
    expect(parseFirstParent(log)).toEqual([
      { sha: "aaa", parents: ["p1", "p2"], subject: "Merge pull request #7 from x/y" },
      { sha: "bbb", parents: ["p0"], subject: "fix(ui): tidy header" },
    ]);
    expect(prNumber("Merge pull request #7 from x/y")).toBe(7);
    expect(prNumber("fix: x")).toBeUndefined();
    expect(plainTitle("fix(ui): tidy header")).toBe("Tidy header");
  });
});
