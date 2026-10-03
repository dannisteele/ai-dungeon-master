import { useEffect, useState } from "react";
import { api } from "./lib/api";
import { useHashRoute } from "./lib/router";
import { CreateCharacter } from "./screens/CreateCharacter";
import { Lobby } from "./screens/Lobby";
import { NewCampaign } from "./screens/NewCampaign";
import { PasswordGate } from "./screens/PasswordGate";
import { Play } from "./screens/Play";

export function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const route = useHashRoute();
  useEffect(() => { api.session().then((s) => setAuthed(s.authed)).catch(() => setAuthed(false)); }, []);

  if (authed === null) return <main className="page muted">Lighting the candles…</main>;
  if (!authed) return <PasswordGate onUnlocked={() => setAuthed(true)} />;

  let screen;
  if (route[0] === "new") screen = <NewCampaign />;
  else if (route[0] === "c" && route[2] === "join") screen = <CreateCharacter campaignId={Number(route[1])} />;
  else if (route[0] === "c" && route[1]) screen = <Play key={route[1]} campaignId={Number(route[1])} />;
  else screen = <Lobby />;

  return <>{screen}<div id="dice-stage" /></>;
}
