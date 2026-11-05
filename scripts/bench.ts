// Measures how fast the Dungeon Master is on this computer at a few context sizes
// (OLLAMA_NUM_CTX), and how much of the model fits on the graphics card at each.
// Usage: npm run bench [-- 16384 8192 ...]   Takes a few minutes; uses OLLAMA_URL and the model in .env.
import { loadConfig } from "../src/server/config";

try { process.loadEnvFile(); } catch { /* optional */ }
const config = loadConfig({ TABLE_PASSWORD: "bench", ...process.env });
const sizes = process.argv.slice(2).map(Number).filter((n) => n >= 4096);
const contexts = sizes.length ? sizes : [16384, 12288, 8192];
const model = process.env.BENCH_MODEL || config.ollamaModel;

// About as much story as a mid-campaign turn sends (roughly 3000 tokens), then a reply of ~250.
const story = Array.from({ length: 120 }, (_, i) =>
  `Round ${i + 1}: the clerks searched the ledgers of the Registry by gaslight, arguing about docket numbers and sealing wax.`).join("\n");
const prompt = `${story}\n\nContinue the story in one vivid paragraph.`;

interface GenerateReply { load_duration: number; prompt_eval_count: number; prompt_eval_duration: number; eval_count: number; eval_duration: number }
interface PsReply { models: { name: string; size: number; size_vram: number }[] }

async function call<T>(path: string, body?: object): Promise<T> {
  const res = await fetch(`${config.ollamaUrl}${path}`, body
    ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }
    : undefined);
  if (!res.ok) throw new Error(`Ollama ${path} returned ${res.status}: ${await res.text()}`);
  return (await res.json()) as T;
}

const unload = () => call("/api/generate", { model, keep_alive: 0 });
const secs = (ns: number) => ns / 1e9;

console.log(`Benchmarking ${model} at ${config.ollamaUrl}\n`);
const rows: string[] = [];
for (const numCtx of contexts) {
  await unload();
  process.stdout.write(`num_ctx ${numCtx}: loading and generating... `);
  const r = await call<GenerateReply>("/api/generate", {
    model, prompt, stream: false, think: false, keep_alive: "1m",
    options: { num_ctx: numCtx, num_predict: 250, temperature: 0.8 },
  });
  const ps = await call<PsReply>("/api/ps");
  const loaded = ps.models.find((m) => m.name === model);
  const onGpu = loaded ? Math.round((loaded.size_vram / loaded.size) * 100) : 0;
  const readSpeed = r.prompt_eval_count / secs(r.prompt_eval_duration);
  const writeSpeed = r.eval_count / secs(r.eval_duration);
  // A typical turn: read ~3000 tokens of story, write ~400 tokens of narration and changes.
  const turn = 3000 / readSpeed + 400 / writeSpeed;
  console.log("done");
  rows.push([
    String(numCtx).padStart(7), `${onGpu}%`.padStart(9), `${secs(r.load_duration).toFixed(1)}s`.padStart(7),
    `${readSpeed.toFixed(0)}/s`.padStart(9), `${writeSpeed.toFixed(1)}/s`.padStart(9), `~${turn.toFixed(0)}s`.padStart(10),
  ].join("  "));
}
await unload();

console.log(`\n${["num_ctx", "on GPU", "load", "reading", "writing", "per turn"].map((h, i) => h.padStart([7, 9, 7, 9, 9, 10][i])).join("  ")}`);
for (const row of rows) console.log(row);
console.log(`\nPick the largest num_ctx whose typical turn feels quick enough, and put it in .env as OLLAMA_NUM_CTX=...`);
