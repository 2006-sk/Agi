import type { FastifyInstance } from "fastify";

import type { IntelligenceClient } from "../clients/intelligence.js";
import type { VoiceClient } from "../clients/voice.js";
import type { EventHub } from "../bus/hub.js";
import type { SessionStore } from "../session/store.js";

export interface HealthDeps {
  store: SessionStore;
  hub: EventHub;
  intelligence: IntelligenceClient;
  voice: VoiceClient;
}

export async function healthRoutes(app: FastifyInstance, deps: HealthDeps): Promise<void> {
  /** Liveness only — never blocks on a downstream service. */
  app.get("/health", async () => ({
    ok: true,
    service: "aura-gateway",
    sessions: deps.store.list().map((s) => ({
      session_id: s.session_id,
      status: s.status,
      sequence: s.sequence,
      clients: deps.hub.clients(s.session_id),
      degraded: s.degraded,
    })),
  }));

  /**
   * Readiness. `?probe=1` also asks the intelligence service to ping General
   * Compute, which is the check worth running once before a demo.
   */
  app.get("/health/deps", async (request) => {
    const probe = (request.query as Record<string, unknown>)?.probe === "1";
    const [intelligence, voice] = await Promise.all([
      deps.intelligence.health(probe),
      deps.voice.health(),
    ]);
    return {
      ok: intelligence.ok,
      intelligence,
      voice,
      note: voice.ok ? undefined : "voice is optional: text and demo modes still work",
    };
  });
}
