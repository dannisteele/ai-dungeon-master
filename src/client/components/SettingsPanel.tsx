import { useEffect, useState } from "react";
import type { Campaign, DiceMode, Realism } from "../../shared/types";
import { api } from "../lib/api";

const DICE: [DiceMode, string, string][] = [
  ["normal", "Every risky moment", "The DM asks for a roll whenever things are uncertain."],
  ["big", "Only big moments", "Rolls only at turning points: confrontations, big gambles, real danger."],
  ["off", "Off (story mode)", "No dice. The DM decides what happens, fairly; things can still go wrong."],
];
const REALISM: [Realism, string, string][] = [
  ["grounded", "Grounded", "Real life: no magic or anything impossible."],
  ["fantastical", "Fantastical", "Magic and the impossible are allowed."],
];

/** Per-campaign table settings: dice and realism. Changes apply from the DM's next turn. */
export function SettingsPanel({ campaign, onClose }: { campaign: Campaign; onClose: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function save(patch: { dice?: DiceMode; realism?: Realism }) {
    setSaving(true);
    setError(null);
    try {
      await api.updateSettings(campaign.id, patch); // the snapshot broadcast updates `campaign`
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  const group = <T extends string>(label: string, options: [T, string, string][], value: T, pick: (v: T) => void) => (
    <section className="stack">
      <h3 style={{ margin: 0 }}>{label}</h3>
      <div className="stack setting-options" role="radiogroup" aria-label={label}>
        {options.map(([v, name, hint]) => (
          <button key={v} className="panel card-choice setting-choice" role="radio" aria-checked={value === v} aria-pressed={value === v}
            disabled={saving} onClick={() => value !== v && pick(v)}>
            <b>{name}</b><span className="muted small">{hint}</span>
          </button>
        ))}
      </div>
    </section>
  );

  return (
    <div className="recap-backdrop" onClick={onClose}>
      <section className="recap-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title" onClick={(e) => e.stopPropagation()}>
        <header className="row spread">
          <h2 id="settings-title" style={{ margin: 0 }}>Table settings</h2>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </header>
        <div className="stack recap-body">
          {group("Dice", DICE, campaign.dice, (dice) => save({ dice }))}
          {group("Story", REALISM, campaign.realism, (realism) => save({ realism }))}
          {error && <p className="error">{error}</p>}
          <p className="muted small" style={{ margin: 0 }}>Changes apply from the Dungeon Master's next turn.</p>
        </div>
      </section>
    </div>
  );
}
