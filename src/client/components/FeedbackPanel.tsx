import { useEffect, useState, type FormEvent } from "react";
import { api, type FeedbackRequest } from "../lib/api";

type Kind = FeedbackRequest["kind"];
type State = { kind: "editing"; error?: string } | { kind: "sending" } | { kind: "sent" };

export function FeedbackPanel({ screen, campaignId, characterId, onClose }: {
  screen: string; campaignId?: number; characterId?: number | null; onClose: () => void;
}) {
  const [kind, setKind] = useState<Kind>("bug");
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [state, setState] = useState<State>({ kind: "editing" });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) { setState({ kind: "editing", error: "Give it a short title." }); return; }
    setState({ kind: "sending" });
    try {
      await api.sendFeedback({ kind, title, details, screen, campaignId, characterId: characterId ?? undefined });
      setState({ kind: "sent" });
    } catch (err) {
      setState({ kind: "editing", error: (err as Error).message });
    }
  }

  return (
    <div className="recap-backdrop" onClick={onClose}>
      <section className="recap-panel" role="dialog" aria-modal="true" aria-labelledby="feedback-title" onClick={(e) => e.stopPropagation()}>
        <header className="row spread">
          <h2 id="feedback-title" style={{ margin: 0 }}>Send feedback</h2>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </header>
        {state.kind === "sent"
          ? (
            <div className="stack">
              <p className="narration">Thanks, sent! It's on the list.</p>
              <button className="btn btn-primary" onClick={onClose}>Back to the game</button>
            </div>
          )
          : (
            <form className="stack recap-body" onSubmit={submit}>
              <div className="row" role="radiogroup" aria-label="What kind of feedback">
                <button type="button" role="radio" aria-checked={kind === "bug"} className={kind === "bug" ? "btn btn-primary" : "btn btn-ghost"} onClick={() => setKind("bug")}>Something's wrong</button>
                <button type="button" role="radio" aria-checked={kind === "idea"} className={kind === "idea" ? "btn btn-primary" : "btn btn-ghost"} onClick={() => setKind("idea")}>I've got an idea</button>
              </div>
              <label className="stack field">
                <span>{kind === "bug" ? "What went wrong, in a few words" : "Your idea, in a few words"}</span>
                <input className="input" maxLength={100} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
              </label>
              <label className="stack field">
                <span>{kind === "bug" ? "Tell me more: what did you do, and what happened?" : "Tell me more"}</span>
                <textarea className="input" rows={5} maxLength={4000} value={details} onChange={(e) => setDetails(e.target.value)} />
              </label>
              {kind === "bug" && campaignId !== undefined && <p className="muted small" style={{ margin: 0 }}>The last few moments of the story are sent along too, to help track it down.</p>}
              {state.kind === "editing" && state.error && <p className="error">{state.error}</p>}
              <div className="row">
                <button className="btn btn-primary" type="submit" disabled={state.kind === "sending"}>{state.kind === "sending" ? "Sending…" : "Send"}</button>
              </div>
            </form>
          )}
      </section>
    </div>
  );
}
