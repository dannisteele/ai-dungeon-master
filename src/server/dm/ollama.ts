export interface ChatMessage { role: "system" | "user" | "assistant"; content: string }
export interface ChatRequest { messages: ChatMessage[]; format: object; onToken?: (t: string) => void; timeoutMs?: number }
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
    async chat({ messages, format, onToken, timeoutMs = 90_000 }) {
      try {
        const res = await post("/api/chat", {
          model: opts.model, messages, format, stream: true, think: false, keep_alive: opts.keepAlive,
          options: { temperature: 0.8 },
        }, AbortSignal.timeout(timeoutMs));
        if (!res.body) throw new OllamaError("Ollama sent an empty response");
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buf = "";
        let out = "";
        const handle = (line: string) => {
          if (!line.trim()) return;
          const msg = JSON.parse(line) as { error?: string; message?: { content?: string } };
          if (msg.error) throw new OllamaError(`Ollama error: ${msg.error}`);
          const tok = msg.message?.content ?? "";
          if (tok) { out += tok; onToken?.(tok); }
        };
        for (;;) {
          const { value, done } = await reader.read();
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
      }
    },

    async unload() {
      await post("/api/generate", { model: opts.model, keep_alive: 0, stream: false }, AbortSignal.timeout(15_000));
    },
  };
}
