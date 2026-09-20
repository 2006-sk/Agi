/**
 * Canonical events, in the exact shape the command center validates.
 *
 * The console parses every frame with zod and drops anything that fails, with
 * only a console warning. So a field named `timeout` instead of `timeout_s` is
 * not a cosmetic difference — it is an approval gate that never appears on
 * screen. This is the one place those differences are reconciled.
 *
 * Most of the work is renaming between three vocabularies that all grew from
 * the same handoff document:
 *
 *   the intelligence service says   `from` / `to`        (protocol steps)
 *   the gateway says                `approval_id`        (the human gate)
 *   the console says                `previous_step` / `current_step`, `action_id`
 *
 * It also fills fields the console requires but the producers have no reason
 * to know about — `utterance_id` to tie a transcript line to the turn that
 * produced it, `started_at` on a call, `kind` to separate the focused call
 * from ambient ones.
 *
 * Applied at publish time, so the append-only log and the socket never
 * disagree about what an event looked like.
 */

export interface ConsoleContext {
  /** Opening time of the call, for `call.started`. */
  createdAt: string;
  /** Current turn, for tying transcript and speech to an utterance. */
  turnId: string;
  now: string;
}

type Payload = Record<string, unknown>;

const str = (v: unknown, fallback = ""): string => (typeof v === "string" ? v : fallback);
const num = (v: unknown, fallback = 0): number =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** The console's speaker vocabulary: the agent is "agent", never "echo". */
function speaker(v: unknown): "caller" | "agent" {
  return v === "echo" || v === "agent" || v === "assistant" ? "agent" : "caller";
}

/** The console grades risk on the priority scale. */
function risk(v: unknown): "low" | "medium" | "high" | "critical" {
  return v === "low" || v === "medium" || v === "critical" ? v : "high";
}

/**
 * Rewrite one event's payload for the console.
 *
 * Unknown types pass through untouched: they are either already correct or
 * they are the deck vocabulary, which the console ignores by design.
 */
export function toConsolePayload(
  type: string,
  payload: Payload,
  ctx: ConsoleContext,
): Payload {
  switch (type) {
    case "call.started":
      return {
        ...payload,
        caller_label: str(payload.caller_label, "caller"),
        language: str(payload.language, "en"),
        channel: str(payload.channel, "overflow"),
        kind: payload.kind === "ambient" ? "ambient" : "focus",
        started_at: str(payload.started_at, ctx.createdAt),
      };

    case "transcript.partial":
    case "transcript.final":
      return {
        ...payload,
        text: str(payload.text),
        speaker: speaker(payload.speaker),
        confidence: clamp01(num(payload.confidence, 0.9)),
        utterance_id: str(payload.utterance_id, ctx.turnId),
      };

    case "agent.speaking":
      return {
        ...payload,
        text: str(payload.text),
        active: payload.active === true,
        utterance_id: str(payload.utterance_id, ctx.turnId),
      };

    case "agent.interrupted":
      return {
        ...payload,
        interrupted_text: str(payload.interrupted_text ?? payload.text),
        reason: str(payload.reason, "barge_in"),
        utterance_id: str(payload.utterance_id, ctx.turnId),
      };

    case "audio.level":
      return {
        ...payload,
        level: clamp01(num(payload.level)),
        speaker: speaker(payload.speaker),
      };

    case "protocol.changed":
      // The intelligence service names these `from` and `to`.
      return {
        ...payload,
        protocol_id: str(payload.protocol_id, "MED_CARDIAC_01"),
        previous_step: payload.previous_step !== undefined
          ? (payload.previous_step as string | null)
          : ((payload.from as string | null) ?? null),
        current_step: str(payload.current_step ?? payload.to),
        reason: str(payload.reason),
        escalation: payload.escalation === true,
      };

    case "tool.started":
      return { ...payload, tool: str(payload.tool), arguments: (payload.arguments ?? {}) as Payload };

    case "tool.completed":
      // `result` must be present even when a tool returns nothing: the console
      // requires the key, and a missing one costs the whole event.
      return {
        ...payload,
        tool: str(payload.tool),
        result_summary: str(payload.result_summary),
        result: payload.result === undefined ? null : payload.result,
        duration_ms: num(payload.duration_ms),
      };

    case "dispatch.proposed":
      return {
        ...payload,
        action_id: str(payload.action_id, `act_${ctx.turnId}`),
        services: Array.isArray(payload.services) ? payload.services : [],
        units: Array.isArray(payload.units) ? payload.units : [],
        route: payload.route ?? null,
        reason: str(payload.reason),
        // The console only accepts a proposal that admits it needs a human.
        human_required: true,
      };

    case "approval.requested":
      return {
        ...payload,
        action_id: str(payload.action_id ?? payload.approval_id),
        action: str(payload.action, "create_cad_draft"),
        summary: str(payload.summary),
        risk: risk(payload.risk),
        timeout_s: num(payload.timeout_s ?? payload.timeout ?? payload.expires_in_s, 120),
        services: Array.isArray(payload.services) ? payload.services : [],
        units: Array.isArray(payload.units) ? payload.units : [],
        route: payload.route ?? null,
        reason: str(payload.reason),
        proposed_tools: Array.isArray(payload.proposed_tools) ? payload.proposed_tools : [],
        requested_at: str(payload.requested_at, ctx.now),
      };

    case "approval.resolved":
      return {
        ...payload,
        action_id: str(payload.action_id ?? payload.approval_id),
        approved: payload.approved === true,
        reviewer: str(payload.reviewer, "dispatcher"),
        resolved_at: str(payload.resolved_at, ctx.now),
        note: str(payload.note ?? payload.reason) || undefined,
      };

    case "system.degraded":
      return {
        ...payload,
        failed_dependency: str(payload.failed_dependency, "unknown"),
        fallback_mode: str(payload.fallback_mode, "degraded"),
        detail: str(payload.detail ?? payload.message) || undefined,
        active: payload.active === false ? false : true,
      };

    default:
      return payload;
  }
}
