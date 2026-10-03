import type { ServerMsg } from "../../shared/types";

export interface Broadcaster { broadcast(campaignId: number, msg: ServerMsg): void }
export interface Socketish { send(data: string): void; readyState: number }

const OPEN = 1;

export class Hub implements Broadcaster {
  private rooms = new Map<number, Set<Socketish>>();

  join(campaignId: number, ws: Socketish): void {
    const room = this.rooms.get(campaignId) ?? new Set();
    room.add(ws);
    this.rooms.set(campaignId, room);
  }

  leave(campaignId: number, ws: Socketish): void {
    this.rooms.get(campaignId)?.delete(ws);
  }

  broadcast(campaignId: number, msg: ServerMsg): void {
    const data = JSON.stringify(msg);
    for (const ws of this.rooms.get(campaignId) ?? []) {
      if (ws.readyState === OPEN) ws.send(data);
    }
  }
}
