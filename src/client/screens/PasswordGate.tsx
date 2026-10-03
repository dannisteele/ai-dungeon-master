import { useState, type FormEvent } from "react";
import { api } from "../lib/api";

export function PasswordGate({ onUnlocked }: { onUnlocked: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(password);
      onUnlocked();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page gate">
      <form className="panel stack" onSubmit={submit}>
        <p className="eyebrow">A table for adventurers</p>
        <h1>Speak, friend, and enter</h1>
        <input className="input" type="password" autoFocus autoComplete="current-password" aria-label="Table password"
          placeholder="Table password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {error && <p className="error">{error}</p>}
        <button className="btn btn-primary" disabled={busy || !password}>{busy ? "Opening…" : "Enter"}</button>
      </form>
    </main>
  );
}
