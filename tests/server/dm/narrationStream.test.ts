import { describe, expect, it } from "vitest";
import { NarrationExtractor } from "../../../src/server/dm/narrationStream";

function feed(chunks: string[]): string {
  const x = new NarrationExtractor();
  return chunks.map((c) => x.push(c)).join("");
}

describe("NarrationExtractor", () => {
  const json = JSON.stringify({ narration: 'The bell tolls.\n"Who rings it?" she asks — ☃ 😀', changes: [{ op: "set_scene", title: "x" }] });
  const expected = 'The bell tolls.\n"Who rings it?" she asks — ☃ 😀';

  it("extracts the narration from a whole document", () => {
    expect(feed([json])).toBe(expected);
  });

  it("gives the same result however the stream is split", () => {
    for (let i = 1; i < json.length; i++) {
      expect(feed([json.slice(0, i), json.slice(i)])).toBe(expected);
    }
    expect(feed([...json])).toBe(expected);
  });

  it("decodes \\u escapes, including surrogate pairs", () => {
    const raw = '{"narration": "snow\\u2603 smile\\ud83d\\ude00"}';
    expect(feed([...raw])).toBe("snow☃ smile😀");
  });

  it("ignores everything after the closing quote", () => {
    expect(feed(['{ "narration" : "Hi", "changes": [{"name":"narration"}]}'])).toBe("Hi");
  });

  it("returns nothing when there is no narration key", () => {
    expect(feed(['{"checks": []}'])).toBe("");
  });

  it("matches JSON.parse for all escape sequences", () => {
    // Test string with \r, \b, \f, \/, \", \\, and \n
    const raw = '{"narration": "cr\\r bs\\b ff\\f sl\\/ dq\\" bs\\\\nl\\n"}';
    const expected = JSON.parse(raw).narration;
    // Feed the raw string char by char to test streaming
    expect(feed([...raw])).toBe(expected);
    // Also test with whole string at once
    expect(feed([raw])).toBe(expected);
  });
});
