import { describe, expect, it } from "vitest";
import { inline, manualBlocks } from "../../src/client/lib/manual";

describe("manual", () => {
  it("splits the manual into headings, lists and paragraphs", () => {
    expect(manualBlocks("# How to play\n\n## Starting up\n- One\n- Two **bold**\n\nA line.")).toEqual([
      { kind: "h1", text: "How to play" },
      { kind: "h2", text: "Starting up" },
      { kind: "list", items: ["One", "Two **bold**"] },
      { kind: "p", text: "A line." },
    ]);
  });

  it("marks bold text", () => {
    expect(inline("Press **Act**, then **Roll d20**.")).toEqual([
      { bold: false, text: "Press " }, { bold: true, text: "Act" }, { bold: false, text: ", then " }, { bold: true, text: "Roll d20" }, { bold: false, text: "." },
    ]);
  });
});
