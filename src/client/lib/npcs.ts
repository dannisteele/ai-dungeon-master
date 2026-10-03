export type QuickAction = "attack" | "talk" | "watch";

export function quickActionText(kind: QuickAction, name: string): string {
  switch (kind) {
    case "attack": return `I attack ${name}`;
    case "talk": return `I talk to ${name}`;
    case "watch": return `I watch ${name} closely`;
  }
}

/** Adds a quick-action sentence to whatever the player has already typed, never discarding it. */
export function appendAction(current: string, sentence: string): string {
  const kept = current.trimEnd();
  return kept ? `${kept} ${sentence}` : sentence;
}
