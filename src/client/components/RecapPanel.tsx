import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { recapParagraphs } from "../lib/recap";

type State =
  | { kind: "loading" }
  | { kind: "ready"; summary: string; throughRound: number }
  | { kind: "error"; message: string };

export function RecapPanel({ campaignId, onClose }: { campaignId: number; onClose: () => void }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  const load = useCallback(() => {
    setState({ kind: "loading" });
    api.recap(campaignId)
      .then((r) => setState({ kind: "ready", ...r }))
      .catch((e: Error) => setState({ kind: "error", message: e.message }));
  }, [campaignId]);

  useEffect(load, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="recap-backdrop" onClick={onClose}>
      <section className="recap-panel" role="dialog" aria-modal="true" aria-labelledby="recap-title" onClick={(e) => e.stopPropagation()}>
        <header className="row spread">
          <h2 id="recap-title" style={{ margin: 0 }}>The story so far</h2>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </header>
        <div className="recap-body">
          {state.kind === "loading" && <p className="thinking">The Dungeon Master is remembering…</p>}
          {state.kind === "error" && (
            <div className="stack">
              <p className="error">{state.message}</p>
              <button className="btn btn-primary" onClick={load}>Try again</button>
            </div>
          )}
          {state.kind === "ready" && (state.summary.trim()
            ? (
              <>
                {recapParagraphs(state.summary).map((p, i) => <p key={i} className="narration">{p}</p>)}
              </>
            )
            : <p className="muted">Nothing has happened yet. Play a round first.</p>)}
        </div>
        {state.kind === "ready" && state.summary.trim() && <p className="muted small" style={{ margin: 0 }}>Up to round {state.throughRound}</p>}
      </section>
    </div>
  );
}
