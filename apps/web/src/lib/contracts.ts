// Frontend view of the shared AURA event contract (master handoff README).
// Shresth owns the canonical schemas in packages/contracts — if these drift, fix them there first.
// Everything here is parsed defensively: unknown events are ignored, missing fields become null.

export type AuraEvent<P = Record<string, unknown>> = {
  event_id: string;
  session_id: string;
  type: string;
  timestamp: string;
  sequence: number;
  payload: P;
};

export type Speaker = "caller" | "agent";
export type Priority = "pending" | "routine" | "urgent" | "critical";
export type Category = "medical" | "fire" | "police" | "traffic" | "other" | "unknown";

export type IncidentLocation = {
  raw: string | null;
  normalized: string | null;
  latitude: number | null;
  longitude: number | null;
  confidence: number; // 0..1
  verified: boolean;
};

export type IncidentState = {
  session_id: string;
  category: Category;
  priority: Priority;
  status: string;
  location: IncidentLocation;
  people_at_risk: number | null;
  facts: string[];
  /** Model-only facts the service has not corroborated. Render these dimmed, never as confirmed. */
  unverified_facts: string[];
  hazards: string[];
  missing_fields: string[];
  protocol: { id: string; step: string } | null;
  recommended_services: string[];
  confidence: number;
  human_required: boolean;
  /** One dispatcher-facing sentence explaining this turn. Null when the producer omits it. */
  explanation: string | null;
};

export type ResponderUnit = {
  id: string;
  callsign: string; // "MEDIC 12"
  service: string; // "EMS"
  station: string | null;
  latitude: number;
  longitude: number;
  eta_seconds: number | null;
  distance_m: number | null;
  selected: boolean; // the unit AURA proposes to send
};

export type RoutePlan = {
  /** [latitude, longitude] pairs. May be empty — the city then derives a street route itself. */
  points: [number, number][];
  /** Which unit this route belongs to; how the intelligence service marks the proposed unit. */
  unit_id: string | null;
  distance_m: number | null;
  eta_seconds: number | null;
};

export const EVENT_TYPES = [
  "call.started",
  "call.ended",
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
] as const;
export type AuraEventType = (typeof EVENT_TYPES)[number];

/** Which sponsor-backed stage produced an event — drives the pipeline strip in the top bar. */
export type PipelineStage = "gradium" | "pipecat" | "sambanova" | "gateway";
export const stageOf = (type: string): PipelineStage | null => {
  if (type.startsWith("transcript.") || type === "audio.level") return "gradium";
  if (type.startsWith("agent.") || type.startsWith("call.")) return "pipecat";
  if (
    type.startsWith("incident.") ||
    type.startsWith("protocol.") ||
    type.startsWith("tool.") ||
    type === "dispatch.proposed"
  )
    return "sambanova";
  if (type.startsWith("approval.") || type.startsWith("system.")) return "gateway";
  return null;
};

// ---------- defensive parsing helpers ----------
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

export const normalizePriority = (v: unknown): Priority => {
  const s = String(v ?? "").toLowerCase();
  if (["critical", "p1", "echo", "immediate", "life_threatening"].includes(s)) return "critical";
  if (["urgent", "high", "p2", "delta", "amber", "emergency"].includes(s)) return "urgent";
  if (["routine", "medium", "moderate", "low", "p3", "p4"].includes(s)) return "routine";
  return "pending";
};

export const normalizeCategory = (v: unknown): Category => {
  const s = String(v ?? "").toLowerCase();
  if (["medical", "ems", "health"].includes(s)) return "medical";
  if (["fire"].includes(s)) return "fire";
  if (["police", "crime", "law"].includes(s)) return "police";
  if (["traffic", "collision", "mvc"].includes(s)) return "traffic";
  if (s === "other") return "other";
  return "unknown";
};

export const parseIncident = (payload: unknown, sessionId: string): IncidentState => {
  // The README says incident.updated carries the "complete incident state"; accept it bare or nested under `incident`.
  const root = obj(payload);
  // Accepted nestings: bare state, {incident}, or {state} — the intelligence service sends `state`.
  const p = "incident" in root ? obj(root.incident) : "state" in root ? obj(root.state) : root;
  const loc = obj(p.location);
  const proto = obj(p.protocol);
  const protoId = str(proto.id) ?? str(proto.protocol_id);
  // Services live on response_plan once units have been found, and in recommended_services before that.
  const plan = obj(p.response_plan);
  const services = arr(p.recommended_services).length > 0 ? arr(p.recommended_services) : arr(plan.services);
  const assessment = obj(p.assessment);
  return {
    session_id: str(p.session_id) ?? sessionId,
    category: normalizeCategory(p.category),
    priority: normalizePriority(p.priority),
    status: str(p.status) ?? "active",
    location: {
      raw: str(loc.raw),
      normalized: str(loc.normalized),
      latitude: num(loc.latitude),
      longitude: num(loc.longitude),
      confidence: Math.max(0, Math.min(1, num(loc.confidence) ?? 0)),
      verified: loc.verified === true,
    },
    people_at_risk: num(p.people_at_risk),
    facts: arr(p.facts),
    unverified_facts: arr(p.unverified_facts),
    hazards: arr(p.hazards).length > 0 ? arr(p.hazards) : arr(assessment.hazards_checked),
    missing_fields: arr(p.missing_fields),
    protocol: protoId ? { id: protoId, step: str(proto.step) ?? "" } : null,
    recommended_services: services,
    confidence: Math.max(0, Math.min(1, num(p.confidence) ?? 0)),
    // `awaiting_approval` is the service's way of saying a human is required.
    human_required: p.human_required === true || str(p.status) === "awaiting_approval",
    explanation: str(p.explanation) ?? str(root.explanation),
  };
};

/** Seconds from whichever unit the producer used. The intelligence service sends minutes. */
const seconds = (o: Record<string, unknown>): number | null => {
  const s = num(o.eta_seconds);
  if (s !== null) return s;
  const m = num(o.eta_minutes);
  return m === null ? null : Math.round(m * 60);
};

/** Metres from whichever unit the producer used. The intelligence service sends kilometres. */
const metres = (o: Record<string, unknown>): number | null => {
  const m = num(o.distance_m);
  if (m !== null) return m;
  const km = num(o.distance_km);
  return km === null ? null : Math.round(km * 1000);
};

/** "ems_12" / "AMB-12" -> "EMS 12". Pranay's units carry `unit_id` and no callsign. */
const callsignOf = (id: string): string => id.replace(/[_-]+/g, " ").trim().toUpperCase();

export const parseUnits = (v: unknown): ResponderUnit[] =>
  (Array.isArray(v) ? v : []).flatMap((u, i) => {
    const o = obj(u);
    const lat = num(o.latitude) ?? num(o.lat);
    const lon = num(o.longitude) ?? num(o.lng) ?? num(o.lon);
    if (lat === null || lon === null) return []; // unplottable until the backend geocodes it
    const id = str(o.id) ?? str(o.unit_id) ?? `unit_${i}`;
    return [
      {
        id,
        callsign: (str(o.callsign) ?? str(o.name) ?? callsignOf(id)).toUpperCase(),
        service: (str(o.service) ?? str(o.type) ?? "EMS").toUpperCase(),
        station: str(o.station),
        latitude: lat,
        longitude: lon,
        eta_seconds: seconds(o),
        distance_m: metres(o),
        selected: o.selected === true,
      },
    ];
  });

export const parseRoute = (v: unknown): RoutePlan | null => {
  if (!v || typeof v !== "object") return null;
  const o = obj(v);
  // `polyline` is what the intelligence service sends; `points` is the envelope's own name.
  const raw: unknown[] = Array.isArray(o.polyline)
    ? o.polyline
    : Array.isArray(o.points)
      ? o.points
      : Array.isArray(v)
        ? (v as unknown[])
        : [];
  const points = raw.flatMap((pt): [number, number][] => {
    if (Array.isArray(pt)) {
      const a = num(pt[0]);
      const b = num(pt[1]);
      return a !== null && b !== null ? [[a, b]] : [];
    }
    const q = obj(pt);
    const lat = num(q.latitude) ?? num(q.lat);
    const lon = num(q.longitude) ?? num(q.lon) ?? num(q.lng);
    return lat !== null && lon !== null ? [[lat, lon]] : [];
  });
  return { points, unit_id: str(o.unit_id), distance_m: metres(o), eta_seconds: seconds(o) };
};

/**
 * Mark the proposed unit. The intelligence service has no `selected` flag — the route's `unit_id`
 * names the unit it plans to send. Falls back to the soonest ETA, then to the first plottable unit,
 * so the map always has exactly one hero even if the backend omits the route.
 */
export const markSelected = (units: ResponderUnit[], route: RoutePlan | null): ResponderUnit[] => {
  if (units.length === 0) return units;
  if (units.some((u) => u.selected)) return units;
  const byRoute = route?.unit_id ? units.findIndex((u) => u.id === route.unit_id) : -1;
  let pick = byRoute;
  if (pick === -1) {
    const timed = units.filter((u) => u.eta_seconds !== null);
    if (timed.length > 0) {
      const best = timed.reduce((a, b) => (a.eta_seconds! <= b.eta_seconds! ? a : b));
      pick = units.indexOf(best);
    }
  }
  if (pick === -1) pick = 0;
  return units.map((u, i) => (i === pick ? { ...u, selected: true } : u));
};

export const field = { str, num, arr, obj };
