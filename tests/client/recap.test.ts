import { describe, expect, it } from "vitest";
import { recapParagraphs } from "../../src/client/lib/recap";

describe("recapParagraphs", () => {
  it("splits on blank lines, trims and drops empty paragraphs", () => {
    expect(recapParagraphs("  First part.\n\nSecond part.\n \n\n Third.  ")).toEqual(["First part.", "Second part.", "Third."]);
  });
  it("keeps single line breaks inside a paragraph", () => {
    expect(recapParagraphs("Line one\nline two")).toEqual(["Line one\nline two"]);
  });
  it("returns nothing for an empty recap", () => {
    expect(recapParagraphs("   ")).toEqual([]);
  });
});
