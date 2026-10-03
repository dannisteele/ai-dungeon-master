import { useEffect, useState } from "react";
import type { CampaignSummary } from "../../shared/types";
import { api } from "../lib/api";
import { go } from "../lib/router";
import { getMyCharacter } from "../lib/storage";

export function Lobby() {
  const [campaigns, setCampaigns] = useState<CampaignSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [packNote, setPackNote] = useState<string | null>(null);
  const [packing, setPacking] = useState(false);

  useEffect(() => { api.campaigns().then((r) => setCampaigns(r.campaigns)).catch((e) => setError(e.message)); }, []);

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
        <button className="btn btn-primary" onClick={() => go("/new")}>New campaign</button>
      </header>
      {error && <p className="error">{error}</p>}
      {campaigns?.length === 0 && <p className="muted">No tales yet. Start one!</p>}
      <div className="grid-cards">
        {campaigns?.map((c) => {
          const mine = getMyCharacter(c.id);
          return (
            <article key={c.id} className="panel stack">
              <div>
                <h3>{c.title}</h3>
                <p className="muted small">{c.mode === "solo" ? "Solo" : "Party"} · {c.sceneTitle || "Not yet begun"}</p>
                <p className="muted small">{c.characterNames.join(", ") || "No heroes yet"}</p>
              </div>
              <div className="row">
                {mine
                  ? <button className="btn btn-primary" onClick={() => go(`/c/${c.id}`)}>Continue</button>
                  : <button className="btn btn-primary" onClick={() => go(`/c/${c.id}/join`)}>Join</button>}
                {mine && <button className="btn btn-ghost" onClick={() => go(`/c/${c.id}/join`)}>Switch hero</button>}
              </div>
            </article>
          );
        })}
      </div>
      <footer className="row spread" style={{ marginTop: "3rem" }}>
        <p className="muted small" style={{ flex: 1, margin: 0 }}>{packNote ?? "Done for the evening? Free up the computer's memory."}</p>
        <button className="btn btn-ghost" onClick={packUp} disabled={packing}>{packing ? "Packing up…" : "🕯 Pack up for the night"}</button>
      </footer>
    </main>
  );
}
