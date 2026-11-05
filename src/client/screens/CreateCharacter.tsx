import { useEffect, useState } from "react";
import { baseScores, formatModifier, maxHpFor, modifier, pointBuyCost, POINT_BUY_BUDGET } from "../../shared/abilities";
import { ABILITIES, type Ability, type KitItem, type Scores, type Snapshot } from "../../shared/types";
import { FeedbackPanel } from "../components/FeedbackPanel";
import { api } from "../lib/api";
import { useFeedbackEnabled } from "../lib/feedback";
import { go } from "../lib/router";
import { setMyCharacter } from "../lib/storage";

export function CreateCharacter({ campaignId }: { campaignId: number }) {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [name, setName] = useState("");
  const [concept, setConcept] = useState("");
  const [scores, setScores] = useState<Scores>(baseScores());
  const [kit, setKit] = useState<KitItem[] | null>(null);
  const [kitBusy, setKitBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const feedbackEnabled = useFeedbackEnabled();

  useEffect(() => { api.snapshot(campaignId).then((r) => setSnap(r.snapshot)).catch((e) => setError(e.message)); }, [campaignId]);

  const left = POINT_BUY_BUDGET - (pointBuyCost(scores) ?? 0);
  const stepped = (a: Ability, d: 1 | -1): Scores | null => {
    const next = { ...scores, [a]: scores[a] + d };
    const cost = pointBuyCost(next);
    return cost === null || cost > POINT_BUY_BUDGET ? null : next;
  };
  const named = name.trim() !== "" && concept.trim() !== "";
  const soloTaken = snap?.campaign.mode === "solo" && snap.characters.length > 0;

  function playAs(characterId: number) {
    setMyCharacter(campaignId, characterId);
    go(`/c/${campaignId}`);
  }

  async function suggestKit() {
    setKitBusy(true);
    setError(null);
    try {
      setKit((await api.kit({ campaignId, name: name.trim(), concept: concept.trim() })).items);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setKitBusy(false);
    }
  }

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const { character } = await api.createCharacter(campaignId, { name: name.trim(), concept: concept.trim(), scores, items: kit ?? [] });
      playAs(character.id);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="page stack">
      <div className="row spread">
        <a href="#/">← Back to the tavern</a>
        {feedbackEnabled && <button className="btn btn-ghost" onClick={() => setFeedbackOpen(true)}>Feedback</button>}
      </div>
      <p className="eyebrow">{snap?.campaign.title ?? "…"}</p>

      {snap && snap.characters.length > 0 && (
        <section className="panel stack">
          <h3>Play as an existing hero</h3>
          <div className="row">
            {snap.characters.map((c) => (
              <button key={c.id} className="btn" onClick={() => playAs(c.id)}>{c.name} <span className="muted">· {c.concept}</span></button>
            ))}
          </div>
        </section>
      )}

      {snap && !soloTaken && (
        <section className="panel stack">
          <h2>Create a hero</h2>
          <label className="stack"><span>Name</span>
            <input className="input" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="stack"><span>Concept</span>
            <input className="input" maxLength={120} value={concept} placeholder="e.g. disgraced knight seeking redemption" onChange={(e) => setConcept(e.target.value)} />
          </label>

          <div className="stack">
            <div className="row spread">
              <h3 style={{ margin: 0 }}>Abilities</h3>
              <span className={left === 0 ? "muted" : "gold"}>{left} of {POINT_BUY_BUDGET} points left</span>
            </div>
            <div className="pointbuy">
              {ABILITIES.map((a) => (
                <div key={a} className="ability">
                  {a}<b>{scores[a]}</b><small>{formatModifier(modifier(scores[a]))}</small>
                  <div className="row stepper">
                    <button className="btn btn-ghost" aria-label={`Lower ${a}`} disabled={!stepped(a, -1)} onClick={() => setScores(stepped(a, -1)!)}>−</button>
                    <button className="btn btn-ghost" aria-label={`Raise ${a}`} disabled={!stepped(a, 1)} onClick={() => setScores(stepped(a, 1)!)}>+</button>
                  </div>
                </div>
              ))}
            </div>
            <p className="muted small" style={{ margin: 0 }}>Max HP {maxHpFor(scores.CON, 1)} (from CON). Scores range 8–15 at creation.</p>
          </div>

          <div className="stack">
            <div className="row spread">
              <h3 style={{ margin: 0 }}>Starting kit</h3>
              <button className="btn" disabled={!named || kitBusy} onClick={suggestKit}>{kitBusy ? "Packing…" : kit ? "Suggest another" : "Suggest a kit"}</button>
            </div>
            {!kit && <p className="muted small" style={{ margin: 0 }}>Name your hero and describe them, then let the Dungeon Master pack their bag.</p>}
            {kit && <ul className="inventory">{kit.map((i) => <li key={i.name}><b>{i.name}</b>: <span className="muted">{i.description}</span></li>)}</ul>}
          </div>

          {error && <p className="error">{error}</p>}
          <button className="btn btn-primary" disabled={!named || busy} onClick={create}>{busy ? "Creating…" : "Begin as this hero"}</button>
        </section>
      )}
      {!snap && error && <p className="error">{error}</p>}
      {feedbackOpen && <FeedbackPanel screen="create-character" campaignId={campaignId} onClose={() => setFeedbackOpen(false)} />}
    </main>
  );
}
