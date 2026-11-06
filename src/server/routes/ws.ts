import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { ClientMsg } from "../../shared/types";
import type { Hub } from "../realtime/hub";
import type { RulesEngine } from "../rules/engine";
import type { Store } from "../store/store";
import { buildSnapshot } from "../turns/snapshot";
import { GameError, type TurnService } from "../turns/turns";

const id = z.number().int();
export const ClientMsgSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("begin") }),
  z.object({ t: z.literal("action"), characterId: id, text: z.string() }),
  z.object({ t: z.literal("skip"), characterId: id, by: id }),
  z.object({ t: z.literal("roll"), characterId: id }),
  z.object({ t: z.literal("retry") }),
  z.object({ t: z.literal("revive") }),
  z.object({ t: z.literal("try_again") }),
]) satisfies z.ZodType<ClientMsg>;

function dispatch(turns: TurnService, campaignId: number, msg: ClientMsg): Promise<void> {
  switch (msg.t) {
    case "begin": return turns.begin(campaignId);
    case "action": return turns.submitAction(campaignId, msg.characterId, msg.text);
    case "skip": return turns.skip(campaignId, msg.characterId, msg.by);
    case "roll": return turns.roll(campaignId, msg.characterId);
    case "retry": return turns.retry(campaignId);
    case "revive": return turns.revive(campaignId);
    case "try_again": return turns.tryAgain(campaignId);
  }
}

export async function registerWs(app: FastifyInstance, deps: { store: Store; rules: RulesEngine; turns: TurnService; hub: Hub }): Promise<void> {
  app.get<{ Querystring: { campaign?: string } }>("/ws", { websocket: true }, (socket, req) => {
    const campaignId = Number(req.query.campaign);
    const sendError = (message: string) => socket.send(JSON.stringify({ t: "error", message }));
    if (!deps.store.getCampaign(campaignId)) {
      sendError("No such campaign.");
      socket.close();
      return;
    }
    deps.hub.join(campaignId, socket);
    socket.send(JSON.stringify({ t: "snapshot", snapshot: buildSnapshot(deps.store, deps.rules, campaignId) }));

    socket.on("message", async (raw: Buffer) => {
      let msg: ClientMsg;
      try {
        msg = ClientMsgSchema.parse(JSON.parse(raw.toString()));
      } catch {
        sendError("That message didn't make sense.");
        return;
      }
      try {
        await dispatch(deps.turns, campaignId, msg);
      } catch (e) {
        if (e instanceof GameError) sendError(e.message);
        else { req.log.error(e); sendError("Something went wrong at the table."); }
      }
    });
    socket.on("close", () => deps.hub.leave(campaignId, socket));
  });
}
