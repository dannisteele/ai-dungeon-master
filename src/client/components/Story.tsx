import { formatModifier } from "../../shared/abilities";
import type { StoryEntry } from "../lib/story";

export function Story({ entries, streaming }: { entries: StoryEntry[]; streaming: string }) {
  return (
    <>
      {entries.map((e) => {
        switch (e.kind) {
          case "narration": return <p key={e.id} className="narration">{e.text}</p>;
          case "action": return <p key={e.id} className="action-line"><b>{e.name}</b> {e.text}</p>;
          case "skip": return <p key={e.id} className="action-line">{e.text}</p>;
          case "sheet": return <span key={e.id} className="sheet-chip">{e.text}</span>;
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
