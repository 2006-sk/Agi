import type { FastifyInstance } from "fastify";
import { z } from "zod";

import { CARDIAC_SCRIPT, VAGUE_SCRIPT, type ScriptedUtterance } from "../demo/cardiac.js";
import type { Orchestrator } from "../engine/orchestrator.js";
import { callIdFor, incidentIdFor, type SessionStore } from "../session/store.js";

export interface CallRouteDeps {
  store: SessionStore;
  orchestrator: Orchestrator;
}

const CreateCall = z.object({
  session_id: z.string().min(1).optional(),
  caller_label: z.string().optional(),
  caller_number: z.string().optional(),
  language: z.string().optional(),
  channel: z.string().optional(),
  city: z.string().optional(),
});

const Utterance = z.object({
  text: z.string().min(1),
  speaker: z.enum(["caller", "aura"]).optional().default("caller"),
  language: z.string().optional().default("en"),
  source: z.enum(["voice", "text", "demo", "operator"]).optional().default("voice"),
});

const Approval = z.object({
  approval_id: z.string().optional(),
  approved: z.boolean(),
  reviewer: z.string().optional(),
  reason: z.string().optional(),
});

const Demo = z.object({
  scenario: z.enum(["cardiac", "vague"]).optional().default("cardiac"),
  /** Wait for the whole script before responding. Used by the e2e tests. */
  await_completion: z.boolean().optional().default(false),
  /** Collapse the scripted pauses; the model latency is the real pacing anyway. */
  fast: z.boolean().optional().default(false),
});

const EndCall = z.object({ reason: z.string().optional() });

export async function callRoutes(app: FastifyInstance, deps: CallRouteDeps): Promise<void> {
  const { store, orchestrator } = deps;

  /**
   * Create a call.
   *
   * Accepts a caller-supplied `session_id` on purpose: the deck connects to a
   * fixed id before any call exists, so the demo has to be able to claim that
   * exact id rather than being handed a random one.
   */
  app.post("/api/calls", async (request, reply) => {
    const parsed = CreateCall.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", issues: parsed.error.issues });
    }
    const existing = parsed.data.session_id ? store.get(parsed.data.session_id) : undefined;
    const session = existing ?? store.create(parsed.data);
    if (!existing) orchestrator.openCall(session, { city: parsed.data.city });

    return reply.code(existing ? 200 : 201).send({
      session_id: session.session_id,
      call_id: callIdFor(session.session_id),
      incident_id: incidentIdFor(session.session_id),
      created_at: session.created_at,
      ws: `/ws/calls/${session.session_id}`,
      resumed: Boolean(existing),
    });
  });

  /** Current combined state plus enough log metadata to debug a bad run. */
  app.get("/api/calls/:session_id", async (request, reply) => {
    const { session_id: sessionId } = request.params as { session_id: string };
    const session = store.get(sessionId);
    if (!session) return reply.code(404).send({ error: "unknown_session" });

    return reply.send({
      session_id: session.session_id,
      call_id: callIdFor(session.session_id),
      incident_id: incidentIdFor(session.session_id),
      status: session.status,
      created_at: session.created_at,
      sequence: session.sequence,
      degraded: session.degraded,
      state: session.state,
      pending_approvals: [...session.approvals.values()].filter((a) => !a.resolved),
      events: session.log.length,
    });
  });

  /** The full append-only log. Replay and debugging; the deck uses the socket. */
  app.get("/api/calls/:session_id/events", async (request, reply) => {
    const { session_id: sessionId } = request.params as { session_id: string };
    const session = store.get(sessionId);
    if (!session) return reply.code(404).send({ error: "unknown_session" });
    const since = Number.parseInt(String((request.query as Record<string, unknown>)?.since ?? "0"), 10);
    const from = Number.isFinite(since) ? since : 0;
    return reply.send({
      session_id: sessionId,
      sequence: session.sequence,
      events: session.log.filter((e) => e.sequence > from),
    });
  });

  /**
   * Submit a finalized caller utterance and get AURA's approved reply.
   *
   * Synchronous by contract: the voice service awaits this body and speaks
   * `reply_text` itself, so the whole turn has to complete inside the request.
   */
  app.post("/api/calls/:session_id/utterance", async (request, reply) => {
    const { session_id: sessionId } = request.params as { session_id: string };
    const parsed = Utterance.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", issues: parsed.error.issues });
    }
    // Voice may reach us before anyone created the call; adopting the id beats
    // dropping the caller's first sentence.
    let session = store.get(sessionId);
    if (!session) {
      session = store.create({ session_id: sessionId });
      orchestrator.openCall(session);
    }

    const result = await orchestrator.submitUtterance(session, {
      text: parsed.data.text,
      speaker: parsed.data.speaker,
      language: parsed.data.language,
      source: parsed.data.source,
    });
    return reply.send(result);
  });

  /**
   * The human decision. This is the only door to a consequential action, and
   * the intelligence service refuses the tool with a 403 for anyone who tries
   * to walk around it.
   */
  app.post("/api/calls/:session_id/approval", async (request, reply) => {
    const { session_id: sessionId } = request.params as { session_id: string };
    const parsed = Approval.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", issues: parsed.error.issues });
    }
    const session = store.get(sessionId);
    if (!session) return reply.code(404).send({ error: "unknown_session" });

    const result = await orchestrator.resolveApproval(session, parsed.data);
    if (!result.ok) return reply.code(409).send(result);
    return reply.send({
      ok: true,
      approval_id: result.approval_id,
      approved: parsed.data.approved,
      state: session.state,
    });
  });

  /** Start a deterministic scenario against the real pipeline. */
  app.post("/api/calls/:session_id/demo", async (request, reply) => {
    const { session_id: sessionId } = request.params as { session_id: string };
    const parsed = Demo.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", issues: parsed.error.issues });
    }
    // Always from a clean slate: the deck holds a fixed session id and the demo
    // gets run many times in a row.
    const session = store.has(sessionId)
      ? orchestrator.reset(sessionId)
      : store.create({ session_id: sessionId });
    orchestrator.openCall(session);

    const script = parsed.data.scenario === "vague" ? VAGUE_SCRIPT : CARDIAC_SCRIPT;
    const run = playScript(orchestrator, session, script, parsed.data.fast);

    if (parsed.data.await_completion) {
      await run;
      return reply.send({
        session_id: sessionId,
        scenario: parsed.data.scenario,
        status: "completed",
        sequence: session.sequence,
        state: session.state,
        pending_approvals: [...session.approvals.values()].filter((a) => !a.resolved),
      });
    }
    // Fire and forget so the operator's button returns instantly; failures
    // surface as `system.degraded` on the socket, not as a dangling request.
    void run.catch(() => undefined);
    return reply.code(202).send({
      session_id: sessionId,
      scenario: parsed.data.scenario,
      status: "running",
      lines: script.length,
    });
  });

  /** Wipe a session back to its opening state, keeping the id and the socket. */
  app.post("/api/calls/:session_id/reset", async (request, reply) => {
    const { session_id: sessionId } = request.params as { session_id: string };
    if (!store.has(sessionId)) return reply.code(404).send({ error: "unknown_session" });
    const session = orchestrator.reset(sessionId);
    orchestrator.openCall(session);
    return reply.send({ session_id: sessionId, status: "reset", sequence: session.sequence });
  });

  app.post("/api/calls/:session_id/end", async (request, reply) => {
    const { session_id: sessionId } = request.params as { session_id: string };
    const parsed = EndCall.safeParse(request.body ?? {});
    const session = store.get(sessionId);
    if (!session) return reply.code(404).send({ error: "unknown_session" });
    orchestrator.endCall(session, parsed.success ? parsed.data.reason : "normal");
    return reply.send({ session_id: sessionId, status: "ended" });
  });
}

async function playScript(
  orchestrator: Orchestrator,
  session: Parameters<Orchestrator["submitUtterance"]>[0],
  script: ScriptedUtterance[],
  fast: boolean,
): Promise<void> {
  for (const line of script) {
    if (!fast && line.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, line.delayMs));
    }
    await orchestrator.submitUtterance(session, {
      text: line.text,
      speaker: "caller",
      language: "en",
      source: "demo",
    });
  }
}
