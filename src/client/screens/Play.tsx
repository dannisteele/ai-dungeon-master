import { useEffect, useRef, useState } from "react";
import { AI_PHASES, type StoredRoll } from "../../shared/types";
import { ActionBar } from "../components/ActionBar";
import { CharacterSheet } from "../components/CharacterSheet";
import { DiceOverlay } from "../components/DiceOverlay";
import { FeedbackPanel } from "../components/FeedbackPanel";
import { HelpPanel } from "../components/HelpPanel";
import { InvitePanel } from "../components/InvitePanel";
import { MoreMenu } from "../components/MoreMenu";
import { PeoplePanel } from "../components/PeoplePanel";
import { RecapPanel } from "../components/RecapPanel";
import { SettingsPanel } from "../components/SettingsPanel";
import { Story } from "../components/Story";
import { api } from "../lib/api";
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
  const [helpOpen, setHelpOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  // null: closed; "": open at the top; a name: open at that person's card.
  const [peopleFocus, setPeopleFocus] = useState<string | null>(null);
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
          <div className="header-title" style={{ flex: 1, minWidth: 0 }}>
            <p className="eyebrow" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {snapshot.campaign.sceneTitle || snapshot.campaign.title}
            </p>
          </div>
          <span className={connected ? "dot ok" : "dot"} title={connected ? "Connected" : "Reconnecting…"} />
          <button className="btn btn-ghost header-btn" aria-label="Story so far" onClick={() => setRecapOpen(true)}><span className="label-long">Story so far</span><span className="label-short">Recap</span></button>
          <button className="btn btn-ghost header-btn" aria-label="People you've met" onClick={() => setPeopleFocus("")}><span className="label-long">People</span><span className="label-short">👥</span></button>
          <MoreMenu items={[
            // Solo campaigns have one hero, so there's nobody to invite.
            ...(snapshot.campaign.mode === "party" ? [{ label: "📨 Invite someone", onSelect: () => setInviteOpen(true) }] : []),
            { label: "⚙ Table settings", onSelect: () => setSettingsOpen(true) },
            { label: "❓ Help", onSelect: () => setHelpOpen(true) },
            ...(feedbackEnabled ? [{ label: "💬 Send feedback", onSelect: () => setFeedbackOpen(true) }] : []),
          ]} />
          <button className="btn btn-ghost header-btn sheet-toggle" onClick={() => setSheetOpen(true)}>Sheet</button>
        </header>
        <div className="story" ref={storyRef} onScroll={handleStoryScroll}>
          <div className="story-inner">
            <Story entries={buildStory(visibleEvents, snapshot.characters)} streaming={current ? "" : streaming} tools={{
              editable: !current && !streaming && !(AI_PHASES as readonly string[]).includes(snapshot.campaign.roundState),
              canTryAgain: snapshot.canTryAgain,
              onEdit: (id, text) => api.editReply(campaignId, id, text),
              onTryAgain: () => send({ t: "try_again" }),
              myId,
              onChangeAction: (characterId, text) => send({ t: "change_action", characterId, text }),
            }} />
          </div>
        </div>
        <ActionBar snapshot={snapshot} me={me} campaignId={campaignId} error={error} send={send} rollingIds={rollingIds} onAbout={setPeopleFocus} />
      </div>
      <CharacterSheet snapshot={snapshot} me={me} open={sheetOpen} onClose={() => setSheetOpen(false)} />
      {recapOpen && <RecapPanel campaignId={campaignId} onClose={() => setRecapOpen(false)} />}
      {peopleFocus !== null && (
        <PeoplePanel campaignId={campaignId} people={snapshot.people} focus={peopleFocus || undefined} onClose={() => setPeopleFocus(null)} />
      )}
      {helpOpen && <HelpPanel onClose={() => setHelpOpen(false)} />}
      {inviteOpen && <InvitePanel onClose={() => setInviteOpen(false)} />}
      {settingsOpen && <SettingsPanel campaign={snapshot.campaign} onClose={() => setSettingsOpen(false)} />}
      {feedbackOpen && <FeedbackPanel screen="play" campaignId={campaignId} characterId={myId} onClose={() => setFeedbackOpen(false)} />}
      {current && (
        <DiceOverlay key={current.id} roll={current} name={nameOf(snapshot.characters, current.characterId)}
          onDone={() => setDiceQueue((q) => q.slice(1))} />
      )}
    </div>
  );
}
