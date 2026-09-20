import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { EventHub } from "../bus/hub.js";
import type { Orchestrator } from "../engine/orchestrator.js";
import type { SessionStore } from "../session/store.js";

export interface WsDeps {
  store: SessionStore;
  hub: EventHub;
  orchestrator: Orchestrator;
  /** The one id a console may open before any call exists. */
  demoSessionId?: string;
}

/** What the deck sends back up the socket when an operator decides. */
const OperatorFrame = z.object({
  type: z.literal("operator.decision"),
  payload: z.object({
    kind: z.literal("approval"),
    approval_id: z.string(),
    decision: z.enum(["granted", "rejected"]),
    reason: z.string().optional(),
    reviewer: z.string().optional(),
  }),
});

export async function wsRoutes(app: FastifyInstance, deps: WsDeps): Promise<void> {
  const { store, hub, orchestrator, demoSessionId } = deps;

  /**
   * The one socket the frontend opens.
   *
   * On connect the client gets the entire log from sequence 1. That is what
   * makes a reload or a dropped Wi-Fi connection a non-event: `session.started`
   * resets the deck's ingest baseline and the replay rebuilds the incident
   * exactly, with duplicate `event_id`s ignored if it already had some of them.
   */
  app.get("/ws/calls/:session_id", { websocket: true }, (socket, request) => {
    const { session_id: sessionId } = request.params as { session_id: string };

    // Opening a socket must not conjure a call. A stale browser tab retrying a
    // session id from a previous run would otherwise resurrect it, and the
    // dashboard would show a phantom incident nobody is on.
    //
    // The one exception is the pinned demo session: the console may legitimately
    // open that before any call exists, rather than racing the operator.
    let session = store.get(sessionId);
    if (!session) {
      if (demoSessionId && sessionId === demoSessionId) {
        session = store.create({ session_id: sessionId });
        orchestrator.openCall(session);
      } else {
        request.log.info({ session_id: sessionId }, "refused socket for unknown session");
        socket.close(4404, "unknown_session");
        return;
      }
    }

    hub.join(sessionId, socket);
    hub.replay(socket, session.log);
    request.log.info(
      { session_id: sessionId, replayed: session.log.length, clients: hub.clients(sessionId) },
      "deck connected",
    );

    socket.on("message", (raw: Buffer | string) => {
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const frame = OperatorFrame.safeParse(parsedJson);
      if (!frame.success) return;

      const live = store.get(sessionId);
      if (!live) return;
      const { approval_id, decision, reason, reviewer } = frame.data.payload;
      void orchestrator
        .resolveApproval(live, {
          approval_id,
          approved: decision === "granted",
          reviewer: reviewer ?? "operator",
          reason,
        })
        .then((result) => {
          if (!result.ok) {
            request.log.warn(
              { session_id: sessionId, approval_id, error: result.error },
              "operator decision rejected",
            );
          }
        });
    });

    socket.on("close", () => {
      hub.leave(sessionId, socket);
      request.log.info({ session_id: sessionId, clients: hub.clients(sessionId) }, "deck disconnected");
    });
  });
}
