import { useEffect, useState } from "react";
import { api } from "./api";

// Whether the server has a GitHub token never changes while it runs, so ask once per page load.
let enabled: Promise<boolean> | null = null;

export function useFeedbackEnabled(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    enabled ??= api.feedbackEnabled().then((r) => r.enabled, () => { enabled = null; return false; });
    let live = true;
    enabled.then((v) => { if (live) setOn(v); });
    return () => { live = false; };
  }, []);
  return on;
}
