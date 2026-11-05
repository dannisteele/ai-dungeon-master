import { useEffect, useState } from "react";
import { api, type ModelChoice } from "../lib/api";

/** Which Ollama model plays the Dungeon Master. Hidden if Ollama can't be reached. */
export function ModelPicker() {
  const [models, setModels] = useState<ModelChoice[] | null>(null);
  const [current, setCurrent] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.models().then((r) => { setModels(r.models); setCurrent(r.current); }).catch(() => setModels(null));
  }, []);

  async function choose(model: string) {
    setSaving(true);
    setNote(null);
    try {
      setCurrent((await api.setModel(model)).current);
      setNote("Switched. The next turn will take a little longer while it loads.");
    } catch (e) {
      setNote((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!models || models.length < 2) return null;
  return (
    <div className="stack">
      <label className="stack field">
        <span>Dungeon Master's brain</span>
        <select className="input" value={current} disabled={saving} onChange={(e) => choose(e.target.value)}>
          {models.map((m) => <option key={m.name} value={m.name} disabled={!m.installed}>{m.label}{m.installed ? "" : " (not downloaded)"}</option>)}
        </select>
      </label>
      {note && <p className="muted small" style={{ margin: 0 }}>{note}</p>}
    </div>
  );
}
