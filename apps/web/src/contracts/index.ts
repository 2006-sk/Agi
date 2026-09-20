/**
 * Shared event contract from master_plan.md, as the frontend consumes it.
 *
 * Shresth owns the canonical `packages/contracts`; this file mirrors the plan so
 * the web app can be built and demoed against the mock stream before the
 * backend lands. Fields marked "additive" are optional extras the UI will show
 * when a producer emits them and ignores otherwise.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Canonical incident state
// ---------------------------------------------------------------------------

export const Category = z.enum(["unknown", "medical", "fire", "police", "other"]);
export type Category = z.infer<typeof Category>;

export const Priority = z.enum(["unknown", "low", "medium", "high", "critical"]);
export type Priority = z.infer<typeof Priority>;

export const PRIORITY_RANK: Record<Priority, number> = { unknown: 0, low: 1, medium: 2, high: 3, critical: 4 };

export const IncidentStatus = z.enum(["active", "awaiting_approval", "dispatched", "closed"]);
export type IncidentStatus = z.infer<typeof IncidentStatus>;

export const Service = z.enum(["EMS", "FIRE", "POLICE"]);
export type Service = z.infer<typeof Service>;

export const TriState = z.enum(["yes", "no", "unknown"]);
export type TriState = z.infer<typeof TriState>;

export const BreathingState = z.enum(["normal", "labored", "no", "unknown"]);
export type BreathingState = z.infer<typeof BreathingState>;

export const Location = z.object({
  raw: z.string().nullable().default(null),
  normalized: z.string().nullable().default(null),
  latitude: z.number().nullable().default(null),
  longitude: z.number().nullable().default(null),
  confidence: z.number().min(0).max(1).default(0),
  verified: z.boolean().default(false),
});
export type Location = z.infer<typeof Location>;

export const Assessment = z.object({
  chief_complaint: z.string().nullable().default(null),
  conscious: TriState.default("unknown"),
  breathing: BreathingState.default("unknown"),
  hazards_checked: z.boolean().default(false),
});
export type Assessment = z.infer<typeof Assessment>;

export const ProtocolPointer = z.object({
  id: z.string().nullable().default(null),
  step: z.string().nullable().default(null),
  asked: z.array(z.string()).default([]),
  last_prompt: z.string().nullable().default(null),
});
export type ProtocolPointer = z.infer<typeof ProtocolPointer>;

export const ResponderUnit = z.object({
  unit_id: z.string(),
  service: Service,
  type: z.string(),
  station: z.string(),
  latitude: z.number(),
  longitude: z.number(),
  status: z.enum(["available", "en_route", "busy"]),
  distance_km: z.number(),
  eta_minutes: z.number(),
});
export type ResponderUnit = z.infer<typeof ResponderUnit>;

export const Route = z.object({
  unit_id: z.string(),
  distance_km: z.number(),
  eta_minutes: z.number(),
  /** [latitude, longitude] pairs; first = unit, last = incident. */
  polyline: z.array(z.tuple([z.number(), z.number()])),
});
export type Route = z.infer<typeof Route>;

export const ResponsePlan = z.object({
  services: z.array(Service),
  units: z.array(ResponderUnit),
  route: Route.nullable(),
  reason: z.string(),
  proposed_at: z.string(),
  cad_id: z.string().nullable().default(null),
});
export type ResponsePlan = z.infer<typeof ResponsePlan>;

export const IncidentState = z.object({
  session_id: z.string().min(1),
  category: Category.default("unknown"),
  priority: Priority.default("unknown"),
  status: IncidentStatus.default("active"),
  location: Location.default(() => Location.parse({})),
  people_at_risk: z.number().int().min(0).nullable().default(null),
  facts: z.array(z.string()).default([]),
  unverified_facts: z.array(z.string()).default([]),
  hazards: z.array(z.string()).default([]),
  missing_fields: z.array(z.string()).default([]),
  protocol: ProtocolPointer.default(() => ProtocolPointer.parse({})),
  recommended_services: z.array(Service).default([]),
  confidence: z.number().min(0).max(1).default(0),
  human_required: z.boolean().default(false),
  assessment: Assessment.default(() => Assessment.parse({})),
  response_plan: ResponsePlan.nullable().default(null),
  summary: z.string().default(""),
  updated_at: z.string().default(() => new Date(0).toISOString()),
});
export type IncidentState = z.infer<typeof IncidentState>;

export function createInitialState(sessionId: string, now: Date = new Date()): IncidentState {
  return IncidentState.parse({ session_id: sessionId, updated_at: now.toISOString() });
}

// ---------------------------------------------------------------------------
// Protocol catalogue (protocols are configuration, never model output)
// ---------------------------------------------------------------------------

export const PROTOCOL_STEPS: Record<string, readonly string[]> = {
  MED_CARDIAC_01: ["verify_location", "identify_problem", "conscious_check", "breathing_check", "collect_hazards", "prepare_response", "human_dispatch_approval"],
  GENERAL_INTAKE_01: ["verify_location", "identify_problem", "prepare_response", "human_dispatch_approval"],
};

export const PROTOCOL_NAMES: Record<string, string> = {
  MED_CARDIAC_01: "Medical intake: cardiac / breathing",
  GENERAL_INTAKE_01: "General intake",
};

export const STEP_LABELS: Record<string, string> = {
  verify_location: "Verify location",
  identify_problem: "Identify problem",
  conscious_check: "Consciousness check",
  breathing_check: "Breathing check",
  collect_hazards: "Scene hazards",
  prepare_response: "Prepare response",
  human_dispatch_approval: "Human dispatch approval",
};

// ---------------------------------------------------------------------------
// Event envelope
// ---------------------------------------------------------------------------

export const EVENT_TYPES = [
  "call.started",
  "audio.level",
  "transcript.partial",
  "transcript.final",
  "agent.speaking",
  "agent.interrupted",
  "incident.updated",
  "protocol.changed",
  "tool.started",
  "tool.completed",
  "dispatch.proposed",
  "approval.requested",
  "approval.resolved",
  "system.degraded",
  // additive
  "analysis.started",
  "analysis.completed",
  "system.reset",
] as const;

export const EventType = z.enum(EVENT_TYPES);
export type EventType = z.infer<typeof EventType>;

export const EventEnvelope = z.object({
  event_id: z.string(),
  session_id: z.string(),
  type: EventType,
  timestamp: z.string(),
  sequence: z.number().int(),
  payload: z.record(z.string(), z.unknown()),
});
export type EventEnvelope = z.infer<typeof EventEnvelope>;

// ---------------------------------------------------------------------------
// Payloads
// ---------------------------------------------------------------------------

export const Speaker = z.enum(["caller", "agent"]);
export type Speaker = z.infer<typeof Speaker>;

export const CallStartedPayload = z.object({
  caller_label: z.string(),
  language: z.string().default("en-US"),
  channel: z.string().default("overflow"),
  /** additive: ambient calls are background incidents that light up the city */
  kind: z.enum(["focus", "ambient"]).default("focus"),
  started_at: z.string(),
});
export type CallStartedPayload = z.infer<typeof CallStartedPayload>;

export const AudioLevelPayload = z.object({ level: z.number().min(0).max(1), speaker: Speaker });
export type AudioLevelPayload = z.infer<typeof AudioLevelPayload>;

export const TranscriptPayload = z.object({
  text: z.string(),
  speaker: Speaker,
  confidence: z.number().min(0).max(1),
  utterance_id: z.string(),
});
export type TranscriptPayload = z.infer<typeof TranscriptPayload>;

export const AgentSpeakingPayload = z.object({
  text: z.string(),
  active: z.boolean(),
  utterance_id: z.string(),
  estimated_duration_ms: z.number().optional(),
});
export type AgentSpeakingPayload = z.infer<typeof AgentSpeakingPayload>;

export const AgentInterruptedPayload = z.object({
  interrupted_text: z.string(),
  reason: z.string(),
  utterance_id: z.string(),
});
export type AgentInterruptedPayload = z.infer<typeof AgentInterruptedPayload>;

export const ProtocolChangedPayload = z.object({
  protocol_id: z.string(),
  previous_step: z.string().nullable(),
  current_step: z.string(),
  reason: z.string(),
  escalation: z.boolean(),
});
export type ProtocolChangedPayload = z.infer<typeof ProtocolChangedPayload>;

export const ToolStartedPayload = z.object({ tool: z.string(), arguments: z.record(z.string(), z.unknown()) });
export type ToolStartedPayload = z.infer<typeof ToolStartedPayload>;

export const ToolCompletedPayload = z.object({
  tool: z.string(),
  result_summary: z.string(),
  result: z.unknown(),
  duration_ms: z.number(),
});
export type ToolCompletedPayload = z.infer<typeof ToolCompletedPayload>;

export const DispatchProposedPayload = z.object({
  action_id: z.string(),
  services: z.array(z.string()),
  units: z.array(ResponderUnit),
  route: Route.nullable(),
  reason: z.string(),
  human_required: z.literal(true),
});
export type DispatchProposedPayload = z.infer<typeof DispatchProposedPayload>;

export const ProposedTool = z.object({
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()),
  human_required: z.boolean().default(true),
  reason: z.string(),
});
export type ProposedTool = z.infer<typeof ProposedTool>;

export const ApprovalRequestedPayload = z.object({
  action_id: z.string(),
  action: z.string(),
  summary: z.string().default(""),
  risk: z.enum(["low", "medium", "high", "critical"]).default("high"),
  timeout_s: z.number().default(120),
  services: z.array(z.string()).default([]),
  units: z.array(ResponderUnit).default([]),
  route: Route.nullable().default(null),
  reason: z.string().default(""),
  proposed_tools: z.array(ProposedTool).default([]),
  requested_at: z.string().default(() => new Date().toISOString()),
});
export type ApprovalRequestedPayload = z.infer<typeof ApprovalRequestedPayload>;

export const ApprovalResolvedPayload = z.object({
  action_id: z.string().default(""),
  approved: z.boolean(),
  reviewer: z.string().default("dispatcher"),
  resolved_at: z.string().default(() => new Date().toISOString()),
  note: z.string().optional(),
});
export type ApprovalResolvedPayload = z.infer<typeof ApprovalResolvedPayload>;

export const SystemDegradedPayload = z.object({
  failed_dependency: z.string(),
  fallback_mode: z.string(),
  detail: z.string().optional(),
  /** false clears a previous degradation */
  active: z.boolean().default(true),
});
export type SystemDegradedPayload = z.infer<typeof SystemDegradedPayload>;

/** additive: a final utterance was handed to the intelligence service */
export const AnalysisStartedPayload = z.object({ utterance_id: z.string(), text: z.string() });
export type AnalysisStartedPayload = z.infer<typeof AnalysisStartedPayload>;

export const AnalysisMeta = z.object({
  model: z.string(),
  model_latency_ms: z.number().nullable(),
  source: z.enum(["model", "fallback", "mock", "none"]),
  validation: z.enum(["ok", "retried", "fallback", "low_confidence"]),
  attempts: z.number().int(),
  triggers_matched: z.array(z.string()),
  rejected: z.array(z.string()),
  total_latency_ms: z.number(),
});
export type AnalysisMeta = z.infer<typeof AnalysisMeta>;

/** additive: per-turn diagnostics for the reasoning / confidence panel */
export const AnalysisCompletedPayload = z.object({
  utterance_id: z.string(),
  confidence: z.number().min(0).max(1),
  explanation: z.string(),
  next_response: z.string(),
  protocol_transition: z
    .object({ protocol_id: z.string(), from: z.string().nullable(), to: z.string(), reason: z.string(), escalation: z.boolean() })
    .nullable(),
  proposed_tools: z.array(ProposedTool),
  meta: AnalysisMeta,
  degraded: z.boolean().default(false),
});
export type AnalysisCompletedPayload = z.infer<typeof AnalysisCompletedPayload>;

/** additive: all sessions were cleared (demo restart) */
export const SystemResetPayload = z.object({ reason: z.string().default("demo_reset") });
export type SystemResetPayload = z.infer<typeof SystemResetPayload>;

export const PAYLOAD_SCHEMAS = {
  "call.started": CallStartedPayload,
  "audio.level": AudioLevelPayload,
  "transcript.partial": TranscriptPayload,
  "transcript.final": TranscriptPayload,
  "agent.speaking": AgentSpeakingPayload,
  "agent.interrupted": AgentInterruptedPayload,
  "incident.updated": IncidentState,
  "protocol.changed": ProtocolChangedPayload,
  "tool.started": ToolStartedPayload,
  "tool.completed": ToolCompletedPayload,
  "dispatch.proposed": DispatchProposedPayload,
  "approval.requested": ApprovalRequestedPayload,
  "approval.resolved": ApprovalResolvedPayload,
  "system.degraded": SystemDegradedPayload,
  "analysis.started": AnalysisStartedPayload,
  "analysis.completed": AnalysisCompletedPayload,
  "system.reset": SystemResetPayload,
} as const satisfies Record<EventType, z.ZodType>;

export type PayloadOf<T extends EventType> = z.infer<(typeof PAYLOAD_SCHEMAS)[T]>;

type EnvelopeBase = Omit<EventEnvelope, "type" | "payload">;

/** Envelope narrowed by `type`, with a validated payload. */
export type TypedEvent = { [T in EventType]: EnvelopeBase & { type: T; payload: PayloadOf<T> } }[EventType];

export type ParseEventResult = { ok: true; event: TypedEvent } | { ok: false; error: string };

/** Validate a raw envelope and its payload. Never throws. */
export function parseEvent(raw: unknown): ParseEventResult {
  const envelope = EventEnvelope.safeParse(raw);
  if (!envelope.success) return { ok: false, error: `invalid envelope: ${envelope.error.message}` };
  const schema = PAYLOAD_SCHEMAS[envelope.data.type];
  const payload = schema.safeParse(envelope.data.payload);
  if (!payload.success) return { ok: false, error: `invalid ${envelope.data.type} payload: ${payload.error.message}` };
  return { ok: true, event: { ...envelope.data, payload: payload.data } as TypedEvent };
}

/** High-frequency events that are not worth persisting or replaying. */
export const EPHEMERAL_EVENT_TYPES: ReadonlySet<EventType> = new Set<EventType>(["audio.level"]);
