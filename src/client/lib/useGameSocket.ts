import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMsg, ServerMsg, Snapshot } from "../../shared/types";

export function useGameSocket(campaignId: number) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [streaming, setStreaming] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let closed = false;
    let retry = 0;
    let timer: number | undefined;
    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/ws?campaign=${campaignId}`);
      wsRef.current = ws;
      ws.onopen = () => { retry = 0; setConnected(true); setError(null); };
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data as string) as ServerMsg;
        switch (msg.t) {
          case "snapshot": {
            setSnapshot(msg.snapshot);
            const s = msg.snapshot.campaign.roundState;
            if (s !== "opening" && s !== "resolving") setStreaming("");
            break;
          }
          case "narration_chunk": setStreaming((t) => t + msg.text); break;
          case "narration_reset": setStreaming(""); break;
          case "error": setError(msg.message); break;
        }
      };
      ws.onclose = () => {
        setConnected(false);
        if (closed) return;
        timer = window.setTimeout(connect, Math.min(10_000, 500 * 2 ** retry++));
      };
    };
    connect();
    return () => { closed = true; clearTimeout(timer); wsRef.current?.close(); };
  }, [campaignId]);

  const send = useCallback((msg: ClientMsg) => {
    setError(null);
    const ws = wsRef.current;
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    else setError("Reconnecting to the table…");
  }, []);

  return { snapshot, streaming, error, connected, send };
}
