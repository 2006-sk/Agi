/**
 * AURA shared contracts — the single source of truth for everything that crosses
 * a service boundary.
 *
 * Owned by the integration layer (Shresth). Producers (voice, intelligence) and
 * the frontend all speak the shapes defined here. Deliberately dependency-free:
 * types plus a handful of runtime constants, nothing that forces a build step on
 * an importing service.
 *
 * Two vocabularies live here on purpose:
 *
 *  1. `CANON_EVENT` — the canonical contract from the master handoff. This is what
 *     the backend services produce and what the append-only log stores.
 *  2. `VIEW_EVENT` — the vocabulary the command-deck frontend already consumes.
 *
 * The gateway broadcasts both over one socket. The frontend ignores unknown types,
 * so canonical events are inert there, and the backend never has to know that a
 * view layer exists. Where a name is shared by both vocabularies the payload is a
 * union of the two field sets — never two events, which would double-apply.
 */

/* ------------------------------------------------------------------ */
/* Envelope                                                            */
/* ------------------------------------------------------------------ */

/** The wire envelope. Every frame on `/ws/calls/{id}` is one of these. */
export interface AuraEvent<P = Record<string, unknown>> {
  event_id: string;
  session_id: string;
  type: string;
  /** ISO-8601, UTC. */
  timestamp: string;
  /** Per-session, strictly increasing, contiguous from 1. */
  sequence: number;
  payload: P;
}

/** What producers hand the gateway: an envelope with no sequence assigned yet. */
export type UnsequencedEvent<P = Record<string, unknown>> = Omit<
  AuraEvent<P>,
  "sequence"
> & { sequence?: number };

/* ------------------------------------------------------------------ */
/* Canonical event names (master handoff)                              */
/* ------------------------------------------------------------------ */

export const CANON_EVENT = {
  CallStarted: "call.started",
  CallEnded: "call.ended",
  AudioLevel: "audio.level",
  TranscriptPartial: "transcript.partial",
  TranscriptFinal: "transcript.final",
  AgentSpeaking: "agent.speaking",
  AgentInterrupted: "agent.interrupted",
  VoiceError: "voice.error",
  IncidentUpdated: "incident.updated",
  ProtocolChanged: "protocol.changed",
  ToolStarted: "tool.started",
  ToolCompleted: "tool.completed",
  DispatchProposed: "dispatch.proposed",
  ApprovalRequested: "approval.requested",
  ApprovalResolved: "approval.resolved",
  SystemDegraded: "system.degraded",
} as const;

export type CanonEventType = (typeof CANON_EVENT)[keyof typeof CANON_EVENT];

/* ------------------------------------------------------------------ */
/* View event names (command-deck frontend)                            */
/* ------------------------------------------------------------------ */

export const VIEW_EVENT = {
  SessionStarted: "session.started",
  CallIncoming: "call.incoming",
  CallEnded: "call.ended",
  AudioLevel: "audio.level",
  AudioInterrupted: "audio.interrupted",
  TranscriptPartial: "transcript.partial",
  TranscriptFinal: "transcript.final",
  FactExtracted: "fact.extracted",
  FactMissing: "fact.missing",
  LocationCandidate: "location.candidate",
  LocationVerified: "location.verified",
  IncidentClassified: "incident.classified",
  IncidentReclassified: "incident.reclassified",
  ProtocolActivated: "protocol.activated",
  ProtocolStep: "protocol.step",
  ToolInvoked: "tool.invoked",
  ToolResult: "tool.result",
  RespondersAvailable: "responders.available",
  RouteProposed: "route.proposed",
  ApprovalRequested: "approval.requested",
  ApprovalGranted: "approval.granted",
  ApprovalRejected: "approval.rejected",
  DispatchStarted: "dispatch.started",
  DispatchProgress: "dispatch.progress",
  DispatchArrived: "dispatch.arrived",
} as const;

export type ViewEventType = (typeof VIEW_EVENT)[keyof typeof VIEW_EVENT];

/**
 * Names that exist in both vocabularies. For these the gateway emits exactly one
 * event whose payload carries both field sets; emitting two would give the
 * frontend two `event_id`s for one fact (double transcript lines, double pulses).
 */
export const SHARED_EVENT_NAMES: readonly string[] = [
  VIEW_EVENT.AudioLevel,
  VIEW_EVENT.TranscriptPartial,
  VIEW_EVENT.TranscriptFinal,
  VIEW_EVENT.CallEnded,
  VIEW_EVENT.ApprovalRequested,
];

/* ------------------------------------------------------------------ */
/* Domain vocabulary                                                   */
/* ------------------------------------------------------------------ */

export type Category = "unknown" | "medical" | "fire" | "police" | "other";
export type Priority = "unknown" | "low" | "medium" | "high" | "critical";
export type IncidentStatus = "active" | "awaiting_approval" | "dispatched" | "closed";
export type Service = "EMS" | "FIRE" | "POLICE";
export type Speaker = "caller" | "aura";
export type ResponderKind = "ems" | "fire" | "police";

/** Frontend world space: XZ plane, Y up, city spans -60..60 on both axes. */
export interface Vec2 {
  x: number;
  z: number;
}

export const PRIORITY_ORDER: readonly Priority[] = [
  "unknown",
  "low",
  "medium",
  "high",
  "critical",
];

export function priorityRank(p: Priority): number {
  const i = PRIORITY_ORDER.indexOf(p);
  return i < 0 ? 0 : i;
}

/* ------------------------------------------------------------------ */
/* Incident state — mirrors the intelligence service's canonical shape  */
/* ------------------------------------------------------------------ */

export interface IncidentLocation {
  raw: string | null;
  normalized: string | null;
  latitude: number | null;
  longitude: number | null;
  confidence: number;
  verified: boolean;
}

export interface Assessment {
  chief_complaint: string | null;
  conscious: "yes" | "no" | "unknown";
  breathing: "normal" | "labored" | "no" | "unknown";
  hazards_checked: boolean;
}

export interface ResponderUnit {
  unit_id: string;
  type: string;
  station: string;
  latitude: number;
  longitude: number;
  eta_minutes: number;
  distance_km: number;
}

export interface RoutePlan {
  unit_id: string;
  distance_km: number;
  eta_minutes: number;
  /** `[latitude, longitude]` pairs; first point is the unit, last the incident. */
  polyline: [number, number][];
}

export interface ResponsePlan {
  services: Service[];
  units: ResponderUnit[];
  route: RoutePlan | null;
  reason: string;
  /** Required by the intelligence service when a plan is round-tripped back. */
  proposed_at?: string;
  cad_id: string | null;
}

export interface ProtocolRef {
  id: string | null;
  step: string | null;
  asked?: string[];
  last_prompt?: string | null;
}

export interface IncidentState {
  session_id: string;
  category: Category;
  priority: Priority;
  status: IncidentStatus;
  location: IncidentLocation;
  people_at_risk: number | null;
  facts: string[];
  unverified_facts: string[];
  hazards: string[];
  assessment: Assessment;
  missing_fields: string[];
  protocol: ProtocolRef;
  recommended_services: Service[];
  response_plan: ResponsePlan | null;
  confidence: number;
  human_required: boolean;
  summary: string;
  created_at: string;
  updated_at: string;
}

/* ------------------------------------------------------------------ */
/* Protocol step labels — the frontend renders a tree, not raw ids      */
/* ------------------------------------------------------------------ */

export const PROTOCOL_NAMES: Record<string, string> = {
  MED_CARDIAC_01: "Medical — cardiac / breathing",
  GENERAL_INTAKE_01: "General intake",
};

export const PROTOCOL_STEPS: Record<string, { step_id: string; label: string }[]> = {
  MED_CARDIAC_01: [
    { step_id: "verify_location", label: "Verify location" },
    { step_id: "identify_problem", label: "Identify problem" },
    { step_id: "conscious_check", label: "Consciousness" },
    { step_id: "breathing_check", label: "Breathing" },
    { step_id: "collect_hazards", label: "Scene hazards" },
    { step_id: "prepare_response", label: "Prepare response" },
    { step_id: "human_dispatch_approval", label: "Human approval" },
  ],
  GENERAL_INTAKE_01: [
    { step_id: "verify_location", label: "Verify location" },
    { step_id: "identify_problem", label: "Identify problem" },
    { step_id: "prepare_response", label: "Prepare response" },
    { step_id: "human_dispatch_approval", label: "Human approval" },
  ],
};

/* ------------------------------------------------------------------ */
/* Action rail stages                                                  */
/* ------------------------------------------------------------------ */

export const TOOL_STAGES = [
  "locate",
  "classify",
  "verify",
  "prepare_ems",
  "human_approval",
] as const;

export type ToolStage = (typeof TOOL_STAGES)[number];

/** Which rail lane each simulated tool travels in. */
export const TOOL_STAGE_BY_NAME: Record<string, ToolStage> = {
  normalize_address: "locate",
  geocode_address: "verify",
  find_available_units: "prepare_ems",
  calculate_route: "prepare_ems",
  create_cad_draft: "human_approval",
  request_specialist: "human_approval",
};

export const TOOL_LABELS: Record<string, string> = {
  normalize_address: "Normalize address",
  geocode_address: "Geocode address",
  find_available_units: "Find available units",
  calculate_route: "Calculate route",
  create_cad_draft: "Create CAD record",
  request_specialist: "Request specialist",
};

/* ------------------------------------------------------------------ */
/* Voice service inbound contract                                      */
/* ------------------------------------------------------------------ */

/** What the voice service POSTs to `/internal/voice-events` (no sequence yet). */
export interface VoiceEventBody {
  event_id: string;
  session_id: string;
  type: string;
  timestamp: string;
  payload: Record<string, unknown>;
}

/** Body of `POST /api/calls/{id}/utterance`. */
export interface UtteranceBody {
  text: string;
  speaker?: Speaker;
  language?: string;
  /**
   * Who submitted this. `voice` and `text` callers speak the returned
   * `reply_text` themselves, so the gateway must not also push TTS for them;
   * `demo` and `operator` have nobody listening, so the gateway does.
   */
  source?: "voice" | "text" | "demo" | "operator";
}

/** Response of `POST /api/calls/{id}/utterance`. */
export interface UtteranceReply {
  session_id: string;
  turn_id: string;
  /** Null when the turn was superseded by a later utterance — say nothing. */
  reply_text: string | null;
  superseded: boolean;
}

/** Body of `POST /api/calls/{id}/approval`. */
export interface ApprovalBody {
  approval_id?: string;
  approved: boolean;
  reviewer?: string;
  reason?: string;
}
