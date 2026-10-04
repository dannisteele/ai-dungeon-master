/** Splits the DM's recap into display paragraphs on blank lines, trimming and dropping empties. */
export function recapParagraphs(text: string): string[] {
  return text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
}
