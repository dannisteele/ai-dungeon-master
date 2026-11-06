/** Just enough Markdown for docs/manual.md: headings, bullet lists, paragraphs and **bold**. */
export type ManualBlock =
  | { kind: "h1" | "h2" | "p"; text: string }
  | { kind: "list"; items: string[] };

export function manualBlocks(md: string): ManualBlock[] {
  const out: ManualBlock[] = [];
  for (const raw of md.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const last = out.at(-1);
    if (line.startsWith("## ")) out.push({ kind: "h2", text: line.slice(3) });
    else if (line.startsWith("# ")) out.push({ kind: "h1", text: line.slice(2) });
    else if (line.startsWith("- ")) {
      if (last?.kind === "list") last.items.push(line.slice(2));
      else out.push({ kind: "list", items: [line.slice(2)] });
    } else out.push({ kind: "p", text: line });
  }
  return out;
}

export function inline(text: string): { bold: boolean; text: string }[] {
  return text.split("**").map((t, i) => ({ bold: i % 2 === 1, text: t })).filter((s) => s.text);
}
