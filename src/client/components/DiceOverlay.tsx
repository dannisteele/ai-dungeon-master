// Stub, replaced in Task 14.
import { useEffect } from "react";
import type { StoredRoll } from "../../shared/types";

export function DiceOverlay({ roll, name, onDone }: { roll: StoredRoll; name: string; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(onDone, 1500); return () => clearTimeout(t); }, [roll.id]);
  return <div className="dice-overlay"><div className="dice-result"><div className="dice-name">{name}</div><div className="dice-total">{roll.total}</div></div></div>;
}
