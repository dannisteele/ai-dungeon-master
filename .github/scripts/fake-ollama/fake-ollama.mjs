// Stand-in for `ollama serve` in CI: answers /api/tags like an Ollama with no models.
import { createServer } from "node:http";
if (process.argv[2] !== "serve") process.exit(0);
createServer((req, res) => {
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify(req.url === "/api/tags" ? { models: [] } : {}));
}).listen(11434, "127.0.0.1");
