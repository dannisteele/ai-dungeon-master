import { useEffect, useRef, useState } from "react";
import type { Npc } from "../../shared/types";
import { quickActionText, type QuickAction } from "../lib/npcs";

const ACTIONS: [QuickAction, string][] = [["attack", "⚔ Attack"], ["talk", "💬 Talk to"], ["watch", "👁 Watch"]];

export function NearbyStrip({ npcs, canAct, onPick }: { npcs: Npc[]; canAct: boolean; onPick: (sentence: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [menuLeft, setMenuLeft] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const chipRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(null); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(null); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  useEffect(() => { if (!canAct) setOpen(null); }, [canAct]);

  // The menu lives outside the horizontally-scrolling strip (see theme.css note), so its
  // position is computed from the chip's layout offset minus how far the strip has scrolled.
  const toggle = (name: string) => {
    if (open === name) { setOpen(null); return; }
    const chip = chipRefs.current[name];
    const scroller = scrollerRef.current;
    if (chip && scroller) setMenuLeft(chip.offsetLeft - scroller.scrollLeft);
    setOpen(name);
  };

  if (npcs.length === 0) return null;
  return (
    <div className="nearby" ref={ref}>
      <span className="nearby-label">Nearby</span>
      <div className="nearby-chips" ref={scrollerRef} onScroll={() => setOpen(null)}>
        {npcs.map((n) => (
          <div key={n.name} className="npc-wrap" ref={(el) => { chipRefs.current[n.name] = el; }}>
            <button type="button" className={`npc-chip npc-${n.attitude}${n.condition === "down" ? " npc-down" : ""}`}
              disabled={!canAct} aria-expanded={open === n.name} title={`${n.attitude}, ${n.condition}`}
              onClick={() => toggle(n.name)}>
              <span className="npc-name">{n.name}</span>
              <small className="npc-condition">{n.condition}</small>
            </button>
          </div>
        ))}
      </div>
      {open && (
        <div className="npc-menu" role="menu" style={{ left: menuLeft }}>
          {ACTIONS.map(([kind, label]) => (
            <button key={kind} type="button" role="menuitem" onClick={() => { onPick(quickActionText(kind, open)); setOpen(null); }}>{label}</button>
          ))}
        </div>
      )}
    </div>
  );
}
