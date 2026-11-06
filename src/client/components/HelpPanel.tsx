import { useEffect, useRef, useState } from "react";
import { api, type HelpTurn } from "../lib/api";
import { inline, manualBlocks } from "../lib/manual";

const STARTERS = [
  "How do I turn off the dice?",
  "How do I fix a reply the DM got wrong?",
  "How do I get the latest version?",
];

const Text = ({ text }: { text: string }) => <>{inline(text).map((s, i) => s.bold ? <b key={i}>{s.text}</b> : <span key={i}>{s.text}</span>)}</>;

/** Questions about the game, answered by the DM's model from the manual, and the manual itself. */
export function HelpPanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"ask" | "manual">("ask");
  const [manual, setManual] = useState<string | null>(null);
  const [turns, setTurns] = useState<HelpTurn[]>([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    api.manual().then((r) => setManual(r.manual), (e: Error) => setError(e.message));
  }, []);

  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [turns, asking]);

  async function ask(q: string) {
    const text = q.trim();
    if (!text || asking) return;
    setAsking(true);
    setError(null);
    setQuestion("");
    const history = turns;
    setTurns([...history, { role: "user", content: text }]);
    try {
      const { answer } = await api.help(text, history);
      setTurns((t) => [...t, { role: "assistant", content: answer }]);
    } catch (e) {
      setError((e as Error).message);
      setTurns(history);
      setQuestion(text);
    } finally {
      setAsking(false);
    }
  }

  return (
    <div className="recap-backdrop" onClick={onClose}>
      <section className="recap-panel" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={(e) => e.stopPropagation()}>
        <header className="row spread">
          <h2 id="help-title" style={{ margin: 0 }}>Help</h2>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </header>
        <div className="row" role="tablist">
          <button className="btn btn-ghost" role="tab" aria-selected={tab === "ask"} aria-pressed={tab === "ask"} onClick={() => setTab("ask")}>Ask a question</button>
          <button className="btn btn-ghost" role="tab" aria-selected={tab === "manual"} aria-pressed={tab === "manual"} onClick={() => setTab("manual")}>Read the manual</button>
        </div>
        {tab === "ask"
          ? (
            <div className="stack recap-body">
              {turns.length === 0 && (
                <>
                  <p className="muted" style={{ margin: 0 }}>Ask anything about how to play. The Dungeon Master answers from the manual.</p>
                  <div className="stack help-starters">
                    {STARTERS.map((s) => <button key={s} className="link-btn" disabled={asking} onClick={() => void ask(s)}>{s}</button>)}
                  </div>
                </>
              )}
              {turns.map((t, i) => (
                <p key={i} className={t.role === "user" ? "help-q" : "help-a"} style={{ margin: t.role === "user" && i > 0 ? ".6rem 0 0" : 0 }}><Text text={t.content} /></p>
              ))}
              {asking && <p className="thinking" style={{ margin: 0 }}>Thinking… This can take a minute, and waits if the Dungeon Master is writing.</p>}
              {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
              <div ref={end} />
              <form className="stack" onSubmit={(e) => { e.preventDefault(); void ask(question); }}>
                <textarea className="input" rows={2} maxLength={500} value={question} placeholder="How do I…?" aria-label="Your question"
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(question); } }} />
                <div className="row"><button className="btn btn-primary" type="submit" disabled={asking || !question.trim()}>Ask</button></div>
              </form>
            </div>
          )
          : (
            <div className="stack recap-body manual">
              {manual === null && !error && <p className="muted">Opening the manual…</p>}
              {manual && manualBlocks(manual).map((b, i) => {
                switch (b.kind) {
                  case "h1": return null;
                  case "h2": return <h3 key={i} style={{ margin: i > 1 ? ".8rem 0 0" : 0 }}>{b.text}</h3>;
                  case "p": return <p key={i} style={{ margin: 0 }}><Text text={b.text} /></p>;
                  case "list": return <ul key={i}>{b.items.map((it, j) => <li key={j}><Text text={it} /></li>)}</ul>;
                }
              })}
            </div>
          )}
      </section>
    </div>
  );
}
