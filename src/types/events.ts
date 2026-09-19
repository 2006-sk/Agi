/**
 * AURA event contract.
 *
 * The backend gateway (Shresth's service) emits a normalized envelope. This file is
 * the single source of truth for that envelope and for every payload the frontend
 * knows how to visualize.
 *
 * Rules the whole app obeys:
 *  - Unknown `type` values are ignored, never thrown on.
 *  - Duplicate `event_id` values are ignored.
 *  - Events are applied in `sequence` order so animations never move backward.
 */

/** The wire envelope. Do not change shape — it is the integration contract. */
export type AuraEvent = {
  event_id: string;
  session_id: string;
  type: string;
  timestamp: string;
  sequence: number;
  payload: Record<string, unknown>;
};

/* ------------------------------------------------------------------ */
/* Domain vocabulary                                                   */
/* ------------------------------------------------------------------ */

export type IncidentCategory = 'medical' | 'fire' | 'police' | 'unknown';

export type Priority = 'unknown' | 'low' | 'medium' | 'high' | 'critical';

export type Speaker = 'caller' | 'aura';

export type ResponderKind = 'ems' | 'fire' | 'police';

export type ToolStatus = 'pending' | 'ok' | 'error';

export type ProtocolStepStatus = 'idle' | 'active' | 'done' | 'blocked';

/** A point on the city plane. World units, XZ plane, Y is up. */
export type Vec2 = { x: number; z: number };

/* ------------------------------------------------------------------ */
/* Event type registry                                                 */
/* ------------------------------------------------------------------ */

export const AURA_EVENT = {
  SessionStarted: 'session.started',
  CallIncoming: 'call.incoming',
  CallEnded: 'call.ended',
  AudioLevel: 'audio.level',
  AudioInterrupted: 'audio.interrupted',
  TranscriptPartial: 'transcript.partial',
  TranscriptFinal: 'transcript.final',
  FactExtracted: 'fact.extracted',
  FactMissing: 'fact.missing',
  LocationCandidate: 'location.candidate',
  LocationVerified: 'location.verified',
  IncidentClassified: 'incident.classified',
  IncidentReclassified: 'incident.reclassified',
  ProtocolActivated: 'protocol.activated',
  ProtocolStep: 'protocol.step',
  ToolInvoked: 'tool.invoked',
  ToolResult: 'tool.result',
  RespondersAvailable: 'responders.available',
  RouteProposed: 'route.proposed',
  ApprovalRequested: 'approval.requested',
  ApprovalGranted: 'approval.granted',
  ApprovalRejected: 'approval.rejected',
  DispatchStarted: 'dispatch.started',
  DispatchProgress: 'dispatch.progress',
  DispatchArrived: 'dispatch.arrived',
} as const;

export type AuraEventType = (typeof AURA_EVENT)[keyof typeof AURA_EVENT];

/* ------------------------------------------------------------------ */
/* Payloads                                                            */
/* ------------------------------------------------------------------ */

export type SessionStartedPayload = { city?: string };

export type CallIncomingPayload = {
  call_id: string;
  caller_number: string;
  location_hint?: string;
  /** Approximate origin on the city plane; refined by location.* events. */
  coords?: Vec2;
};

export type CallEndedPayload = { call_id: string; reason?: string };

export type AudioLevelPayload = {
  call_id: string;
  /** 0..1 normalized loudness. Drives the voice orb pulse. */
  level: number;
  speaker: Speaker;
};

export type AudioInterruptedPayload = { call_id: string; reason?: string };

export type TranscriptPayload = {
  call_id: string;
  turn_id: string;
  speaker: Speaker;
  text: string;
};

export type FactExtractedPayload = {
  call_id: string;
  key: string;
  label: string;
  value: string;
  /** 0..1 */
  confidence: number;
  /** Critical facts render hollow/dark until confirmed. */
  critical?: boolean;
};

export type FactMissingPayload = {
  call_id: string;
  key: string;
  label: string;
  critical?: boolean;
};

export type LocationPayload = {
  call_id: string;
  address: string;
  /** 0..1 — rendered as a ring, never as bare text alone. */
  confidence: number;
  coords: Vec2;
};

export type IncidentClassifiedPayload = {
  call_id: string;
  incident_id: string;
  category: IncidentCategory;
  priority: Priority;
  reason?: string;
};

export type IncidentReclassifiedPayload = IncidentClassifiedPayload & {
  previous_priority: Priority;
};

export type ProtocolActivatedPayload = {
  call_id: string;
  protocol_id: string;
  name: string;
  steps: { step_id: string; label: string }[];
  why?: string;
};

export type ProtocolStepPayload = {
  call_id: string;
  protocol_id: string;
  step_id: string;
  status: ProtocolStepStatus;
  why?: string;
};

export type ToolInvokedPayload = {
  call_id: string;
  tool_call_id: string;
  tool: string;
  label: string;
  /** Which rail lane the packet travels in. */
  stage?: ToolStage;
};

export type ToolResultPayload = {
  call_id: string;
  tool_call_id: string;
  tool: string;
  status: 'ok' | 'error';
  summary?: string;
};

export type RespondersAvailablePayload = {
  incident_id: string;
  units: {
    unit_id: string;
    kind: ResponderKind;
    label: string;
    coords: Vec2;
    eta_s: number;
    distance_m: number;
  }[];
};

export type RouteProposedPayload = {
  incident_id: string;
  route_id: string;
  unit_id: string;
  /** Polyline along street centerlines. */
  path: Vec2[];
  eta_s: number;
  distance_m: number;
};

export type ApprovalRequestedPayload = {
  incident_id: string;
  approval_id: string;
  summary: string;
  route_id: string;
  unit_id: string;
  expires_in_s?: number;
};

export type ApprovalResolvedPayload = {
  incident_id: string;
  approval_id: string;
  by: string;
  reason?: string;
};

export type DispatchStartedPayload = {
  incident_id: string;
  unit_id: string;
  route_id: string;
};

export type DispatchProgressPayload = {
  incident_id: string;
  unit_id: string;
  /** 0..1 along the route. */
  progress: number;
};

export type DispatchArrivedPayload = { incident_id: string; unit_id: string };

/* ------------------------------------------------------------------ */
/* Action rail stages — the fixed pipeline shown on the bottom rail     */
/* ------------------------------------------------------------------ */

export const TOOL_STAGES = [
  'locate',
  'classify',
  'verify',
  'prepare_ems',
  'human_approval',
] as const;

export type ToolStage = (typeof TOOL_STAGES)[number];

export const TOOL_STAGE_LABEL: Record<ToolStage, string> = {
  locate: 'Locate',
  classify: 'Classify',
  verify: 'Verify',
  prepare_ems: 'Prepare EMS',
  human_approval: 'Human approval',
};

/* ------------------------------------------------------------------ */
/* Narrowing helpers — payloads arrive as Record<string, unknown>       */
/* ------------------------------------------------------------------ */

export function asNumber(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

export function asBool(v: unknown, fallback = false): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

export function asVec2(v: unknown): Vec2 | null {
  if (typeof v !== 'object' || v === null) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.x !== 'number' || typeof o.z !== 'number') return null;
  return { x: o.x, z: o.z };
}

export function asVec2Array(v: unknown): Vec2[] {
  if (!Array.isArray(v)) return [];
  const out: Vec2[] = [];
  for (const item of v) {
    const p = asVec2(item);
    if (p) out.push(p);
  }
  return out;
}

const PRIORITIES: Priority[] = ['unknown', 'low', 'medium', 'high', 'critical'];

export function asPriority(v: unknown): Priority {
  return typeof v === 'string' && (PRIORITIES as string[]).includes(v)
    ? (v as Priority)
    : 'unknown';
}

export function priorityRank(p: Priority): number {
  return PRIORITIES.indexOf(p);
}

const CATEGORIES: IncidentCategory[] = ['medical', 'fire', 'police', 'unknown'];

export function asCategory(v: unknown): IncidentCategory {
  return typeof v === 'string' && (CATEGORIES as string[]).includes(v)
    ? (v as IncidentCategory)
    : 'unknown';
}

export function asSpeaker(v: unknown): Speaker {
  return v === 'aura' ? 'aura' : 'caller';
}

export function asResponderKind(v: unknown): ResponderKind {
  return v === 'fire' || v === 'police' ? v : 'ems';
}

export function asToolStage(v: unknown): ToolStage | null {
  return typeof v === 'string' && (TOOL_STAGES as readonly string[]).includes(v)
    ? (v as ToolStage)
    : null;
}

/** Clamp to 0..1. */
export function unit(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
