import type { FastifyInstance } from "fastify";
import { z } from "zod";

import type { Orchestrator } from "../engine/orchestrator.js";
import type { SessionStore } from "../session/store.js";

export interface VoiceEventDeps {
  store: SessionStore;
  orchestrator: Orchestrator;
}

const VoiceEvent = z.object({
  event_id: z.string().optional(),
  session_id: z.string().min(1),
  type: z.string().min(1),
  timestamp: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).optional().default({}),
});

/** Types the voice service is allowed to inject. Anything else is dropped. */
const VOICE_TYPES = new Set([
  "call.started",
  "call.ended",
  "audio.level",
  "transcript.partial",
  "transcript.final",
  "agent.speaking",
  "agent.interrupted",
  "voice.error",
]);

export async function voiceEventRoutes(app: FastifyInstance, deps: VoiceEventDeps): Promise<void> {
  const { store, orchestrator } = deps;

  /**
   * Fan-in from Aditya's voice service.
   *
   * High frequency (`audio.level` runs at ~15 Hz), so this stays cheap: validate,
   * sequence, broadcast. It never blocks on anything downstream, because a slow
   * response here would show up as stutter in the waveform.
   */
  app.post("/internal/voice-events", async (request, reply) => {
    const parsed = VoiceEvent.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_event", issues: parsed.error.issues });
    }
    const event = parsed.data;
    if (!VOICE_TYPES.has(event.type)) {
      return reply.code(422).send({ error: "unsupported_type", type: event.type });
    }

    let session = store.get(event.session_id);
    if (!session) {
      // A live call must never be dropped because nobody pressed "new call".
      session = store.create({ session_id: event.session_id });
      orchestrator.openCall(session);
    }

    const published = orchestrator.ingestVoiceEvent(session, event);
    return reply.send({
      ok: true,
      sequence: published[0]?.sequence ?? session.sequence,
      derived: published.length - 1,
    });
  });
}
