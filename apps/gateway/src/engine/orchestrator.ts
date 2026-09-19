import { randomUUID } from "node:crypto";

import {
  CANON_EVENT,
  VIEW_EVENT,
  type AuraEvent,
  type IncidentState,
  type UnsequencedEvent,
  type UtteranceReply,
} from "@aura/contracts";

import type { GatewayConfig } from "../config.js";
import {
  initialProjection,
  project,
  routeIdFor,
  type ProjectionState,
} from "../adapter/toFrontend.js";
import {
  IntelligenceError,
  type IntelligenceClient,
  type ToolProposal,
} from "../clients/intelligence.js";
import type { VoiceClient } from "../clients/voice.js";
import { EventHub } from "../bus/hub.js";
import { SessionQueue } from "../session/queue.js";
import {
  callIdFor,
  incidentIdFor,
  SessionStore,
  type PendingApproval,
  type Session,
} from "../session/store.js";

export interface Logger {
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

const NOOP_LOGGER: Logger = { info() {}, warn() {}, error() {} };

/** Spoken when the intelligence service cannot be reached at all. */
export const SAFE_FALLBACK_LINE =
  "Please stay on the line while I connect you to a dispatcher.";

export interface OrchestratorDeps {
  store: SessionStore;
  hub: EventHub;
  intelligence: IntelligenceClient;
  voice: VoiceClient;
  config: GatewayConfig;
  logger?: Logger;
  now?: () => Date;
}

export interface UtteranceInput {
  text: string;
  speaker: "caller" | "aura";
  language: string;
  source: "voice" | "text" | "demo" | "operator";
}

/**
 * The turn engine.
 *
 * Owns the single path from "caller said something" to "the deck shows it and
 * AURA answers", plus the human-approval gate that no consequential action can
 * go around. Everything that reaches the frontend is sequenced here, so ordering
 * is a property of this file rather than of whichever service happened to be
 * fast that second.
 */
export class Orchestrator {
  private readonly store: SessionStore;
  private readonly hub: EventHub;
  private readonly intelligence: IntelligenceClient;
  private readonly voice: VoiceClient;
  private readonly config: GatewayConfig;
  private readonly log: Logger;
  private readonly now: () => Date;
  private readonly queue = new SessionQueue();
  private readonly projections = new Map<string, ProjectionState>();

  constructor(deps: OrchestratorDeps) {
    this.store = deps.store;
    this.hub = deps.hub;
    this.intelligence = deps.intelligence;
    this.voice = deps.voice;
    this.config = deps.config;
    this.log = deps.logger ?? NOOP_LOGGER;
    this.now = deps.now ?? (() => new Date());
  }

  /* ---------------------------------------------------------------- */
  /* Publishing                                                        */
  /* ---------------------------------------------------------------- */

  private projection(session: Session): ProjectionState {
    let p = this.projections.get(session.session_id);
    if (!p) {
      p = initialProjection(
        callIdFor(session.session_id),
        incidentIdFor(session.session_id),
      );
      this.projections.set(session.session_id, p);
    }
    return p;
  }

  private event(
    session: Session,
    type: string,
    payload: Record<string, unknown>,
  ): UnsequencedEvent {
    return {
      event_id: `evt_${randomUUID()}`,
      session_id: session.session_id,
      type,
      timestamp: this.now().toISOString(),
      payload,
    };
  }

  /**
   * Seal one event into the log and fan it out, then do the same for whatever
   * deck events it implies.
   *
   * Canonical first, derived second: the log reads as the backend's own story,
   * and the deck's finer-grained view always trails the fact it came from.
   */
  publish(session: Session, event: UnsequencedEvent): AuraEvent[] {
    const sealed = this.store.append(session, event);
    this.hub.broadcast(session.session_id, sealed);
    const out: AuraEvent[] = [sealed];

    const { events, state } = project(
      sealed.type,
      sealed.payload,
      this.projection(session),
    );
    this.projections.set(session.session_id, state);

    for (const derived of events) {
      // A name shared by both vocabularies was already delivered above; emitting
      // the derived twin would double-apply it on the deck.
      if (derived.type === sealed.type) continue;
      const sealedDerived = this.store.append(
        session,
        this.event(session, derived.type, derived.payload),
      );
      this.hub.broadcast(session.session_id, sealedDerived);
      out.push(sealedDerived);
    }
    return out;
  }

  /** Publish a producer event that arrived pre-enveloped (voice, intelligence). */
  publishRaw(
    session: Session,
    event: {
      event_id?: string;
      type: string;
      timestamp?: string;
      payload?: Record<string, unknown>;
    },
  ): AuraEvent[] {
    return this.publish(session, {
      event_id: event.event_id || `evt_${randomUUID()}`,
      session_id: session.session_id,
      type: event.type,
      timestamp: event.timestamp || this.now().toISOString(),
      payload: event.payload ?? {},
    });
  }

  /* ---------------------------------------------------------------- */
  /* Session lifecycle                                                 */
  /* ---------------------------------------------------------------- */

  /**
   * Announce a session to the deck.
   *
   * `session.started` must be first and must be sequence 1: the deck treats it
   * as a hard reset of its ingest baseline, which is exactly what makes a replay
   * after reconnect line up.
   */
  openCall(session: Session, opts: { city?: string } = {}): void {
    this.projections.set(
      session.session_id,
      initialProjection(
        callIdFor(session.session_id),
        incidentIdFor(session.session_id),
      ),
    );
    this.publish(
      session,
      this.event(session, VIEW_EVENT.SessionStarted, {
        session_id: session.session_id,
        city: opts.city ?? "Bayside",
      }),
    );
    this.publish(
      session,
      this.event(session, CANON_EVENT.CallStarted, {
        call_id: callIdFor(session.session_id),
        caller_label: session.caller_label,
        caller_number: session.caller_number,
        language: session.language,
        channel: session.channel,
      }),
    );
  }

  endCall(session: Session, reason = "normal"): void {
    session.status = "ended";
    if (session.dispatchTimer) {
      clearInterval(session.dispatchTimer);
      session.dispatchTimer = null;
    }
    // `call.ended` exists in both vocabularies; one event carries both fields.
    this.publish(
      session,
      this.event(session, CANON_EVENT.CallEnded, {
        call_id: callIdFor(session.session_id),
        reason,
      }),
    );
  }

  reset(sessionId: string): Session {
    const fresh = this.store.reset(sessionId);
    this.projections.delete(sessionId);
    this.queue.clear(sessionId);
    return fresh;
  }

  /* ---------------------------------------------------------------- */
  /* Voice fan-in                                                      */
  /* ---------------------------------------------------------------- */

  /**
   * Accept an event from the voice service.
   *
   * Voice owns the audio truth (who is speaking, what was heard, when TTS was
   * cut off); the gateway only sequences it and notes the two facts it needs for
   * its own decisions: whether AURA currently has the floor, and whether the
   * voice layer is failing.
   */
  ingestVoiceEvent(
    session: Session,
    event: {
      event_id?: string;
      type: string;
      timestamp?: string;
      payload?: Record<string, unknown>;
    },
  ): AuraEvent[] {
    const payload = { ...(event.payload ?? {}) };

    if (event.type === CANON_EVENT.AgentSpeaking) {
      session.agentSpeaking = payload.active === true;
    } else if (event.type === CANON_EVENT.AgentInterrupted) {
      session.agentSpeaking = false;
    } else if (event.type === CANON_EVENT.VoiceError) {
      if (payload.recoverable === false) {
        this.degrade(session, "gradium", "text_mode");
      }
    }

    // The deck needs a call id on transcript and level frames; voice does not
    // know about deck ids, so they are stamped here rather than upstream.
    if (
      event.type === CANON_EVENT.TranscriptFinal ||
      event.type === CANON_EVENT.TranscriptPartial ||
      event.type === CANON_EVENT.AudioLevel ||
      event.type === CANON_EVENT.CallEnded
    ) {
      payload.call_id = callIdFor(session.session_id);
      if (!payload.turn_id) payload.turn_id = session.latestTurn ?? "turn_0";
    }

    return this.publishRaw(session, { ...event, payload });
  }

  /* ---------------------------------------------------------------- */
  /* The turn                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * Run one caller utterance end to end.
   *
   * Serialized per session: the intelligence service is stateless and the whole
   * incident state round-trips through it, so two concurrent turns would each
   * analyse against a state that is missing the other's facts.
   */
  submitUtterance(
    session: Session,
    input: UtteranceInput,
  ): Promise<UtteranceReply> {
    return this.queue.run(session.session_id, () => this.runTurn(session, input));
  }

  private async runTurn(
    session: Session,
    input: UtteranceInput,
  ): Promise<UtteranceReply> {
    const turnId = this.store.beginTurn(session);

    // Barge-in: the caller talking over AURA outranks whatever AURA was saying.
    if (session.agentSpeaking) {
      session.agentSpeaking = false;
      await this.voice.cancel(session.session_id, "barge_in");
    }

    // Voice and text-mode callers already published their own transcript; the
    // demo runner and the operator console have not.
    const selfPublished = input.source === "voice" || input.source === "text";
    if (!selfPublished) {
      this.publish(
        session,
        this.event(session, CANON_EVENT.TranscriptFinal, {
          call_id: callIdFor(session.session_id),
          turn_id: turnId,
          speaker: input.speaker,
          text: input.text,
          confidence: 1,
          language: input.language,
        }),
      );
    }

    let replyText = SAFE_FALLBACK_LINE;
    try {
      const response = await this.intelligence.analyze({
        session_id: session.session_id,
        utterance: input.text,
        current_state: (session.state ?? {}) as unknown as Record<string, unknown>,
        conversation_summary: session.summaryParts.slice(-6).join(" "),
      });

      // Apply state even for a superseded turn: the next turn analyses against
      // it, and dropping it would lose facts the caller already gave us.
      session.state = response.state;
      if (response.explanation) session.summaryParts.push(response.explanation);

      for (const event of response.events) {
        this.publishRaw(session, event);
      }

      this.trackDegradation(session, response.meta.source);
      this.maybeRaiseApproval(session, response);

      replyText = response.next_response || SAFE_FALLBACK_LINE;
      this.log.info(
        {
          session_id: session.session_id,
          turn_id: turnId,
          source: response.meta.source,
          validation: response.meta.validation,
          model_latency_ms: response.meta.model_latency_ms,
          priority: response.state.priority,
          step: response.state.protocol.step,
        },
        "turn analysed",
      );
    } catch (error) {
      const err = error as IntelligenceError;
      this.log.error(
        {
          session_id: session.session_id,
          turn_id: turnId,
          status: err.status,
          err: err.message,
        },
        "analysis failed",
      );
      this.degrade(session, "intelligence", "scripted_fallback");
    }

    // A turn that has been overtaken must not speak: its answer belongs to a
    // question the caller has already moved past.
    if (!this.store.isCurrentTurn(session, turnId)) {
      this.log.warn(
        { session_id: session.session_id, turn_id: turnId },
        "turn superseded; reply discarded",
      );
      return {
        session_id: session.session_id,
        turn_id: turnId,
        reply_text: null,
        superseded: true,
      };
    }

    // Voice callers speak the HTTP response themselves. Pushing TTS as well
    // would make AURA say every line twice.
    if (!selfPublished) {
      this.publish(
        session,
        this.event(session, CANON_EVENT.AgentSpeaking, {
          text: replyText,
          active: true,
          turn_id: turnId,
        }),
      );
      await this.voice.speak(session.session_id, replyText);
    }

    return {
      session_id: session.session_id,
      turn_id: turnId,
      reply_text: replyText,
      superseded: false,
    };
  }

  /* ---------------------------------------------------------------- */
  /* Approval gate                                                     */
  /* ---------------------------------------------------------------- */

  /**
   * Turn an intelligence dispatch proposal into a human decision point.
   *
   * The gate is withheld rather than auto-approved when the incident is not
   * ready (no verified location): sending an ambulance to an address nobody
   * confirmed is the exact failure this project exists to prevent.
   */
  private maybeRaiseApproval(
    session: Session,
    response: {
      events: AuraEvent[];
      proposed_tools: ToolProposal[];
      state: IncidentState;
    },
  ): void {
    const proposal = response.events.find(
      (e) => e.type === CANON_EVENT.DispatchProposed,
    );
    if (!proposal) return;

    const payload = proposal.payload as Record<string, unknown>;
    const actionId =
      typeof payload.action_id === "string"
        ? payload.action_id
        : `act_${randomUUID().slice(0, 8)}`;
    if (session.approvals.has(actionId)) return;

    const consequential =
      response.proposed_tools.find((t) => t.human_required) ??
      response.proposed_tools.find((t) => t.name === "create_cad_draft");
    if (!consequential) {
      this.log.warn(
        { session_id: session.session_id, action_id: actionId },
        "dispatch proposed with no consequential tool; no gate raised",
      );
      return;
    }

    const location = response.state.location;
    if (!location?.verified) {
      this.log.warn(
        { session_id: session.session_id },
        "dispatch proposed without a verified location; gate withheld",
      );
      return;
    }

    const plan = response.state.response_plan;
    const unitId = plan?.route?.unit_id ?? plan?.units?.[0]?.unit_id ?? "";

    this.raiseApproval(session, {
      approval_id: actionId,
      tool: { name: consequential.name, arguments: consequential.arguments ?? {} },
      summary: summarize(response.state, payload),
      unit_id: unitId,
      reason: consequential.reason,
    });
  }

  /**
   * Open the human gate.
   *
   * Public because both brains reach it: the AURA protocol machine raises it
   * from a `dispatch.proposed`, and in Vapi mode the agent reaches it by
   * calling the `request_dispatch` tool. There is exactly one gate either way.
   */
  raiseApproval(
    session: Session,
    input: {
      approval_id: string;
      tool: { name: string; arguments: Record<string, unknown> };
      summary: string;
      unit_id: string;
      reason: string;
    },
  ): PendingApproval {
    const existing = session.approvals.get(input.approval_id);
    if (existing) return existing;

    const approval: PendingApproval = {
      approval_id: input.approval_id,
      tool: input.tool,
      summary: input.summary,
      unit_id: input.unit_id,
      route_id: input.unit_id ? routeIdFor(this.projection(session), input.unit_id) : "",
      requested_at: this.now().toISOString(),
      resolved: false,
    };
    session.approvals.set(approval.approval_id, approval);

    // `approval.requested` is in both vocabularies: one event, both field sets.
    this.publish(
      session,
      this.event(session, CANON_EVENT.ApprovalRequested, {
        action: approval.tool.name,
        risk: "high",
        timeout: this.config.approvalTimeoutS,
        reason: input.reason,
        incident_id: incidentIdFor(session.session_id),
        approval_id: approval.approval_id,
        summary: approval.summary,
        unit_id: approval.unit_id,
        route_id: approval.route_id,
        expires_in_s: this.config.approvalTimeoutS,
      }),
    );
    return approval;
  }

  /**
   * Record a human decision and, on approval, actually run the gated tool.
   *
   * The 403 from the intelligence service is the real gate; this method is the
   * only thing in the system that is allowed to send `approved: true`, and it
   * only does so after a reviewer said yes.
   */
  async resolveApproval(
    session: Session,
    input: {
      approval_id?: string;
      approved: boolean;
      reviewer?: string;
      reason?: string;
    },
  ): Promise<{ ok: true; approval_id: string } | { ok: false; error: string }> {
    // With no id supplied, target the open gate. If every gate is already
    // closed, fall through to the most recent one so an operator who
    // double-clicks Approve is told "already resolved" rather than the
    // misleading "nothing pending".
    const all = [...session.approvals.values()];
    const approvalId =
      input.approval_id ?? (all.find((a) => !a.resolved) ?? all.at(-1))?.approval_id;
    if (!approvalId) return { ok: false, error: "no_pending_approval" };

    const approval = session.approvals.get(approvalId);
    if (!approval) return { ok: false, error: "unknown_approval" };
    if (approval.resolved) return { ok: false, error: "already_resolved" };

    approval.resolved = true;
    const reviewer = input.reviewer ?? "operator";
    const incidentId = incidentIdFor(session.session_id);

    // Ordering matters. The deck applies its own optimistic `approval.granted`
    // the instant the operator clicks, consuming one sequence slot; the
    // canonical `approval.resolved` lands in that slot and is dropped as stale,
    // which is exactly right because the deck already knows. Everything after it
    // arrives in order.
    this.publish(
      session,
      this.event(session, CANON_EVENT.ApprovalResolved, {
        approval_id: approvalId,
        approved: input.approved,
        reviewer,
        reason: input.reason ?? "",
        action: approval.tool.name,
      }),
    );
    this.publish(
      session,
      this.event(
        session,
        input.approved ? VIEW_EVENT.ApprovalGranted : VIEW_EVENT.ApprovalRejected,
        {
          incident_id: incidentId,
          approval_id: approvalId,
          by: reviewer,
          reason: input.reason ?? "",
        },
      ),
    );

    if (!input.approved) {
      this.log.info(
        { session_id: session.session_id, approval_id: approvalId },
        "dispatch rejected by reviewer",
      );
      return { ok: true, approval_id: approvalId };
    }

    try {
      const result = await this.intelligence.executeTool({
        session_id: session.session_id,
        tool: approval.tool,
        current_state: (session.state ?? {}) as unknown as Record<string, unknown>,
        approved: true,
        reviewer,
      });
      session.state = result.state;
      for (const event of result.events) {
        this.publishRaw(session, event);
      }
      this.startDispatchRun(session, approval);
      this.log.info(
        {
          session_id: session.session_id,
          approval_id: approvalId,
          cad_id: result.state.response_plan?.cad_id,
        },
        "dispatch approved and executed",
      );
    } catch (error) {
      const err = error as IntelligenceError;
      this.log.error(
        { session_id: session.session_id, err: err.message, status: err.status },
        "approved tool failed",
      );
      // Never pretend a dispatch succeeded. Say so on the rail and degrade.
      this.publish(
        session,
        this.event(session, CANON_EVENT.ToolCompleted, {
          tool: approval.tool.name,
          result: null,
          result_summary: `failed: ${err.message}`,
          duration_ms: 0,
        }),
      );
      this.degrade(session, "intelligence", "dispatch_unconfirmed");
    }

    return { ok: true, approval_id: approvalId };
  }

  /**
   * Animate the approved unit along its route.
   *
   * Nothing upstream produces this: the intelligence service creates a CAD
   * record and stops, because in a real system the vehicle's movement comes from
   * telemetry. For the demo the gateway simulates it, and only ever after an
   * approval, so a responder can never be seen moving before a human said yes.
   */
  private startDispatchRun(session: Session, approval: PendingApproval): void {
    if (!approval.unit_id) return;
    if (session.dispatchTimer) clearInterval(session.dispatchTimer);

    const incidentId = incidentIdFor(session.session_id);
    this.publish(
      session,
      this.event(session, VIEW_EVENT.DispatchStarted, {
        incident_id: incidentId,
        unit_id: approval.unit_id,
        route_id: approval.route_id,
      }),
    );

    const started = Date.now();
    const timer = setInterval(() => {
      const elapsed = Date.now() - started;
      const progress = Math.min(1, elapsed / this.config.dispatchTravelMs);
      this.publish(
        session,
        this.event(session, VIEW_EVENT.DispatchProgress, {
          incident_id: incidentId,
          unit_id: approval.unit_id,
          progress: Math.round(progress * 1000) / 1000,
        }),
      );
      if (progress >= 1) {
        clearInterval(timer);
        if (session.dispatchTimer === timer) session.dispatchTimer = null;
        this.publish(
          session,
          this.event(session, VIEW_EVENT.DispatchArrived, {
            incident_id: incidentId,
            unit_id: approval.unit_id,
          }),
        );
      }
    }, this.config.dispatchTickMs);

    // Never hold the process open for an animation.
    timer.unref?.();
    session.dispatchTimer = timer;
  }

  /* ---------------------------------------------------------------- */
  /* Degradation                                                       */
  /* ---------------------------------------------------------------- */

  private trackDegradation(session: Session, source: string): void {
    if (source === "fallback") {
      session.fallbackStreak += 1;
      if (session.fallbackStreak >= this.config.degradeAfterFallbacks) {
        this.degrade(session, "general_compute", "deterministic_extraction");
      }
    } else {
      session.fallbackStreak = 0;
    }
  }

  /** Announce a degraded dependency once per session, not once per failure. */
  degrade(session: Session, dependency: string, mode: string): void {
    if (session.degraded) return;
    session.degraded = true;
    this.publish(
      session,
      this.event(session, CANON_EVENT.SystemDegraded, {
        failed_dependency: dependency,
        fallback_mode: mode,
        message: `${dependency} unavailable — continuing in ${mode}`,
      }),
    );
  }
}

function summarize(
  state: IncidentState,
  payload: Record<string, unknown>,
): string {
  const services = Array.isArray(payload.services)
    ? payload.services.join(", ")
    : "EMS";
  const unit =
    state.response_plan?.route?.unit_id ??
    state.response_plan?.units?.[0]?.unit_id ??
    "nearest unit";
  const eta = state.response_plan?.route?.eta_minutes;
  const where = state.location.normalized ?? state.location.raw ?? "the reported address";
  const etaText = typeof eta === "number" ? `, ETA ${eta} min` : "";
  return `Dispatch ${services} (${unit}) to ${where}${etaText}`;
}
