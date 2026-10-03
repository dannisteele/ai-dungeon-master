export interface ChatMessage { role: "system" | "user" | "assistant"; content: string }
export interface ChatRequest {
  messages: ChatMessage[];
  format: object;
  onToken?: (t: string) => void;
  /** Max idle time between tokens once streaming has started. Default 90s. */
  timeoutMs?: number;
  /** Max time to wait for the first token. Default 180s. */
  firstTokenTimeoutMs?: number;
}
export interface ChatClient {
  chat(req: ChatRequest): Promise<string>;
  /** Ask Ollama to drop the model from memory now (keep_alive: 0). */
  unload(): Promise<void>;
}

export class OllamaError extends Error {}

export function createOllamaClient(opts: { url: string; model: string; keepAlive: string; fetchImpl?: typeof fetch }): ChatClient {
  const fetchImpl = opts.fetchImpl ?? fetch;

  async function post(path: string, body: object, signal?: AbortSignal): Promise<Response> {
    let res: Response;
    try {
      res = await fetchImpl(`${opts.url}${path}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal,
      });
    } catch (e) {
      throw new OllamaError(`Could not reach Ollama at ${opts.url}: ${(e as Error).message}`);
    }
    if (!res.ok) throw new OllamaError(`Ollama returned ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res;
  }

  return {
    async chat({ messages, format, onToken, timeoutMs = 90_000, firstTokenTimeoutMs = 180_000 }) {
      // Ollama serves one request at a time: a queued request can sit for a long time before
      // the first token, but once tokens are flowing a healthy stream shouldn't go idle for long.
      // We time out on inactivity (reset on every chunk) rather than on total request duration.
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const clearTimer = () => clearTimeout(timer);
      const raceTimeout = <T>(p: Promise<T>, ms: number): Promise<T> => new Promise((resolve, reject) => {
        clearTimer();
        timer = setTimeout(() => {
          controller.abort();
          reject(new OllamaError(`Ollama: no response for ${ms}ms`));
        }, ms);
        p.then(
          (v) => { clearTimer(); resolve(v); },
          (e) => { clearTimer(); reject(e); },
        );
      });
      try {
        const res = await raceTimeout(post("/api/chat", {
          model: opts.model, messages, format, stream: true, think: false, keep_alive: opts.keepAlive,
          options: { temperature: 0.8, num_ctx: 16384 },
        }, controller.signal), firstTokenTimeoutMs);
        if (!res.body) throw new OllamaError("Ollama sent an empty response");
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buf = "";
        let out = "";
        let gotFirstChunk = false;
        const handle = (line: string) => {
          if (!line.trim()) return;
          const msg = JSON.parse(line) as { error?: string; message?: { content?: string } };
          if (msg.error) throw new OllamaError(`Ollama error: ${msg.error}`);
          const tok = msg.message?.content ?? "";
          if (tok) { out += tok; onToken?.(tok); }
        };
        for (;;) {
          const { value, done } = await raceTimeout(reader.read(), gotFirstChunk ? timeoutMs : firstTokenTimeoutMs);
          gotFirstChunk = true;
          if (done) break;
          buf += value;
          let nl: number;
          while ((nl = buf.indexOf("\n")) >= 0) {
            handle(buf.slice(0, nl));
            buf = buf.slice(nl + 1);
          }
        }
        handle(buf);
        return out;
      } catch (e) {
        if (e instanceof OllamaError) throw e;
        throw new OllamaError(`Ollama request failed: ${(e as Error).message}`);
      } finally {
        clearTimer();
      }
    },

    async unload() {
      await post("/api/generate", { model: opts.model, keep_alive: 0, stream: false }, AbortSignal.timeout(15_000));
    },
  };
}
