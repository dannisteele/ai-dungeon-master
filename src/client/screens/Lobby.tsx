import { useEffect, useState } from "react";
import type { CampaignSummary } from "../../shared/types";
import { FeedbackPanel } from "../components/FeedbackPanel";
import { ModelPicker } from "../components/ModelPicker";
import { api } from "../lib/api";
import { useFeedbackEnabled } from "../lib/feedback";
import { go } from "../lib/router";
import { getMyCharacter } from "../lib/storage";

export function Lobby() {
  const [campaigns, setCampaigns] = useState<CampaignSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [packNote, setPackNote] = useState<string | null>(null);
  const [packing, setPacking] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [renaming, setRenaming] = useState<{ id: number; title: string } | null>(null);
  const [version, setVersion] = useState<{ version: string; latest: string | null; updateAvailable: boolean } | null>(null);
  const feedbackEnabled = useFeedbackEnabled();

  useEffect(() => { api.version().then(setVersion).catch(() => {}); }, []);

  const refetch = () => { api.campaigns().then((r) => setCampaigns(r.campaigns)).catch((e) => setError(e.message)); };

  useEffect(() => {
    refetch();
    const onVisible = () => { if (document.visibilityState === "visible") refetch(); };
    window.addEventListener("focus", refetch);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", refetch);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  async function saveRename() {
    if (!renaming) return;
    setError(null);
    try {
      await api.renameCampaign(renaming.id, renaming.title);
      setRenaming(null);
      refetch();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function remove(c: CampaignSummary) {
    if (!window.confirm(`Delete "${c.title}"? Its heroes and story go with it, and this can't be undone.`)) return;
    setError(null);
    try {
      await api.deleteCampaign(c.id);
      refetch();
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function packUp() {
    setPacking(true);
    setPackNote(null);
    try {
      await api.packUp();
      setPackNote("The Dungeon Master has gone home for the night. Memory freed; the next turn will take a little longer to start.");
    } catch (e) {
      setPackNote((e as Error).message);
    } finally {
      setPacking(false);
    }
  }

  return (
    <main className="page stack">
      <header className="row spread">
        <div><p className="eyebrow">The Tavern</p><h1>Your campaigns</h1></div>
        <div className="row">
          {feedbackEnabled && <button className="btn btn-ghost" onClick={() => setFeedbackOpen(true)}>Feedback</button>}
          <button className="btn btn-primary" onClick={() => go("/new")}>New campaign</button>
        </div>
      </header>
      {error && <p className="error">{error}</p>}
      {campaigns?.length === 0 && <p className="muted">No tales yet. Start one!</p>}
      <div className="grid-cards">
        {campaigns?.map((c) => {
          const mine = getMyCharacter(c.id);
          return (
            <article key={c.id} className="panel stack">
              <div>
                {renaming?.id === c.id
                  ? (
                    <form className="row" onSubmit={(e) => { e.preventDefault(); saveRename(); }} style={{ marginBottom: ".4em" }}>
                      <input className="input" style={{ flex: 1, minWidth: 0 }} maxLength={80} value={renaming.title} autoFocus
                        aria-label="Campaign name"
                        onChange={(e) => setRenaming({ id: c.id, title: e.target.value })}
                        onKeyDown={(e) => { if (e.key === "Escape") setRenaming(null); }} />
                      <button className="btn btn-primary" type="submit">Save</button>
                    </form>
                  )
                  : <h3>{c.title}</h3>}
                <p className="muted small">{c.mode === "solo" ? "Solo" : "Party"} · {c.sceneTitle || "Not yet begun"}</p>
                <p className="muted small">{c.characterNames.join(", ") || "No heroes yet"}</p>
              </div>
              <div className="row">
                {mine
                  ? <button className="btn btn-primary" onClick={() => go(`/c/${c.id}`)}>Continue</button>
                  : <button className="btn btn-primary" onClick={() => go(`/c/${c.id}/join`)}>Join</button>}
                {mine && <button className="btn btn-ghost" onClick={() => go(`/c/${c.id}/join`)}>Switch hero</button>}
              </div>
              <div className="row card-tools">
                <button className="link-btn" onClick={() => setRenaming({ id: c.id, title: c.title })}>Rename</button>
                <button className="link-btn danger" onClick={() => remove(c)}>Delete</button>
              </div>
            </article>
          );
        })}
      </div>
      <div style={{ marginTop: "3rem", maxWidth: 420 }}><ModelPicker /></div>
      <footer className="row spread">
        <p className="muted small" style={{ flex: 1, margin: 0 }}>{packNote ?? "Done for the evening? Free up the computer's memory."}</p>
        <button className="btn btn-ghost" onClick={packUp} disabled={packing}>{packing ? "Packing up…" : "🕯 Pack up for the night"}</button>
      </footer>
      {version && (
        <p className="muted small" style={{ margin: 0 }}>
          Version {version.version}
          {version.updateAvailable && <> · <span className="update-note">{version.latest} is out: run Check for Updates to get it.</span></>}
        </p>
      )}
      {feedbackOpen && <FeedbackPanel screen="lobby" onClose={() => setFeedbackOpen(false)} />}
    </main>
  );
}
