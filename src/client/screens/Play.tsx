import { useEffect, useRef, useState } from "react";
import type { StoredRoll } from "../../shared/types";
import { ActionBar } from "../components/ActionBar";
import { CharacterSheet } from "../components/CharacterSheet";
import { DiceOverlay } from "../components/DiceOverlay";
import { Story } from "../components/Story";
import { getMyCharacter } from "../lib/storage";
import { buildStory, isRoll, nameOf } from "../lib/story";
import { useGameSocket } from "../lib/useGameSocket";

export function Play({ campaignId }: { campaignId: number }) {
  const { snapshot, streaming, error, connected, send } = useGameSocket(campaignId);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [diceQueue, setDiceQueue] = useState<StoredRoll[]>([]);
  const lastSeenRoll = useRef<number | null>(null);
  const storyRef = useRef<HTMLDivElement>(null);
  const myId = getMyCharacter(campaignId);

  // Animate rolls that arrive while we're watching (not ones already in the log when we joined).
  useEffect(() => {
    if (!snapshot) return;
    const rolls = snapshot.events.filter(isRoll);
    if (lastSeenRoll.current === null) { lastSeenRoll.current = rolls.at(-1)?.id ?? 0; return; }
    const fresh = rolls.filter((r) => r.id > lastSeenRoll.current!);
    if (fresh.length) {
      lastSeenRoll.current = fresh.at(-1)!.id;
      setDiceQueue((q) => [...q, ...fresh]);
    }
  }, [snapshot]);

  useEffect(() => {
    const el = storyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [snapshot?.events.length, streaming]);

  if (!snapshot) return <main className="page muted">{error ?? "Pulling up a chair…"}</main>;

  const me = snapshot.characters.find((c) => c.id === myId) ?? null;
  const current = diceQueue[0];

  return (
    <div className="play">
      <div className="play-main">
        <header className="play-header">
          <a href="#/" className="muted">← Tavern</a>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="eyebrow" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {snapshot.campaign.sceneTitle || snapshot.campaign.title}
            </p>
          </div>
          <span className={connected ? "dot ok" : "dot"} title={connected ? "Connected" : "Reconnecting…"} />
          <button className="btn btn-ghost sheet-toggle" onClick={() => setSheetOpen(true)}>Sheet</button>
        </header>
        <div className="story" ref={storyRef}>
          <div className="story-inner">
            <Story entries={buildStory(snapshot.events, snapshot.characters)} streaming={streaming} />
          </div>
        </div>
        <ActionBar snapshot={snapshot} me={me} campaignId={campaignId} error={error} send={send} />
      </div>
      <CharacterSheet snapshot={snapshot} me={me} open={sheetOpen} onClose={() => setSheetOpen(false)} />
      {current && (
        <DiceOverlay key={current.id} roll={current} name={nameOf(snapshot.characters, current.characterId)}
          onDone={() => setDiceQueue((q) => q.slice(1))} />
      )}
    </div>
  );
}
