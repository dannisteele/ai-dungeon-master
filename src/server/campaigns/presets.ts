import type { AdventureOutline, NewCampaignRequest, Preset } from "../../shared/types";
import type { NewCampaignInput } from "../store/store";

export const PRESETS: Preset[] = [
  { id: "classic-fantasy", name: "Classic Fantasy", blurb: "Taverns, dragons, ruined keeps and a kingdom in need of heroes.",
    setting: "Classic high fantasy: knights, wizards, dragons, ancient ruins, and a realm on the edge of war." },
  { id: "gothic-horror", name: "Gothic Horror", blurb: "Fog, candlelight and things that should stay buried.",
    setting: "Gothic horror: a mist-bound valley of crumbling manors, superstitious villagers, cursed nobles and creeping dread. Danger is real." },
  { id: "pirate-seas", name: "Pirate Seas", blurb: "Salt, cannon smoke and treasure maps of dubious honesty.",
    setting: "Swashbuckling age of sail: pirate havens, navy hunters, sea monsters, cursed gold and island mysteries." },
  { id: "scifi-derelict", name: "Sci-fi Derelict", blurb: "A dead ship drifts in the dark. Something aboard is still awake.",
    setting: "Tense science fiction: a salvage crew boards a derelict starship far from help. Failing systems, strange tech, and something alien." },
  { id: "victorian-civil-service", name: "Her Majesty's Civil Service", blurb: "Ledgers, sealing wax and forms in triplicate. Whitehall awaits.",
    setting: "Dry comic Victorian bureaucracy, London in the 1850s: the heroes are junior clerks in a Whitehall ministry of gaslit corridors, towering ledgers, pneumatic tubes, sealing wax and forms in triplicate. Rival departments, pompous Permanent Secretaries, pedantic regulations and scandals waiting to be buried. Stakes are careers, reputations and the public good; cleverness, procedure and persuasion matter more than swords, and violence is rare and shocking." },
];

export function campaignInputFrom(req: NewCampaignRequest, adventures: AdventureOutline[]): NewCampaignInput | { error: string } {
  const title = req.title?.trim();
  switch (req.source.kind) {
    case "preset": {
      const presetId = req.source.presetId;
      const p = PRESETS.find((x) => x.id === presetId);
      if (!p) return { error: "Unknown setting." };
      return { title: title || p.name, mode: req.mode, setting: p.setting, pitch: "", outline: null };
    }
    case "pitch":
      return { title: title || "A Tale Untold", mode: req.mode, setting: "Custom setting described in the pitch", pitch: req.source.pitch.trim(), outline: null };
    case "adventure": {
      const adventureId = req.source.adventureId;
      const a = adventures.find((x) => x.id === adventureId);
      if (!a) return { error: "Unknown adventure." };
      return { title: title || a.title, mode: req.mode, setting: a.setting, pitch: a.pitch, outline: a };
    }
  }
}
