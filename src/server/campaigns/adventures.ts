import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { AdventureOutline } from "../../shared/types";

const AdventureSchema = z.object({
  id: z.string().min(1), title: z.string().min(1), setting: z.string().min(1), pitch: z.string().min(1),
  goal: z.string().min(1), villain: z.string().min(1), locations: z.array(z.string()).min(1), beats: z.array(z.string()).min(1),
}) satisfies z.ZodType<AdventureOutline>;

const DIR = join(dirname(fileURLToPath(import.meta.url)), "adventures");

/** Hand-written adventures: drop another JSON file in ./adventures to add one. */
export function loadAdventures(dir = DIR): AdventureOutline[] {
  return readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => {
    const parsed = AdventureSchema.safeParse(JSON.parse(readFileSync(join(dir, f), "utf8")));
    if (!parsed.success) throw new Error(`Adventure ${f} is invalid: ${z.prettifyError(parsed.error)}`);
    return parsed.data;
  });
}
