import { useEffect, useState } from "react";
import type { AdventureInfo, CampaignSource, Mode, Preset, Realism } from "../../shared/types";
import { api } from "../lib/api";
import { go } from "../lib/router";

type Kind = CampaignSource["kind"];
const KINDS: [Kind, string][] = [["preset", "Choose a setting"], ["pitch", "Write your own"], ["adventure", "Prepared adventure"]];

export function NewCampaign() {
  const [mode, setMode] = useState<Mode>("party");
  const [kind, setKind] = useState<Kind>("preset");
  const [presetId, setPresetId] = useState("");
  const [adventureId, setAdventureId] = useState("");
  const [pitch, setPitch] = useState("");
  const [realism, setRealism] = useState<Realism>("grounded");
  const [title, setTitle] = useState("");
  const [data, setData] = useState<{ presets: Preset[]; adventures: AdventureInfo[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.presets().then((d) => {
      setData(d);
      setPresetId(d.presets[0]?.id ?? "");
      setAdventureId(d.adventures[0]?.id ?? "");
    }).catch((e) => setError(e.message));
  }, []);

  const source: CampaignSource = kind === "preset" ? { kind, presetId } : kind === "adventure" ? { kind, adventureId } : { kind, pitch, realism };
  const ready = kind === "pitch" ? pitch.trim().length >= 10 : kind === "preset" ? !!presetId : !!adventureId;

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const { campaign } = await api.createCampaign({ mode, title: title.trim() || undefined, source });
      go(`/c/${campaign.id}/join`);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="page stack">
      <a href="#/">← Back to the tavern</a>
      <h1>A new tale</h1>

      <section className="stack">
        <h3>Who's playing?</h3>
        <div className="row">
          <button className="btn" aria-pressed={mode === "party"} onClick={() => setMode("party")}>Party: play together</button>
          <button className="btn" aria-pressed={mode === "solo"} onClick={() => setMode("solo")}>Solo</button>
        </div>
      </section>

      <section className="stack">
        <h3>Where does it begin?</h3>
        <div className="row">
          {KINDS.map(([k, label]) => (
            <button key={k} className="btn btn-ghost" aria-pressed={kind === k} onClick={() => setKind(k)}>{label}</button>
          ))}
        </div>
        {kind === "preset" && (
          <div className="grid-cards">
            {data?.presets.map((p) => (
              <button key={p.id} className="panel card-choice" aria-pressed={presetId === p.id} onClick={() => setPresetId(p.id)}>
                <h3>{p.name}</h3><p className="muted">{p.blurb}</p>
              </button>
            ))}
          </div>
        )}
        {kind === "pitch" && (
          <>
            <textarea className="input" rows={4} maxLength={1000} value={pitch} onChange={(e) => setPitch(e.target.value)}
              placeholder="e.g. Two smugglers wake on a ghost ship drifting toward a city that vanished a hundred years ago." />
            <div className="row" role="radiogroup" aria-label="Kind of story">
              <button className="btn" role="radio" aria-checked={realism === "grounded"} aria-pressed={realism === "grounded"} onClick={() => setRealism("grounded")}>
                Grounded: real life, no magic
              </button>
              <button className="btn" role="radio" aria-checked={realism === "fantastical"} aria-pressed={realism === "fantastical"} onClick={() => setRealism("fantastical")}>
                Fantastical: magic and the impossible allowed
              </button>
            </div>
          </>
        )}
        {kind === "adventure" && (
          <div className="grid-cards">
            {data?.adventures.map((a) => (
              <button key={a.id} className="panel card-choice" aria-pressed={adventureId === a.id} onClick={() => setAdventureId(a.id)}>
                <h3>{a.title}</h3><p className="muted">{a.pitch}</p>
              </button>
            ))}
          </div>
        )}
      </section>

      <label className="stack">
        <span>Title (optional)</span>
        <input className="input" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} />
      </label>

      {error && <p className="error">{error}</p>}
      <button className="btn btn-primary" disabled={!ready || busy} onClick={create}>{busy ? "Preparing…" : "Create campaign"}</button>
    </main>
  );
}
