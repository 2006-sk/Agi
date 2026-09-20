/**
 * WebSocket fan-out.
 *
 * One socket per frontend viewer, keyed by session. The hub owns delivery only —
 * sequencing and the event log live in the session store — so a dropped or
 * reconnecting client can never perturb the canonical stream.
 */

import type { EchoEvent } from "@echo/contracts";

export interface Sink {
  send(data: string): void;
  readyState?: number;
}

const OPEN = 1;

export class EventHub {
  private readonly rooms = new Map<string, Set<Sink>>();

  join(sessionId: string, sink: Sink): void {
    let room = this.rooms.get(sessionId);
    if (!room) {
      room = new Set();
      this.rooms.set(sessionId, room);
    }
    room.add(sink);
  }

  leave(sessionId: string, sink: Sink): void {
    const room = this.rooms.get(sessionId);
    if (!room) return;
    room.delete(sink);
    if (room.size === 0) this.rooms.delete(sessionId);
  }

  clients(sessionId: string): number {
    return this.rooms.get(sessionId)?.size ?? 0;
  }

  /** Deliver to every live socket for a session. A dead socket is dropped, not thrown on. */
  broadcast(sessionId: string, event: EchoEvent): void {
    const room = this.rooms.get(sessionId);
    if (!room || room.size === 0) return;
    const frame = JSON.stringify(event);
    for (const sink of [...room]) {
      if (sink.readyState !== undefined && sink.readyState !== OPEN) {
        room.delete(sink);
        continue;
      }
      try {
        sink.send(frame);
      } catch {
        room.delete(sink);
      }
    }
  }

  /** Send one client the backlog it missed, oldest first. */
  replay(sink: Sink, events: EchoEvent[]): void {
    for (const event of events) {
      try {
        sink.send(JSON.stringify(event));
      } catch {
        return;
      }
    }
  }
}
