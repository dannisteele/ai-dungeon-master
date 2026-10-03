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

/**
 * Keeps the NPC quick-action menu inside its container: never past the left edge, and never
 * past the right edge. If the container is narrower than the menu, pins it to the left edge.
 */
export function clampMenuLeft(desired: number, menuWidth: number, containerWidth: number): number {
  return Math.max(0, Math.min(desired, containerWidth - menuWidth));
}
