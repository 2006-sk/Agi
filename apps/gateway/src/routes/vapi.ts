import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { CANON_EVENT } from "@echo/contracts";
import type { GatewayConfig } from "../config.js";
import {
  GradiumSttSession,
  extractChannel,
  gradiumSynthesize,
} from "../clients/gradium.js";
import { SAFE_FALLBACK_LINE, type Orchestrator } from "../engine/orchestrator.js";
import { runVapiTool, type ToolCall } from "../engine/vapiTools.js";
import type { IntelligenceClient } from "../clients/intelligence.js";
import { VapiCallControl, type CallAnnouncer } from "../clients/vapiControl.js";
import type { Session, SessionStore } from "../session/store.js";

export interface VapiDeps {
  store: SessionStore;
  orchestrator: Orchestrator;
  intelligence: IntelligenceClient;
  config: GatewayConfig;
  announcer?: CallAnnouncer;
}

/**
 * Vapi bridge — a real phone call into ECHO, with ECHO doing all the work.
 *
 * Vapi is the phone line and nothing else. Every part that thinks or speaks is
 * ours:
 *
 *   caller ──▶ Vapi (PSTN carriage only)
 *            ├─ audio  ──▶ WS  /vapi/transcriber      ──▶ Gradium STT
 *            ├─ turn   ──▶ POST /vapi/chat/completions ──▶ protocol + SambaNova
 *            └─ speech ──▶ POST /vapi/voice            ──▶ Gradium TTS
 *
 * The custom-LLM hop is what keeps this honest. Vapi's own model never writes a
 * word: every line spoken is `next_response` from the deterministic protocol
 * machine, and dispatch still stops dead at the human gate. Swapping Vapi's
 * built-in transcriber and voice for Gradium keeps the sponsor stack
 * load-bearing rather than decorative.
 */

interface ChatMessage {
  role: string;
  content?: string | null;
}

interface ChatCompletionRequest {
  messages?: ChatMessage[];
  stream?: boolean;
  call?: { id?: string; customer?: { number?: string } };
}

/** The last thing the caller actually said. */
export function lastUserMessage(messages: ChatMessage[] | undefined): string {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role === "user" && typeof message.content === "string") {
      const text = message.content.trim();
      if (text) return text;
    }
  }
  return "";
}

function completionBody(content: string, model: string) {
  return {
    id: `chatcmpl-${randomUUID()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  };
}

/**
 * Stream the reply as OpenAI-style SSE.
 *
 * Vapi starts synthesising on the first chunk, so the line goes out word by
 * word rather than whole — it measurably shortens the silence between the
 * caller finishing and ECHO starting to speak.
 */
function streamCompletion(reply: FastifyReply, content: string, model: string): void {
  const id = `chatcmpl-${randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  reply.raw.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  const chunk = (delta: Record<string, unknown>, finish: string | null) =>
    `data: ${JSON.stringify({
      id,
      object: "chat.completion.chunk",
      created,
      model,
      choices: [{ index: 0, delta, finish_reason: finish }],
    })}\n\n`;

  reply.raw.write(chunk({ role: "assistant", content: "" }, null));
  for (const word of content.split(/(\s+)/)) {
    if (word) reply.raw.write(chunk({ content: word }, null));
  }
  reply.raw.write(chunk({}, "stop"));
  reply.raw.write("data: [DONE]\n\n");
  reply.raw.end();
}

export async function vapiRoutes(app: FastifyInstance, deps: VapiDeps): Promise<void> {
  const { store, orchestrator, intelligence, config } = deps;
  const control =
    config.vapiPrivateKey ? new VapiCallControl(config.vapiPrivateKey, 5000, app.log) : null;
  const MODEL = "echo-protocol";

  function authorized(request: FastifyRequest): boolean {
    if (!config.vapiSecret) return true;
    return request.headers["x-vapi-secret"] === config.vapiSecret;
  }

  function sessionIdFor(callId: string): string {
    return config.vapiSessionId === "call_id" ? `vapi_${callId}` : config.vapiSessionId;
  }

  function ensureSession(sessionId: string, callerNumber?: string): Session {
    let session = store.get(sessionId);
    if (!session) {
      session = store.create({
        session_id: sessionId,
        caller_number: callerNumber ?? "unknown",
        channel: "phone",
      });
      orchestrator.openCall(session);
    }
    return session;
  }

  /* ---------------------------------------------------------------- */
  /* Ears — Gradium STT                                                */
  /* ---------------------------------------------------------------- */

  /**
   * Vapi's custom transcriber.
   *
   * Vapi opens this socket for the call, sends one `start` frame describing the
   * audio, then streams raw interleaved PCM. We hand the caller's channel to
   * Gradium and push transcripts back; Vapi closes the caller's turn when it
   * sees a `final`, which makes our silence timer the end-of-turn detector.
   */
  app.get("/vapi/transcriber", { websocket: true }, (socket, request) => {
    if (config.vapiSecret) {
      const provided = request.headers["x-vapi-secret"];
      if (provided !== config.vapiSecret) {
        request.log.warn("rejected unauthenticated Vapi transcriber socket");
        socket.close(1008, "unauthorized");
        return;
      }
    }

    let stt: GradiumSttSession | null = null;
    let channels = 2;
    let started = false;

    const send = (transcription: string, transcriptType: "partial" | "final") => {
      if (socket.readyState !== socket.OPEN) return;
      socket.send(
        JSON.stringify({
          type: "transcriber-response",
          transcription,
          channel: "customer",
          transcriptType,
        }),
      );
    };

    socket.on("message", (data: Buffer, isBinary: boolean) => {
      // The handshake is the one text frame; everything after it is audio.
      if (!isBinary) {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(data.toString());
        } catch {
          return;
        }
        if (msg.type !== "start" || started) return;
        started = true;
        const sampleRate = Number(msg.sampleRate) || 16000;
        channels = Number(msg.channels) || 2;

        stt = new GradiumSttSession({
          apiKey: config.gradiumApiKey,
          sampleRate,
          language: config.defaultLanguage,
          silenceMs: config.sttSilenceMs,
        });
        stt.on("partial", (text: string) => send(text, "partial"));
        stt.on("final", (text: string) => send(text, "final"));
        stt.on("error", (error: Error) =>
          request.log.warn({ err: error.message }, "gradium stt error"),
        );
        stt.connect();

        request.log.info({ sampleRate, channels }, "vapi transcriber connected -> gradium");
        return;
      }

      // Channel 0 is the caller; channel 1 is ECHO. Transcribing our own voice
      // would put the agent's words in the caller's mouth.
      stt?.push(channels > 1 ? extractChannel(data, 0, channels) : data);
    });

    socket.on("close", () => {
      stt?.flush();
      stt?.close();
      stt = null;
      request.log.info("vapi transcriber socket closed");
    });
    socket.on("error", () => {
      stt?.close();
      stt = null;
    });
  });

  /* ---------------------------------------------------------------- */
  /* Mouth — Gradium TTS                                               */
  /* ---------------------------------------------------------------- */

  /**
   * Vapi's custom voice. Text in, raw PCM out at whatever rate Vapi asked for.
   *
   * A failure here must not be silence on a 911 call, so a synthesis error
   * returns 500 and lets Vapi fall back to its own voice rather than hanging.
   */
  app.post("/vapi/voice", async (request, reply) => {
    if (!authorized(request)) return reply.code(401).send({ error: "unauthorized" });

    const message = ((request.body ?? {}) as { message?: Record<string, unknown> }).message ?? {};
    const text = String(message.text ?? "").trim();
    const sampleRate = Number(message.sampleRate) || 24000;
    if (!text) return reply.code(400).send({ error: "no text" });

    const started = Date.now();
    try {
      const pcm = await gradiumSynthesize(text, {
        apiKey: config.gradiumApiKey,
        voiceId: config.gradiumVoiceId,
        sampleRate,
      });
      request.log.info(
        { chars: text.length, sample_rate: sampleRate, bytes: pcm.length, ms: Date.now() - started },
        "gradium tts",
      );
      return reply
        .header("content-type", "application/octet-stream")
        .header("content-length", String(pcm.length))
        .send(pcm);
    } catch (error) {
      request.log.error({ err: (error as Error).message }, "gradium tts failed");
      return reply.code(500).send({ error: "tts_failed" });
    }
  });

  /* ---------------------------------------------------------------- */
  /* Brain — the protocol machine                                      */
  /* ---------------------------------------------------------------- */

  /**
   * Vapi's custom LLM. One call per caller turn; the reply is what gets spoken.
   */
  app.post("/vapi/chat/completions", async (request, reply) => {
    if (!authorized(request)) return reply.code(401).send({ error: "unauthorized" });

    const body = (request.body ?? {}) as ChatCompletionRequest;
    const callId = body.call?.id ?? "unknown";
    const sessionId = sessionIdFor(callId);
    const heard = lastUserMessage(body.messages);
    const session = ensureSession(sessionId, body.call?.customer?.number);

    // Vapi may open with no caller turn; greet and start listening.
    if (!heard) {
      const greeting = config.vapiGreeting;
      orchestrator.publishRaw(session, {
        type: CANON_EVENT.AgentSpeaking,
        payload: { text: greeting, active: true, channel: "phone" },
      });
      return body.stream === false
        ? reply.send(completionBody(greeting, MODEL))
        : streamCompletion(reply, greeting, MODEL);
    }

    // This transport publishes its own transcript, exactly as the Pipecat
    // bridge does, so the turn runs with `source: "voice"` and the gateway does
    // not also try to push TTS at a service that is not running.
    orchestrator.publishRaw(session, {
      type: CANON_EVENT.TranscriptFinal,
      payload: { speaker: "caller", text: heard, confidence: 0.95, language: "en" },
    });

    const result = await orchestrator.submitUtterance(session, {
      text: heard,
      speaker: "caller",
      language: "en",
      source: "voice",
    });

    // A superseded turn would answer a question the caller has moved past.
    const line = result.reply_text ?? SAFE_FALLBACK_LINE;
    orchestrator.publishRaw(session, {
      type: CANON_EVENT.AgentSpeaking,
      payload: { text: line, active: true, channel: "phone" },
    });

    request.log.info(
      { session_id: sessionId, call_id: callId, heard: heard.slice(0, 60), superseded: result.superseded },
      "vapi turn",
    );
    return body.stream === false
      ? reply.send(completionBody(line, MODEL))
      : streamCompletion(reply, line, MODEL);
  });

  /* ---------------------------------------------------------------- */
  /* Call lifecycle                                                    */
  /* ---------------------------------------------------------------- */

  /**
   * Server events. The completions hop only fires on a finished turn, so
   * without this the deck would sit frozen between sentences.
   */
  app.post("/vapi/webhook", async (request, reply) => {
    if (!authorized(request)) return reply.code(401).send({ error: "unauthorized" });

    const message = ((request.body ?? {}) as { message?: Record<string, unknown> }).message ?? {};
    const type = String(message.type ?? "");
    const call = (message.call ?? {}) as { id?: string; customer?: { number?: string } };
    const sessionId = sessionIdFor(call.id ?? "unknown");

    if (type === "status-update") {
      const status = String(message.status ?? "");
      if (status === "in-progress") {
        const callId = call.id ?? "unknown";
        const current = store.get(sessionId);

        // Vapi can send in-progress more than once for the same call. Wiping
        // the board on a repeat throws away a live incident mid-conversation,
        // so a new incident starts only when the call id actually changes.
        if (current && current.activeCallId === callId) {
          request.log.info(
            { session_id: sessionId, call_id: callId },
            "vapi in-progress repeated; keeping the incident",
          );
          return reply.send({ ok: true, ignored: "duplicate_in_progress" });
        }

        const session = current
          ? orchestrator.reset(sessionId)
          : store.create({ session_id: sessionId, channel: "phone" });
        session.caller_number = call.customer?.number ?? session.caller_number;
        session.channel = "phone";
        session.activeCallId = callId;

        // The control socket is how the gateway speaks into this call later,
        // when the dispatcher approves and when the ambulance arrives. Vapi
        // usually sends it on this webhook; if not, look it up once now rather
        // than at the moment it is needed.
        const monitor = (call as { monitor?: { controlUrl?: string } }).monitor;
        session.vapiControlUrl = monitor?.controlUrl ?? null;
        if (!session.vapiControlUrl && control) {
          void control.controlUrlFor(callId).then((url) => {
            session.vapiControlUrl = url;
            request.log.info({ call_id: callId, found: Boolean(url) }, "resolved vapi control url");
          });
        }

        orchestrator.openCall(session);
        request.log.info(
          { session_id: sessionId, call_id: callId, from: session.caller_number },
          "vapi call started",
        );
      } else if (status === "ended") {
        const session = store.get(sessionId);
        if (session) {
          session.activeCallId = null;
          session.vapiControlUrl = null;
          orchestrator.endCall(session, String(message.endedReason ?? "completed"));
        }
      }
      return reply.send({ ok: true });
    }

    if (type === "transcript") {
      const session = store.get(sessionId);
      if (!session) return reply.send({ ok: true });
      const role = message.role === "assistant" ? "echo" : "caller";
      const text = String(message.transcript ?? "").trim();
      const isPartial = String(message.transcriptType ?? "partial") !== "final";
      // Who publishes the caller's final line depends on which brain is running.
      // In echo mode the completions endpoint does it, so taking it here too
      // would print the sentence twice. In vapi mode that endpoint is never
      // called — Vapi's own model is the brain — so if this drops the final,
      // nothing publishes it and the transcript panel stays empty for the
      // whole call.
      const callerFinalsAreOurs = config.voiceBrain === "vapi";
      if (text && (isPartial || role === "echo" || callerFinalsAreOurs)) {
        orchestrator.publishRaw(session, {
          type: isPartial ? CANON_EVENT.TranscriptPartial : CANON_EVENT.TranscriptFinal,
          payload: { speaker: role, text, confidence: 0.9, language: "en" },
        });
      }
      return reply.send({ ok: true });
    }

    if (type === "speech-update") {
      const session = store.get(sessionId);
      if (session) {
        const speaking = message.status === "started";
        const role = message.role === "assistant" ? "echo" : "caller";
        if (role === "echo") session.agentSpeaking = speaking;
        orchestrator.publishRaw(session, {
          type: CANON_EVENT.AudioLevel,
          payload: { level: speaking ? 0.6 : 0.05, speaker: role },
        });
      }
      return reply.send({ ok: true });
    }

    return reply.send({ ok: true });
  });

  /**
   * Vapi mode: the agent's tool calls.
   *
   * This is the whole integration surface when Vapi owns the brain. Each call
   * moves the incident and lights the deck; `request_dispatch` opens the human
   * gate and returns "pending", so the agent can ask for an ambulance but can
   * never send one.
   */
  app.post("/vapi/tools", async (request, reply) => {
    if (!authorized(request)) return reply.code(401).send({ error: "unauthorized" });

    const message = ((request.body ?? {}) as { message?: Record<string, unknown> }).message ?? {};
    const call = (message.call ?? {}) as { id?: string; customer?: { number?: string } };
    const session = ensureSession(sessionIdFor(call.id ?? "unknown"), call.customer?.number);

    const rawList = Array.isArray(message.toolCallList) ? message.toolCallList : [];
    const results = [];
    for (const raw of rawList as Record<string, unknown>[]) {
      // Vapi has shipped both a flat shape and an OpenAI-style nested one.
      const fn = (raw.function ?? {}) as Record<string, unknown>;
      const name = String(raw.name ?? fn.name ?? "");
      let args = (raw.arguments ?? fn.arguments ?? {}) as unknown;
      if (typeof args === "string") {
        try {
          args = JSON.parse(args);
        } catch {
          args = {};
        }
      }
      const toolCall: ToolCall = {
        id: String(raw.id ?? raw.toolCallId ?? ""),
        name,
        arguments: (args ?? {}) as Record<string, unknown>,
      };
      if (!toolCall.name) continue;

      request.log.info(
        { session_id: session.session_id, tool: toolCall.name, args: toolCall.arguments },
        "vapi agent tool call",
      );
      results.push(await runVapiTool(toolCall, { session, orchestrator, intelligence }));
    }

    return reply.send({ results });
  });

  /** What to configure, and whether it is ready. */
  app.get("/vapi/config", async () => {
    const base = config.publicBaseUrl;
    const wsBase = base.replace(/^http/, "ws");
    return {
      gradium_configured: Boolean(config.gradiumApiKey),
      vapi_configured: Boolean(config.vapiPrivateKey),
      public_base_url: base || null,
      custom_llm_url: base ? `${base}/vapi` : null,
      transcriber_url: base ? `${wsBase}/vapi/transcriber` : null,
      voice_url: base ? `${base}/vapi/voice` : null,
      server_url: base ? `${base}/vapi/webhook` : null,
      tools_url: base ? `${base}/vapi/tools` : null,
      mode: config.voiceBrain,
      phone_number: config.vapiPhoneNumber || null,
      session_mode: config.vapiSessionId === "call_id" ? "one session per call" : config.vapiSessionId,
      note: base
        ? "Run ./scripts/vapi-setup.sh to point the assistant and number at these URLs."
        : "Start a tunnel first (./scripts/tunnel.sh), then restart the gateway.",
    };
  });
}
