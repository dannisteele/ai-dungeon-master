import { useEffect, useState } from "react";
import { api } from "./api";

/**
 * While the DM is busy, whether Ollama is still loading the model (the slow first turn after
 * a break). Checks straight away, then every few seconds until the model is in memory.
 */
export function useDmWaking(busy: boolean): boolean {
  const [waking, setWaking] = useState(false);
  useEffect(() => {
    if (!busy) { setWaking(false); return; }
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const check = () => api.dmStatus().then(({ loaded }) => {
      if (!live) return;
      setWaking(!loaded);
      if (!loaded) timer = setTimeout(check, 4000);
    }, () => {});
    check();
    return () => { live = false; clearTimeout(timer); };
  }, [busy]);
  return waking;
}
