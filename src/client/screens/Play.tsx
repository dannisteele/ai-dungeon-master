import { useEffect, useRef, useState } from "react";
import type { StoredRoll } from "../../shared/types";
import { ActionBar } from "../components/ActionBar";
import { CharacterSheet } from "../components/CharacterSheet";
import { DiceOverlay } from "../components/DiceOverlay";
import { FeedbackPanel } from "../components/FeedbackPanel";
import { RecapPanel } from "../components/RecapPanel";
import { SettingsPanel } from "../components/SettingsPanel";
import { Story } from "../components/Story";
import { useFeedbackEnabled } from "../lib/feedback";
import { getMyCharacter } from "../lib/storage";
import { buildStory, eventsBeforeRoll, isRoll, nameOf } from "../lib/story";
import { useGameSocket } from "../lib/useGameSocket";

export function Play({ campaignId }: { campaignId: number }) {
  const { snapshot, streaming, error, connected, send } = useGameSocket(campaignId);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [recapOpen, setRecapOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const feedbackEnabled = useFeedbackEnabled();
  const [diceQueue, setDiceQueue] = useState<StoredRoll[]>([]);
  const lastSeenRoll = useRef<number | null>(null);
  const storyRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
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

  // Keep pinned to the bottom only while the reader was already there; don't yank them back
  // down mid-reread just because narration is still streaming in (dozens of chunks per reply).
  const handleStoryScroll = () => {
    const el = storyRef.current;
    if (!el) return;
    atBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  useEffect(() => {
    const el = storyRef.current;
    if (el && atBottomRef.current) el.scrollTop = el.scrollHeight;
  }, [snapshot?.events.length, streaming]);

  if (!snapshot) return <main className="page muted">{error ?? "Pulling up a chair…"}</main>;

  const me = snapshot.characters.find((c) => c.id === myId) ?? null;
  const current = diceQueue[0];
  // While a die is tumbling, keep its result (and anything the DM wrote after it) off screen.
  const visibleEvents = eventsBeforeRoll(snapshot.events, current?.id);
  const rollingIds = new Set(diceQueue.map((r) => r.characterId));

  return (
    <div className="play">
      <div className="play-main">
        <header className="play-header">
          <a href="#/" className="muted header-back">← Tavern</a>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="eyebrow" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {snapshot.campaign.sceneTitle || snapshot.campaign.title}
            </p>
          </div>
          <span className={connected ? "dot ok" : "dot"} title={connected ? "Connected" : "Reconnecting…"} />
          <button className="btn btn-ghost header-btn" aria-label="Story so far" onClick={() => setRecapOpen(true)}><span className="label-long">Story so far</span><span className="label-short">Recap</span></button>
          <button className="btn btn-ghost header-btn" aria-label="Table settings" onClick={() => setSettingsOpen(true)}><span className="label-long">Settings</span><span className="label-short">⚙</span></button>
          {feedbackEnabled && <button className="btn btn-ghost header-btn" aria-label="Send feedback" onClick={() => setFeedbackOpen(true)}><span className="label-long">Feedback</span><span className="label-short">💬</span></button>}
          <button className="btn btn-ghost header-btn sheet-toggle" onClick={() => setSheetOpen(true)}>Sheet</button>
        </header>
        <div className="story" ref={storyRef} onScroll={handleStoryScroll}>
          <div className="story-inner">
            <Story entries={buildStory(visibleEvents, snapshot.characters)} streaming={current ? "" : streaming} />
          </div>
        </div>
        <ActionBar snapshot={snapshot} me={me} campaignId={campaignId} error={error} send={send} rollingIds={rollingIds} />
      </div>
      <CharacterSheet snapshot={snapshot} me={me} open={sheetOpen} onClose={() => setSheetOpen(false)} />
      {recapOpen && <RecapPanel campaignId={campaignId} onClose={() => setRecapOpen(false)} />}
      {settingsOpen && <SettingsPanel campaign={snapshot.campaign} onClose={() => setSettingsOpen(false)} />}
      {feedbackOpen && <FeedbackPanel screen="play" campaignId={campaignId} characterId={myId} onClose={() => setFeedbackOpen(false)} />}
      {current && (
        <DiceOverlay key={current.id} roll={current} name={nameOf(snapshot.characters, current.characterId)}
          onDone={() => setDiceQueue((q) => q.slice(1))} />
      )}
    </div>
  );
}
