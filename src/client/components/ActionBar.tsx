import { useEffect, useState, type ReactNode } from "react";
import type { Character, ClientMsg, Snapshot } from "../../shared/types";
import { canSkipAlone } from "../lib/round";
import { appendAction } from "../lib/npcs";
import { nameOf } from "../lib/story";
import { NearbyStrip } from "./NearbyStrip";

interface Props { snapshot: Snapshot; me: Character | null; campaignId: number; error: string | null; send: (m: ClientMsg) => void }

export function ActionBar({ snapshot, me, campaignId, error, send }: Props) {
  const { campaign, characters, round, activeIds } = snapshot;
  const [text, setText] = useState("");
  useEffect(() => setText(""), [campaign.roundNumber]);
  const [reviveSent, setReviveSent] = useState(false);
  useEffect(() => setReviveSent(false), [campaign.roundState]);

  const name = (id: number) => nameOf(characters, id);
  const responded = (id: number) => round.actions.some((a) => a.characterId === id) || round.skippedIds.includes(id);
  const readyLine = (
    <p className="ready">
      {activeIds.map((id) => <span key={id} className={responded(id) ? "done" : ""}>{name(id)} {responded(id) ? "✓" : "…"}</span>)}
    </p>
  );
  const canAct = !!me && campaign.roundState === "collecting" && activeIds.includes(me.id) && !responded(me.id);
  const fallenPanel = (
    <div className="stack">
      <p className="fallen-title">The party has fallen</p>
      <div className="row">
        <button className="btn btn-primary" disabled={reviveSent} onClick={() => { setReviveSent(true); send({ t: "revive" }); }}>Revive</button>
        <a className="btn btn-ghost" href="#/new">Start a new campaign</a>
      </div>
    </div>
  );

  let body: ReactNode;
  if (campaign.roundState === "fallen") {
    body = fallenPanel;
  } else if (!me) {
    body = <p style={{ margin: 0 }}>You're watching. <a href={`#/c/${campaignId}/join`}>Join with a hero</a> to play.</p>;
  } else {
    switch (campaign.roundState) {
      case "lobby":
        body = (
          <div className="row">
            <p className="muted" style={{ flex: 1, margin: 0 }}>At the table: {characters.map((c) => c.name).join(", ")}. Begin when everyone has joined.</p>
            <button className="btn btn-primary" onClick={() => send({ t: "begin" })}>Begin the adventure</button>
          </div>
        );
        break;
      case "opening":
      case "adjudicating":
      case "resolving":
      case "reviving":
        body = <p className="thinking">The Dungeon Master is weaving the tale…</p>;
        break;
      case "stalled":
        body = (
          <div className="row">
            <p className="thinking" style={{ flex: 1 }}>The Dungeon Master pauses, lost in thought…</p>
            <button className="btn btn-primary" onClick={() => send({ t: "retry" })}>Try again</button>
          </div>
        );
        break;
      case "awaiting_rolls":
        body = (
          <div className="stack">
            {round.checks.map((ch) => (
              <div key={ch.characterId} className="row">
                <span style={{ flex: 1 }}>
                  <b className="gold">{name(ch.characterId)}</b>: {ch.ability} check, DC {ch.dc} <span className="muted">({ch.reason})</span>
                </span>
                {ch.roll
                  ? <span className={ch.roll.success ? "ok" : "fail"}>{ch.roll.total} {ch.roll.success ? "✓" : "✗"}</span>
                  : ch.characterId === me.id
                    ? <button className="btn btn-primary roll-btn" onClick={() => send({ t: "roll", characterId: ch.characterId })}>Roll d20</button>
                    : <button className="btn btn-ghost" onClick={() => send({ t: "roll", characterId: ch.characterId })}>Roll for {name(ch.characterId)}</button>}
              </div>
            ))}
          </div>
        );
        break;
      case "collecting": {
        const meActive = activeIds.includes(me.id);
        const waitingOn = activeIds.filter((id) => id !== me.id && !responded(id) && canSkipAlone(activeIds, round.skippedIds, id));
        const canGoAhead = canSkipAlone(activeIds, round.skippedIds, me.id);
        if (!meActive) {
          body = <div className="stack">{readyLine}<p className="muted" style={{ margin: 0 }}>{me.name} is down and can't act until healed.</p></div>;
        } else if (!responded(me.id)) {
          body = (
            <form className="stack" onSubmit={(e) => { e.preventDefault(); if (text.trim()) send({ t: "action", characterId: me.id, text }); }}>
              {campaign.mode === "party" && readyLine}
              <textarea className="input" rows={2} maxLength={1000} value={text} placeholder={`What does ${me.name} do?`}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} />
              <div className="row">
                <button className="btn btn-primary" disabled={!text.trim()}>Act</button>
                {canGoAhead && <button type="button" className="btn btn-ghost" onClick={() => send({ t: "skip", characterId: me.id, by: me.id })}>Go ahead without me</button>}
              </div>
            </form>
          );
        } else {
          body = (
            <div className="stack">
              {readyLine}
              <div className="row">
                {waitingOn.map((id) => (
                  <button key={id} className="btn btn-ghost" onClick={() => send({ t: "skip", characterId: id, by: me.id })}>Don't wait for {name(id)}</button>
                ))}
              </div>
            </div>
          );
        }
        break;
      }
    }
  }
  return (
    <div className="action-bar">
      <NearbyStrip npcs={snapshot.npcs} canAct={canAct} onPick={(s) => setText((t) => appendAction(t, s))} />
      {body}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
