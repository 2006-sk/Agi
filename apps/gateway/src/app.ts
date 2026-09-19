import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance } from "fastify";

import { EventHub } from "./bus/hub.js";
import { HttpIntelligenceClient, type IntelligenceClient } from "./clients/intelligence.js";
import { HttpVoiceClient, type VoiceClient } from "./clients/voice.js";
import { config as defaultConfig, type GatewayConfig } from "./config.js";
import { Orchestrator } from "./engine/orchestrator.js";
import { callRoutes } from "./routes/calls.js";
import { consoleRoutes } from "./routes/console.js";
import { twilioRoutes } from "./routes/twilio.js";
import { vapiRoutes } from "./routes/vapi.js";
import { healthRoutes } from "./routes/health.js";
import { voiceEventRoutes } from "./routes/voiceEvents.js";
import { wsRoutes } from "./routes/ws.js";
import { SessionStore } from "./session/store.js";

export interface BuildOptions {
  config?: GatewayConfig;
  intelligence?: IntelligenceClient;
  voice?: VoiceClient;
  store?: SessionStore;
  logger?: boolean;
}

export interface AuraGateway {
  app: FastifyInstance;
  store: SessionStore;
  hub: EventHub;
  orchestrator: Orchestrator;
  config: GatewayConfig;
}

/**
 * Assemble the gateway.
 *
 * Every downstream dependency is injectable so the whole surface — routes,
 * sequencing, approval gate, WebSocket fan-out — can be exercised in tests
 * without a model, a microphone or a network.
 */
export async function buildGateway(options: BuildOptions = {}): Promise<AuraGateway> {
  const config = options.config ?? defaultConfig;
  const app = Fastify({
    logger: options.logger === false ? false : { level: config.logLevel },
    // The deck sends the whole incident state back on some diagnostics calls.
    bodyLimit: 4 * 1024 * 1024,
  });

  await app.register(cors, { origin: true });
  // Twilio webhooks are form-encoded; Fastify only speaks JSON out of the box.
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_request, body, done) => {
      try {
        done(null, Object.fromEntries(new URLSearchParams(body as string)));
      } catch (error) {
        done(error as Error, undefined);
      }
    },
  );
  await app.register(websocket);

  const store = options.store ?? new SessionStore();
  const hub = new EventHub();
  const intelligence =
    options.intelligence ?? new HttpIntelligenceClient(config.intelligenceUrl, config.analyzeTimeoutMs);
  const voice =
    options.voice ??
    new HttpVoiceClient(config.voiceUrl, config.voiceTimeoutMs, (op, error) => {
      app.log.warn({ op, err: error.message }, "voice call failed");
    });

  const orchestrator = new Orchestrator({
    store,
    hub,
    intelligence,
    voice,
    config,
    logger: app.log,
  });

  await app.register(async (scope) => healthRoutes(scope, { store, hub, intelligence, voice }));
  await app.register(async (scope) => callRoutes(scope, { store, orchestrator }));
  await app.register(async (scope) => voiceEventRoutes(scope, { store, orchestrator }));
  await app.register(async (scope) => wsRoutes(scope, { store, hub, orchestrator }));
  await app.register(consoleRoutes);
  await app.register(async (scope) => twilioRoutes(scope, { store, orchestrator, config }));
  await app.register(async (scope) => vapiRoutes(scope, { store, orchestrator, intelligence, config }));

  return { app, store, hub, orchestrator, config };
}
