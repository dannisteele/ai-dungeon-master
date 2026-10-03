import { useEffect, useState } from "react";
import { formatModifier } from "../../shared/abilities";
import type { StoredRoll } from "../../shared/types";
import { DICE_TIMEOUT_MS, getDiceBox, wait, withTimeout } from "../lib/dice";

const D20_SVG = (
  <svg viewBox="0 0 100 100" className="fallback-die" aria-hidden>
    <polygon points="50,4 93,27 93,73 50,96 7,73 7,27" fill="#5a3a1c" stroke="#ffd27a" strokeWidth="3" />
    <polygon points="50,20 78,66 22,66" fill="none" stroke="#e0a84a" strokeWidth="2" />
  </svg>
);

export function DiceOverlay({ roll, name, onDone }: { roll: StoredRoll; name: string; onDone: () => void }) {
  const [phase, setPhase] = useState<"rolling" | "result">("rolling");
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    const stage = document.getElementById("dice-stage");
    // The 3D box can only land on a face it actually has: swapDiceFace() silently
    // no-ops for anything outside 1-20 (or non-integers), which would show a random
    // face that contradicts the server. Go straight to the fallback for those.
    const canUse3d = Number.isInteger(roll.die) && roll.die >= 1 && roll.die <= 20;
    (async () => {
      const box = canUse3d ? await getDiceBox() : null;
      if (cancelled) return;
      if (box) {
        stage?.classList.add("active");
        try {
          await withTimeout(box.roll(`1d20@${roll.die}`), DICE_TIMEOUT_MS);
        } catch (e) {
          console.warn("Dice roll animation failed:", e);
          setFallback(true);
          await wait(1200);
        }
      } else {
        setFallback(true);
        await wait(matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 1200);
      }
      if (cancelled) return;
      setPhase("result");
      timer = window.setTimeout(() => {
        stage?.classList.remove("active");
        box?.clearDice?.();
        onDone();
      }, 2600);
    })();
    return () => { cancelled = true; clearTimeout(timer); stage?.classList.remove("active"); };
  }, [roll.id]);

  const verdict = roll.crit === "nat20" ? "Natural 20!" : roll.crit === "nat1" ? "Natural 1…" : roll.success ? "Success" : "Failure";
  return (
    <div className={`dice-overlay ${phase}`} role="status" aria-live="polite">
      {fallback && phase === "rolling" && D20_SVG}
      {phase === "result" && (
        <div className={`dice-result ${roll.crit ?? ""}`}>
          <div className="dice-name">{name} · {roll.ability} check</div>
          <div className="dice-total">
            <span className="die">{roll.die}</span> {formatModifier(roll.modifier)} = <b>{roll.total}</b> <span className="muted">vs DC {roll.dc}</span>
          </div>
          <div className={roll.success ? "ok" : "fail"}>{verdict}</div>
        </div>
      )}
    </div>
  );
}
