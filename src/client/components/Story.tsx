import { useState } from "react";
import { formatModifier } from "../../shared/abilities";
import type { StoryEntry } from "../lib/story";

export interface ReplyTools {
  /** False while the DM is writing: replies can't be changed then. */
  editable: boolean;
  canTryAgain: boolean;
  onEdit(id: number, text: string): Promise<void>;
  onTryAgain(): void;
  /** The hero this device plays: their action in the latest round can be changed. */
  myId: number | null;
  onChangeAction(characterId: number, text: string): void;
}

/** The player's own action in the round the DM just answered: rewrite it and the DM answers again. */
function MyAction({ characterId, name, text, tools }: { characterId: number; name: string; text: string; tools: ReplyTools }) {
  const [draft, setDraft] = useState<string | null>(null);
  if (draft !== null) {
    return (
      <form className="stack reply-edit" onSubmit={(e) => {
        e.preventDefault();
        if (draft.trim() && draft.trim() !== text) tools.onChangeAction(characterId, draft);
        setDraft(null);
      }}>
        <textarea className="input" rows={3} maxLength={1000} value={draft} autoFocus aria-label={`What ${name} does`}
          onChange={(e) => setDraft(e.target.value)} />
        <p className="muted small" style={{ margin: 0 }}>The Dungeon Master's reply is undone (with anything it gave or took) and it answers this instead.</p>
        <div className="row">
          <button className="btn btn-primary" type="submit" disabled={!draft.trim()}>Change and try again</button>
          <button className="btn btn-ghost" type="button" onClick={() => setDraft(null)}>Cancel</button>
        </div>
      </form>
    );
  }
  return (
    <div className="reply">
      <p className="action-line"><b>{name}</b> {text}</p>
      <div className="row card-tools reply-tools"><button className="link-btn" onClick={() => setDraft(text)}>Change</button></div>
    </div>
  );
}

/** One of the DM's replies, which the players can rewrite; the latest can also be written again. */
function Reply({ id, text, latest, tools }: { id: number; text: string; latest: boolean; tools?: ReplyTools }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (draft === null) return;
    if (draft.trim() === text) { setDraft(null); return; }
    setSaving(true);
    setError(null);
    try {
      await tools!.onEdit(id, draft);
      setDraft(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (draft !== null) {
    return (
      <form className="stack reply-edit" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <textarea className="input" rows={8} maxLength={4000} value={draft} autoFocus aria-label="The Dungeon Master's reply"
          onChange={(e) => setDraft(e.target.value)} />
        <p className="muted small" style={{ margin: 0 }}>The Dungeon Master will carry on from your version. Items and health aren't changed.</p>
        <div className="row">
          <button className="btn btn-primary" type="submit" disabled={saving || !draft.trim()}>{saving ? "Saving…" : "Save"}</button>
          <button className="btn btn-ghost" type="button" onClick={() => { setDraft(null); setError(null); }}>Cancel</button>
        </div>
        {error && <p className="error">{error}</p>}
      </form>
    );
  }
  return (
    <div className="reply">
      <p className="narration">{text}</p>
      {tools?.editable && (
        <div className="row card-tools reply-tools">
          <button className="link-btn" onClick={() => setDraft(text)}>Edit</button>
          {latest && tools.canTryAgain && (
            <button className="link-btn" onClick={() => {
              if (confirm("Have the Dungeon Master write this reply again? Anything it gave, took or changed is undone first.")) tools.onTryAgain();
            }}>Try again</button>
          )}
        </div>
      )}
    </div>
  );
}

export function Story({ entries, streaming, tools }: { entries: StoryEntry[]; streaming: string; tools?: ReplyTools }) {
  const lastReply = entries.findLast((e) => e.kind === "narration")?.id;
  // The latest answered round: between the last two replies. Dice rolled there lock its actions.
  const last = entries.findLastIndex((e) => e.kind === "narration");
  const prev = entries.slice(0, Math.max(0, last)).findLastIndex((e) => e.kind === "narration");
  const changeable = tools?.editable && tools.canTryAgain && last > 0 && !entries.slice(prev + 1, last).some((e) => e.kind === "roll");
  return (
    <>
      {entries.map((e, i) => {
        switch (e.kind) {
          case "narration": return <Reply key={e.id} id={e.id} text={e.text} latest={e.id === lastReply} tools={tools} />;
          case "action": {
            const mine = changeable && e.characterId === tools!.myId && i > prev && i < last;
            return mine
              ? <MyAction key={e.id} characterId={e.characterId} name={e.name} text={e.text} tools={tools!} />
              : <p key={e.id} className="action-line"><b>{e.name}</b> {e.text}</p>;
          }
          case "skip": return <p key={e.id} className="action-line">{e.text}</p>;
          case "sheet": return <span key={e.id} className="sheet-chip">{e.text}</span>;
          case "fallen": return <p key={e.id} className="story-fallen">The party has fallen.</p>;
          case "roll": {
            const r = e.roll;
            return (
              <div key={e.id}>
                <span className="roll-chip">
                  <span className="die-glyph" aria-hidden>⚄</span>
                  {e.name} · {r.ability} DC {r.dc} · {r.die} {formatModifier(r.modifier)} = <b>{r.total}</b>
                  <span className={r.success ? "ok" : "fail"}>{r.crit === "nat20" ? "Natural 20!" : r.crit === "nat1" ? "Natural 1" : r.success ? "success" : "failure"}</span>
                </span>
              </div>
            );
          }
        }
      })}
      {streaming && <p className="narration caret">{streaming}</p>}
    </>
  );
}
