import { useEffect, useRef, useState } from "react";
import type { Person } from "../../shared/types";
import { api } from "../lib/api";

const MAX = 500;

/** Everyone the heroes have met: the DM's description of each, and the player's own notes. */
export function PeoplePanel({ campaignId, people, focus, onClose }: {
  campaignId: number; people: Person[]; focus?: string; onClose: () => void;
}) {
  const [editing, setEditing] = useState<{ name: string; about: string; notes: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const cards = useRef<Record<string, HTMLElement | null>>({});

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    if (focus) cards.current[focus.toLowerCase()]?.scrollIntoView({ block: "center" });
  }, [focus]);

  async function save(patch: { about?: string; notes?: string; letDmUpdate?: true }, name: string) {
    setSaving(true);
    setError(null);
    try {
      await api.updatePerson(campaignId, name, patch); // the snapshot broadcast refreshes `people`
      setEditing(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function saveEdit(p: Person) {
    if (!editing) return;
    const patch: { about?: string; notes?: string } = {};
    if (editing.about.trim() !== p.about) patch.about = editing.about;
    if (editing.notes.trim() !== p.notes) patch.notes = editing.notes;
    if (patch.about === undefined && patch.notes === undefined) { setEditing(null); return; }
    void save(patch, p.name);
  }

  return (
    <div className="recap-backdrop" onClick={onClose}>
      <section className="recap-panel" role="dialog" aria-modal="true" aria-labelledby="people-title" onClick={(e) => e.stopPropagation()}>
        <header className="row spread">
          <h2 id="people-title" style={{ margin: 0 }}>People you've met</h2>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </header>
        <div className="stack recap-body">
          {people.length === 0 && <p className="muted">Nobody yet. People you meet will appear here.</p>}
          {people.map((p) => {
            const mine = editing?.name === p.name ? editing : null;
            return (
              <article key={p.name} className="panel stack person-card" ref={(el) => { cards.current[p.name.toLowerCase()] = el; }}
                aria-current={focus?.toLowerCase() === p.name.toLowerCase() || undefined}>
                <div className="row spread">
                  <h3 style={{ margin: 0 }}>{p.name}</h3>
                  <span className={`npc-chip npc-${p.attitude} person-chip`}>
                    <span className="npc-name">{p.attitude}</span><small className="npc-condition">{p.condition}</small>
                  </span>
                </div>
                <p className="muted small" style={{ margin: 0 }}>{p.present ? "Here now" : `Last seen in round ${p.lastSeenRound}`}</p>
                {mine
                  ? (
                    <form className="stack" onSubmit={(e) => { e.preventDefault(); saveEdit(p); }}>
                      <label className="stack field">
                        <span>Who they are ({mine.about.length}/{MAX})</span>
                        <textarea className="input" rows={3} maxLength={MAX} value={mine.about}
                          onChange={(e) => setEditing({ ...mine, about: e.target.value })} />
                      </label>
                      <label className="stack field">
                        <span>Your notes: the DM treats these as true ({mine.notes.length}/{MAX})</span>
                        <textarea className="input" rows={3} maxLength={MAX} value={mine.notes}
                          onChange={(e) => setEditing({ ...mine, notes: e.target.value })} />
                      </label>
                      <div className="row">
                        <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? "Saving…" : "Save"}</button>
                        <button className="btn btn-ghost" type="button" onClick={() => setEditing(null)}>Cancel</button>
                      </div>
                    </form>
                  )
                  : (
                    <>
                      <p style={{ margin: 0 }}>{p.about || <span className="muted">The DM hasn't described them yet.</span>}</p>
                      {p.notes && <p className="person-notes" style={{ margin: 0 }}><b>Your notes:</b> {p.notes}</p>}
                      <div className="row card-tools">
                        <button className="link-btn" onClick={() => { setError(null); setEditing({ name: p.name, about: p.about, notes: p.notes }); }}>Edit</button>
                        {p.aboutEdited && (
                          <button className="link-btn" disabled={saving} onClick={() => save({ letDmUpdate: true }, p.name)}>Let the DM update this</button>
                        )}
                      </div>
                    </>
                  )}
              </article>
            );
          })}
          {error && <p className="error">{error}</p>}
        </div>
      </section>
    </div>
  );
}
