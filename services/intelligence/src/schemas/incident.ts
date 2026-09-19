import { z } from "zod";

/**
 * Canonical incident state shared with the gateway and frontend (see master_plan.md).
 * Fields marked "additive" are extensions owned by the intelligence service; the
 * canonical fields keep the exact names from the master plan.
 */

export const Category = z.enum(["unknown", "medical", "fire", "police", "other"]);
export type Category = z.infer<typeof Category>;

export const Priority = z.enum(["unknown", "low", "medium", "high", "critical"]);
export type Priority = z.infer<typeof Priority>;

export const PRIORITY_RANK: Record<Priority, number> = {
  unknown: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

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

/** Additive: structured clinical assessment the protocol engine reasons over. */
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
  /** Additive: steps whose approved question has already been asked. */
  asked: z.array(z.string()).default([]),
  /** Additive: the last approved prompt AURA spoke, so short answers can be interpreted. */
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
  polyline: z.array(z.tuple([z.number(), z.number()])),
});
export type Route = z.infer<typeof Route>;

/** Additive: prepared (not executed) response plan awaiting human approval. */
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
  /** Verified facts (trigger-confirmed, high-confidence, or mentioned twice). */
  facts: z.array(z.string()).default([]),
  /** Additive: model-only facts awaiting corroboration. */
  unverified_facts: z.array(z.string()).default([]),
  hazards: z.array(z.string()).default([]),
  missing_fields: z.array(z.string()).default([]),
  protocol: ProtocolPointer.default(() => ProtocolPointer.parse({})),
  recommended_services: z.array(Service).default([]),
  confidence: z.number().min(0).max(1).default(0),
  human_required: z.boolean().default(false),
  /** Additive. */
  assessment: Assessment.default(() => Assessment.parse({})),
  /** Additive. */
  response_plan: ResponsePlan.nullable().default(null),
  /** Additive. */
  summary: z.string().default(""),
  /** Additive. */
  updated_at: z.string().default(() => new Date(0).toISOString()),
});
export type IncidentState = z.infer<typeof IncidentState>;

/** Anything the gateway sends back; missing fields are filled with defaults. */
export const PartialIncidentState = IncidentState.partial();
export type PartialIncidentState = z.infer<typeof PartialIncidentState>;

export function createInitialState(sessionId: string, now: Date = new Date()): IncidentState {
  return IncidentState.parse({ session_id: sessionId, updated_at: now.toISOString() });
}

/**
 * Merge a possibly-partial state from the gateway with defaults. Unknown keys are
 * stripped; the session id from the request wins if the state omits it.
 */
export function hydrateState(sessionId: string, partial: unknown, now: Date = new Date()): IncidentState {
  const base = createInitialState(sessionId, now);
  const provided = PartialIncidentState.parse(partial ?? {});
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(provided)) {
    if (value !== undefined) merged[key] = value;
  }
  merged.session_id = sessionId;
  return IncidentState.parse(merged);
}

export function maxPriority(a: Priority, b: Priority): Priority {
  return PRIORITY_RANK[a] >= PRIORITY_RANK[b] ? a : b;
}
