import { describe, expect, it } from "vitest";
import { createOllamaClient, OllamaError } from "../../../src/server/dm/ollama";

function streamResponse(parts: string[], status = 200): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(c) { for (const p of parts) c.enqueue(enc.encode(p)); c.close(); },
  });
  return new Response(body, { status });
}

describe("ollama client", () => {
  it("posts a streaming chat with format, keep_alive and think:false, and joins tokens", async () => {
    const calls: { url: string; body: any }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return streamResponse([
        '{"message":{"content":"{\\"narr"}}\n{"message":{"con',
        'tent":"ation\\": \\"Hi\\"}"}}\n',
        '{"done":true}\n',
      ]);
    }) as typeof fetch;
    const tokens: string[] = [];
    const client = createOllamaClient({ url: "http://ollama:11434", model: "qwen", keepAlive: "30m", fetchImpl });
    const out = await client.chat({ messages: [{ role: "user", content: "go" }], format: { type: "object" }, onToken: (t) => tokens.push(t) });
    expect(out).toBe('{"narration": "Hi"}');
    expect(tokens.join("")).toBe(out);
    expect(calls[0].url).toBe("http://ollama:11434/api/chat");
    expect(calls[0].body).toMatchObject({ model: "qwen", stream: true, think: false, keep_alive: "30m", format: { type: "object" } });
  });

  it("wraps network failures in OllamaError", async () => {
    const fetchImpl = (async () => { throw new TypeError("fetch failed"); }) as typeof fetch;
    const client = createOllamaClient({ url: "http://x", model: "m", keepAlive: "30m", fetchImpl });
    await expect(client.chat({ messages: [], format: {} })).rejects.toThrow(OllamaError);
    await expect(client.chat({ messages: [], format: {} })).rejects.toThrow(/Could not reach Ollama at http:\/\/x/);
  });

  it("reports HTTP errors and in-stream errors", async () => {
    const http = createOllamaClient({ url: "http://x", model: "m", keepAlive: "30m", fetchImpl: (async () => new Response("model not found", { status: 404 })) as typeof fetch });
    await expect(http.chat({ messages: [], format: {} })).rejects.toThrow(/404.*model not found/);
    const inStream = createOllamaClient({ url: "http://x", model: "m", keepAlive: "30m", fetchImpl: (async () => streamResponse(['{"error":"out of memory"}\n'])) as typeof fetch });
    await expect(inStream.chat({ messages: [], format: {} })).rejects.toThrow(/out of memory/);
  });

  it("times out", async () => {
    const fetchImpl = ((_u: string, init: RequestInit) => new Promise((_, reject) => {
      init.signal!.addEventListener("abort", () => reject(init.signal!.reason));
    })) as typeof fetch;
    const client = createOllamaClient({ url: "http://x", model: "m", keepAlive: "30m", fetchImpl });
    await expect(client.chat({ messages: [], format: {}, timeoutMs: 20 })).rejects.toThrow(OllamaError);
  });

  it("unload sends keep_alive 0 for the model", async () => {
    const calls: { url: string; body: any }[] = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ done: true, done_reason: "unload" }));
    }) as typeof fetch;
    await createOllamaClient({ url: "http://x", model: "qwen", keepAlive: "30m", fetchImpl }).unload();
    expect(calls).toEqual([{ url: "http://x/api/generate", body: { model: "qwen", keep_alive: 0, stream: false } }]);
  });

  it("unload reports an unreachable Ollama", async () => {
    const fetchImpl = (async () => { throw new TypeError("fetch failed"); }) as typeof fetch;
    await expect(createOllamaClient({ url: "http://x", model: "m", keepAlive: "30m", fetchImpl }).unload()).rejects.toThrow(OllamaError);
  });
});
