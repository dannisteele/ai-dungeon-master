import { useState } from "react";
import { formatModifier, modifier } from "../../shared/abilities";
import { ABILITIES, type Ability, type Character, type Snapshot } from "../../shared/types";
import { api } from "../lib/api";
import { newItemNames } from "../lib/story";

interface Props { snapshot: Snapshot; me: Character | null; open: boolean; onClose: () => void }

const pct = (c: Character) => `${Math.max(0, Math.min(100, (c.hp / c.maxHp) * 100))}%`;

export function CharacterSheet({ snapshot, me, open, onClose }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const others = snapshot.characters.filter((c) => c.id !== me?.id);
  const fresh = me ? newItemNames(snapshot.events, me.name, snapshot.campaign.roundNumber) : new Set<string>();
  const rejected = snapshot.events.filter((e): e is Extract<typeof e, { type: "op_rejected" }> => e.type === "op_rejected").slice(-10);

  async function spend(a: Ability) {
    if (!me) return;
    setBusy(true);
    setError(null);
    try { await api.spendPoint(me.id, a); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  return (
    <aside className={`sheet ${open ? "open" : ""}`} aria-label="Character sheet">
      <div className="row spread"><span /><button className="btn btn-ghost sheet-toggle" onClick={onClose}>Close</button></div>
      {me ? (
        <section className="stack">
          <div>
            <h2>{me.name}</h2>
            <p className="muted" style={{ margin: 0 }}><i>{me.concept}</i> · Level {me.level}</p>
          </div>
          <div>
            <div className="row spread small"><span>HP</span><span>{me.hp} / {me.maxHp}{me.hp <= 0 && <b className="fail"> · DOWN</b>}</span></div>
            <div className="hp-bar"><div style={{ width: pct(me) }} /></div>
          </div>
          {me.pendingAbilityPoints > 0 && <p className="gold" style={{ margin: 0 }}>Level up! Tap an ability to spend {me.pendingAbilityPoints} point{me.pendingAbilityPoints > 1 ? "s" : ""}.</p>}
          <div className="abilities">
            {ABILITIES.map((a) => {
              const canSpend = me.pendingAbilityPoints > 0 && me.scores[a] < 20;
              return (
                <button key={a} className="ability" data-spendable={canSpend} disabled={!canSpend || busy} onClick={() => spend(a)}>
                  {a}<b>{me.scores[a]}</b><small>{formatModifier(modifier(me.scores[a]))}</small>
                </button>
              );
            })}
          </div>
          {error && <p className="error">{error}</p>}
          <div>
            <h3>Pack</h3>
            <ul className="inventory">
              {me.items.length === 0 && <li className="muted">Empty</li>}
              {me.items.map((i) => {
                const isNew = fresh.has(i.name.toLowerCase());
                return (
                  <li key={i.name} className={isNew ? "item-new" : ""}>
                    {i.name}{i.qty > 1 && ` ×${i.qty}`}{isNew && <span className="badge-new">✦ new</span>}
                    {i.description && <div className="muted small">{i.description}</div>}
                  </li>
                );
              })}
            </ul>
          </div>
        </section>
      ) : <p className="muted">Pick a hero to see your sheet.</p>}
      {others.length > 0 && (
        <section style={{ marginTop: "1.5rem" }}>
          <h3>Party</h3>
          {others.map((c) => (
            <div key={c.id} className="party-card">
              <div className="row spread small"><b>{c.name}</b><span className="muted">HP {c.hp}/{c.maxHp}</span></div>
              <div className="hp-bar thin"><div style={{ width: pct(c) }} /></div>
            </div>
          ))}
        </section>
      )}
      {rejected.length > 0 && (
        <details style={{ marginTop: "1.5rem" }}>
          <summary className="muted small">DM notes ({rejected.length})</summary>
          <ul className="inventory small">
            {rejected.map((e) => (
              <li key={e.id} className="muted">Round {e.round}: ignored <code>{JSON.stringify(e.op)}</code> ({e.reason})</li>
            ))}
          </ul>
        </details>
      )}
    </aside>
  );
}
