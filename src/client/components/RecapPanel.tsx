import { useCallback, useEffect, useState } from "react";
import { api, type Recap } from "../lib/api";
import { recapParagraphs } from "../lib/recap";

type State =
  | { kind: "loading" }
  | ({ kind: "ready" } & Recap)
  | ({ kind: "editing"; draft: string; saving: boolean; error?: string } & Recap)
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

  async function save() {
    if (state.kind !== "editing") return;
    setState({ ...state, saving: true, error: undefined });
    try {
      setState({ kind: "ready", ...(await api.editSummary(campaignId, state.draft)) });
    } catch (e) {
      setState({ ...state, saving: false, error: (e as Error).message });
    }
  }

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
          <div className="row">
            {(state.kind === "ready" || state.kind === "loading") && (
              <button className="btn btn-ghost" disabled={state.kind === "loading"} title={state.kind === "loading" ? "Ready once the Dungeon Master has remembered the story" : undefined}
                onClick={() => state.kind === "ready" && setState({ ...state, kind: "editing", draft: state.summary, saving: false })}>Edit</button>
            )}
            <button className="btn btn-ghost" onClick={onClose}>Close</button>
          </div>
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
            : <p className="muted">Nothing has happened yet. Play a round first, or press Edit to write how your story begins.</p>)}
        </div>
        {state.kind === "editing" && (
          <form className="stack" onSubmit={(e) => { e.preventDefault(); save(); }}>
            <p className="muted small" style={{ margin: 0 }}>
              Rewrite it however you like. The Dungeon Master will follow your version from now on.
            </p>
            <textarea className="input recap-editor" rows={12} maxLength={4000} value={state.draft} autoFocus aria-label="The story so far"
              onChange={(e) => setState({ ...state, draft: e.target.value })} />
            {state.error && <p className="error">{state.error}</p>}
            <div className="row">
              <button className="btn btn-primary" type="submit" disabled={state.saving || !state.draft.trim()}>{state.saving ? "Saving…" : "Save"}</button>
              <button className="btn btn-ghost" type="button" onClick={() => setState({ ...state, kind: "ready" })}>Cancel</button>
              <span className="muted small">{state.draft.length}/4000</span>
            </div>
          </form>
        )}
        {state.kind === "ready" && state.summary.trim() && (
          <p className="muted small" style={{ margin: 0 }}>
            {state.editedThrough === null ? `Up to round ${state.throughRound}`
              : state.editedThrough < 0 ? "Written by you before the story began"
                : state.editedThrough === 0 ? "Edited by you after the opening scene" : `Edited by you after round ${state.editedThrough}`}
          </p>
        )}
      </section>
    </div>
  );
}
