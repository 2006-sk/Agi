import { z } from "zod";
import { IncidentState, type Priority } from "../schemas/incident.js";
import { fnv1a } from "./gis.js";

/**
 * Simulated CAD (computer-aided dispatch) tools. These are the consequential actions:
 * they are only ever proposed by /internal/analyze and executed by
 * /internal/tools/execute after a human approves.
 */

/** The incident state may be omitted; the executor then uses the session's current state. */
export const CreateCadDraftArgs = z.object({
  incident_state: IncidentState.optional(),
});
export type CreateCadDraftArgs = z.infer<typeof CreateCadDraftArgs>;

export interface CadDraft {
  cad_id: string;
  status: "draft";
  created_at: string;
  incident_type: string;
  priority_code: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  services: string[];
  units_assigned: string[];
  notes: string;
}

const PRIORITY_CODES: Record<Priority, string> = {
  critical: "P1",
  high: "P2",
  medium: "P3",
  low: "P4",
  unknown: "P3",
};

function incidentType(state: IncidentState): string {
  if (state.category === "medical") {
    if (state.assessment.breathing === "no") return "MEDICAL - CARDIAC/RESPIRATORY ARREST";
    if (state.assessment.conscious === "no") return "MEDICAL - UNCONSCIOUS PERSON";
    if (state.assessment.chief_complaint) return `MEDICAL - ${state.assessment.chief_complaint.toUpperCase()}`;
    return "MEDICAL - UNSPECIFIED";
  }
  if (state.category === "fire") return "FIRE - STRUCTURE/UNKNOWN";
  if (state.category === "police") return "POLICE - DISTURBANCE/VIOLENCE";
  return "UNCLASSIFIED INCIDENT";
}

export function createCadDraft(args: CreateCadDraftArgs, now: Date, fallbackState: IncidentState): CadDraft {
  const state = args.incident_state ?? fallbackState;
  const serial = String(fnv1a(state.session_id) % 1_000_000).padStart(6, "0");
  return {
    cad_id: `CAD-${now.getUTCFullYear()}-${serial}`,
    status: "draft",
    created_at: now.toISOString(),
    incident_type: incidentType(state),
    priority_code: PRIORITY_CODES[state.priority],
    address: state.location.normalized ?? state.location.raw,
    latitude: state.location.latitude,
    longitude: state.location.longitude,
    services: [...state.recommended_services],
    units_assigned: state.response_plan?.units.slice(0, 1).map((u) => u.unit_id) ?? [],
    notes: [
      ...state.facts,
      ...(state.hazards.length ? [`hazards: ${state.hazards.join(", ")}`] : []),
      ...(state.people_at_risk !== null ? [`people at risk: ${state.people_at_risk}`] : []),
    ].join("; "),
  };
}

export const RequestSpecialistArgs = z.object({
  type: z.string().min(1),
  reason: z.string().min(1),
});
export type RequestSpecialistArgs = z.infer<typeof RequestSpecialistArgs>;

export interface SpecialistRequest {
  request_id: string;
  type: string;
  reason: string;
  status: "queued";
  eta_minutes: number;
  requested_at: string;
}

export function requestSpecialist(args: RequestSpecialistArgs, now: Date, sessionId: string): SpecialistRequest {
  const serial = String(fnv1a(`${sessionId}:${args.type}`) % 100_000).padStart(5, "0");
  return {
    request_id: `SPC-${serial}`,
    type: args.type,
    reason: args.reason,
    status: "queued",
    eta_minutes: 2,
    requested_at: now.toISOString(),
  };
}
