/**
 * Pulls the value of the top-level "narration" string out of a JSON document
 * as it streams in, so players see the story appear word by word.
 */
export class NarrationExtractor {
  private mode: "seek" | "in" | "done" = "seek";
  private seekBuf = "";
  private escape = false;
  private unicode: string | null = null;

  push(chunk: string): string {
    if (this.mode === "done") return "";
    let text = chunk;
    if (this.mode === "seek") {
      this.seekBuf += chunk;
      const m = /"narration"\s*:\s*"/.exec(this.seekBuf);
      if (!m) {
        this.seekBuf = this.seekBuf.slice(-32); // enough to hold a split key
        return "";
      }
      text = this.seekBuf.slice(m.index + m[0].length);
      this.seekBuf = "";
      this.mode = "in";
    }
    let out = "";
    for (const ch of text) {
      if (this.unicode !== null) {
        this.unicode += ch;
        if (this.unicode.length === 4) {
          out += String.fromCharCode(parseInt(this.unicode, 16));
          this.unicode = null;
        }
      } else if (this.escape) {
        this.escape = false;
        if (ch === "u") this.unicode = "";
        else out += ({ n: "\n", t: "\t", r: "", b: "", f: "" } as Record<string, string>)[ch] ?? ch;
      } else if (ch === "\\") {
        this.escape = true;
      } else if (ch === '"') {
        this.mode = "done";
        break;
      } else {
        out += ch;
      }
    }
    return out;
  }
}
