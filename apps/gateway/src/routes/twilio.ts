import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";

import { CANON_EVENT } from "@aura/contracts";
import type { GatewayConfig } from "../config.js";
import type { Orchestrator } from "../engine/orchestrator.js";
import { callIdFor, type SessionStore } from "../session/store.js";

export interface TwilioDeps {
  store: SessionStore;
  orchestrator: Orchestrator;
  config: GatewayConfig;
}

/**
 * Inbound telephony: a real phone call into AURA.
 *
 * Twilio handles both halves of the audio loop — `<Gather input="speech">` is
 * the STT and `<Say>` is the TTS — so the whole conversation runs over PSTN with
 * no local microphone and no native dependencies. Each turn is one HTTP
 * round-trip: Twilio posts what it heard, the gateway runs the normal turn, and
 * the TwiML response is what the caller hears next.
 *
 * Like the browser console, this is a fallback transport. Gradium and Pipecat
 * remain the sponsor path; the upgrade that keeps both is Twilio Media Streams
 * into Pipecat's Twilio transport, with Gradium still doing STT and TTS.
 */

/** Twilio's speech recogniser returns plain text; keep it XML-safe. */
function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Validate `X-Twilio-Signature`.
 *
 * These routes are publicly reachable by definition — a tunnel points the open
 * internet at them — so an unsigned POST must not be able to drive the incident
 * or run up call time. Skipped only when no auth token is configured, which is
 * the local-test case.
 */
export function isValidTwilioSignature(
  authToken: string,
  url: string,
  params: Record<string, string>,
  signature: string,
): boolean {
  // Twilio signs the full URL with every POST param appended in key order.
  const payload = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  const expected = createHmac("sha1", authToken).update(Buffer.from(payload, "utf8")).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

const GREETING =
  "Emergency services, this line is answered by an A I assistant with a human dispatcher supervising. Tell me what is happening and where you are.";

const NO_SPEECH =
  "I did not catch that. Please tell me what is happening and where you are.";

export async function twilioRoutes(app: FastifyInstance, deps: TwilioDeps): Promise<void> {
  const { store, orchestrator, config } = deps;

  /** Reconstruct the exact URL Twilio signed. */
  function signedUrl(request: FastifyRequest): string {
    if (config.publicBaseUrl) return `${config.publicBaseUrl}${request.url}`;
    const proto = (request.headers["x-forwarded-proto"] as string) ?? request.protocol;
    return `${proto}://${request.headers.host}${request.url}`;
  }

  function verify(request: FastifyRequest): boolean {
    if (!config.twilioAuthToken) return true; // local tests, no token configured
    const signature = request.headers["x-twilio-signature"];
    if (typeof signature !== "string") return false;
    const params = (request.body ?? {}) as Record<string, string>;
    return isValidTwilioSignature(config.twilioAuthToken, signedUrl(request), params, signature);
  }

  /** One `<Gather>` turn; `say` is optional so the first prompt and the replies share it. */
  function twiml(say: string | null, { hangup = false } = {}): string {
    const speech = say
      ? `<Say voice="${config.twilioVoice}">${escapeXml(say)}</Say>`
      : "";
    if (hangup) {
      return `<?xml version="1.0" encoding="UTF-8"?><Response>${speech}<Hangup/></Response>`;
    }
    return (
      `<?xml version="1.0" encoding="UTF-8"?>` +
      `<Response>` +
      `<Gather input="speech" action="/twilio/gather" method="POST" ` +
      `speechTimeout="auto" speechModel="phone_call" language="en-US" actionOnEmptyResult="true">` +
      speech +
      `</Gather>` +
      `</Response>`
    );
  }

  /**
   * Which gateway session a call belongs to.
   *
   * Pinned to the deck's session id by default so a real phone call lights up
   * the command deck that is already on screen. Set `TWILIO_SESSION_ID=call_sid`
   * to give every call its own session instead.
   */
  function sessionIdFor(callSid: string): string {
    return config.twilioSessionId === "call_sid"
      ? `twilio_${callSid}`
      : config.twilioSessionId;
  }

  /** Inbound call. Twilio hits this the moment the phone is answered. */
  app.post("/twilio/voice", async (request, reply) => {
    if (!verify(request)) {
      request.log.warn("rejected unsigned Twilio request to /twilio/voice");
      return reply.code(403).type("text/plain").send("invalid signature");
    }
    const body = (request.body ?? {}) as Record<string, string>;
    const callSid = body.CallSid ?? "unknown";
    const sessionId = sessionIdFor(callSid);

    // A new phone call is a new incident: start from a clean slate so the deck
    // is not showing the last caller's emergency.
    const session = store.has(sessionId)
      ? orchestrator.reset(sessionId)
      : store.create({
          session_id: sessionId,
          caller_number: body.From ?? "unknown",
          channel: "phone",
        });
    session.caller_number = body.From ?? session.caller_number;
    session.channel = "phone";
    orchestrator.openCall(session);

    request.log.info({ session_id: sessionId, call_sid: callSid, from: body.From }, "inbound call");
    orchestrator.publishRaw(session, {
      type: CANON_EVENT.AgentSpeaking,
      payload: { text: GREETING, active: true, channel: "phone" },
    });

    return reply.type("text/xml").send(twiml(GREETING));
  });

  /**
   * One caller turn. Twilio posts what it heard; the TwiML we return is what
   * the caller hears next, so the whole turn has to finish inside this request.
   */
  app.post("/twilio/gather", async (request, reply) => {
    if (!verify(request)) {
      request.log.warn("rejected unsigned Twilio request to /twilio/gather");
      return reply.code(403).type("text/plain").send("invalid signature");
    }
    const body = (request.body ?? {}) as Record<string, string>;
    const callSid = body.CallSid ?? "unknown";
    const sessionId = sessionIdFor(callSid);
    const heard = (body.SpeechResult ?? "").trim();
    const confidence = Number.parseFloat(body.Confidence ?? "") || 0.8;

    let session = store.get(sessionId);
    if (!session) {
      session = store.create({ session_id: sessionId, channel: "phone" });
      orchestrator.openCall(session);
    }

    // `actionOnEmptyResult` means silence lands here too; re-prompt rather than
    // sending an empty utterance into the protocol machine.
    if (!heard) {
      return reply.type("text/xml").send(twiml(NO_SPEECH));
    }

    // This transport publishes its own transcript, exactly as the voice service
    // does, so the turn runs with `source: "voice"` and the gateway does not try
    // to push TTS at a service that is not there.
    orchestrator.publishRaw(session, {
      type: CANON_EVENT.TranscriptFinal,
      payload: { speaker: "caller", text: heard, confidence, language: "en" },
    });

    const result = await orchestrator.submitUtterance(session, {
      text: heard,
      speaker: "caller",
      language: "en",
      source: "voice",
    });

    // A superseded turn has nothing safe to say; keep listening instead.
    const line = result.reply_text;
    if (line) {
      orchestrator.publishRaw(session, {
        type: CANON_EVENT.AgentSpeaking,
        payload: { text: line, active: true, channel: "phone" },
      });
    }

    request.log.info(
      { session_id: sessionId, heard: heard.slice(0, 60), superseded: result.superseded },
      "twilio turn",
    );
    return reply.type("text/xml").send(twiml(line));
  });

  /** Call completed / failed. Close the incident's call, keep the state. */
  app.post("/twilio/status", async (request, reply) => {
    if (!verify(request)) return reply.code(403).type("text/plain").send("invalid signature");
    const body = (request.body ?? {}) as Record<string, string>;
    const status = body.CallStatus ?? "completed";
    const session = store.get(sessionIdFor(body.CallSid ?? "unknown"));
    if (session && ["completed", "failed", "busy", "no-answer", "canceled"].includes(status)) {
      orchestrator.endCall(session, status);
    }
    return reply.code(204).send();
  });

  /** What to paste into the Twilio console, and whether the wiring is ready. */
  app.get("/twilio/config", async () => {
    const base = config.publicBaseUrl;
    return {
      configured: Boolean(config.twilioAuthToken),
      public_base_url: base || null,
      voice_webhook: base ? `${base}/twilio/voice` : "set PUBLIC_BASE_URL to a tunnel URL",
      status_callback: base ? `${base}/twilio/status` : null,
      session_mode: config.twilioSessionId === "call_sid" ? "one session per call" : config.twilioSessionId,
      note: base
        ? "Set the number's Voice webhook to voice_webhook (HTTP POST)."
        : "Start a tunnel (./scripts/tunnel.sh), then restart with PUBLIC_BASE_URL set.",
    };
  });
}
