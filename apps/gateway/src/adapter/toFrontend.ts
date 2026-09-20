/**
 * Canonical -> command-deck projection.
 *
 * The backend speaks the master-handoff vocabulary (`incident.updated`,
 * `dispatch.proposed`, ...). The deck speaks a finer-grained visual vocabulary
 * (`fact.extracted`, `route.proposed`, ...). This module is the only place that
 * knows both, which is what lets Pranay and Aditya change payloads without the
 * frontend being rebuilt.
 *
 * Written as a pure function over an explicit projection state: given the same
 * events in the same order it produces the same output, so the whole translation
 * layer is unit-testable without a socket, a browser or a model.
 *
 * Two rules it must never break:
 *  - An event name shared by both vocabularies is emitted ONCE, with a payload
 *    carrying both field sets. Two events would mean two `event_id`s for one
 *    fact and the deck would apply it twice.
 *  - Nothing is re-emitted. The deck keys facts and steps by id, but a repeated
 *    `fact.extracted` still burns a sequence number and re-triggers animations.
 */

import {
  PROTOCOL_NAMES,
  PROTOCOL_STEPS,
  TOOL_LABELS,
  TOOL_STAGE_BY_NAME,
  VIEW_EVENT,
  priorityRank,
  type IncidentState,
  type Priority,
  type Vec2,
} from "@echo/contracts";

import { kmToMetres, minutesToSeconds, polylineToPath, toVec2 } from "./geo.js";

export interface DerivedEvent {
  type: string;
  payload: Record<string, unknown>;
}

/** Everything the projection needs to remember between events. */
export interface ProjectionState {
  callId: string;
  incidentId: string;
  classified: boolean;
  priority: Priority;
  category: string;
  protocolId: string | null;
  /** Step ids already reported to the deck, with the status last reported. */
  steps: Record<string, string>;
  facts: Record<string, string>;
  missing: string[];
  locationKey: string | null;
  locationVerified: boolean;
  unitsKey: string | null;
  routeKey: string | null;
  /** Open `tool.started` calls awaiting their `tool.completed`, by tool name. */
  openTools: Record<string, string>;
  toolSeq: number;
}

export function initialProjection(callId: string, incidentId: string): ProjectionState {
  return {
    callId,
    incidentId,
    classified: false,
    priority: "unknown",
    category: "unknown",
    protocolId: null,
    steps: {},
    facts: {},
    missing: [],
    locationKey: null,
    locationVerified: false,
    unitsKey: null,
    routeKey: null,
    openTools: {},
    toolSeq: 0,
  };
}

/* ------------------------------------------------------------------ */
/* Field labels                                                        */
/* ------------------------------------------------------------------ */

const FIELD_LABELS: Record<string, string> = {
  location: "Address",
  consciousness: "Conscious",
  conscious: "Conscious",
  breathing: "Breathing",
  hazards: "Scene hazards",
  recommended_services: "Services",
  chief_complaint: "Chief complaint",
  people_at_risk: "People at risk",
  category: "Category",
};

/** Facts that change the medical picture enough to render as critical. */
const CRITICAL_PATTERN = /not breathing|stopped breathing|no pulse|unresponsive|cardiac arrest|unconscious/i;

function labelFor(key: string): string {
  return FIELD_LABELS[key] ?? key.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/* ------------------------------------------------------------------ */
/* Projection                                                          */
/* ------------------------------------------------------------------ */

export interface ProjectionResult {
  events: DerivedEvent[];
  state: ProjectionState;
}

/**
 * Translate one canonical event. Returns the deck events it implies plus the
 * updated projection state; the caller threads that state through the session.
 */
export function project(
  type: string,
  payload: Record<string, unknown>,
  prior: ProjectionState,
): ProjectionResult {
  const state: ProjectionState = {
    ...prior,
    steps: { ...prior.steps },
    facts: { ...prior.facts },
    openTools: { ...prior.openTools },
  };
  const events: DerivedEvent[] = [];

  switch (type) {
    case "call.started": {
      events.push({
        type: VIEW_EVENT.CallIncoming,
        payload: {
          call_id: state.callId,
          caller_number: str(payload.caller_number) || "+1 (415) 555-0163",
          location_hint: str(payload.location_hint) || undefined,
          coords: undefined,
        },
      });
      break;
    }

    case "agent.speaking": {
      // The deck has no `agent.speaking`; ECHO's line belongs in the transcript.
      if (payload.active === true) {
        const text = str(payload.text);
        if (text) {
          events.push({
            type: VIEW_EVENT.TranscriptFinal,
            payload: {
              call_id: state.callId,
              turn_id: str(payload.turn_id) || "agent",
              speaker: "echo",
              text,
            },
          });
        }
      }
      break;
    }

    case "agent.interrupted": {
      events.push({
        type: VIEW_EVENT.AudioInterrupted,
        payload: { call_id: state.callId, reason: str(payload.reason) || "barge_in" },
      });
      break;
    }

    case "tool.started": {
      const tool = str(payload.tool);
      if (!tool) break;
      state.toolSeq += 1;
      const toolCallId = `tc-${state.toolSeq}-${tool}`;
      state.openTools[tool] = toolCallId;
      events.push({
        type: VIEW_EVENT.ToolInvoked,
        payload: {
          call_id: state.callId,
          tool_call_id: toolCallId,
          tool,
          label: TOOL_LABELS[tool] ?? tool,
          stage: TOOL_STAGE_BY_NAME[tool],
        },
      });
      break;
    }

    case "tool.completed": {
      const tool = str(payload.tool);
      if (!tool) break;
      const toolCallId = state.openTools[tool];
      if (!toolCallId) break;
      delete state.openTools[tool];
      const summary = str(payload.result_summary);
      events.push({
        type: VIEW_EVENT.ToolResult,
        payload: {
          call_id: state.callId,
          tool_call_id: toolCallId,
          tool,
          status: summary.startsWith("failed:") ? "error" : "ok",
          summary,
        },
      });
      break;
    }

    case "protocol.changed": {
      const from = str(payload.from);
      const to = str(payload.to);
      const protocolId = str(payload.protocol_id) || state.protocolId || "";
      const reason = str(payload.reason);
      if (protocolId && protocolId !== state.protocolId) {
        events.push(...activateProtocol(state, protocolId, reason));
      }
      if (from) events.push(...markStep(state, protocolId, from, "done", ""));
      if (to) events.push(...markStep(state, protocolId, to, "active", reason));
      break;
    }

    case "dispatch.proposed": {
      events.push(...projectDispatch(state, payload));
      break;
    }

    case "incident.updated": {
      events.push(...projectIncident(state, payload as unknown as IncidentState));
      break;
    }

    default:
      break;
  }

  return { events, state };
}

/* ------------------------------------------------------------------ */
/* incident.updated — the big one                                      */
/* ------------------------------------------------------------------ */

function projectIncident(state: ProjectionState, incident: IncidentState): DerivedEvent[] {
  const events: DerivedEvent[] = [];
  if (!incident || typeof incident !== "object") return events;

  /* --- protocol --------------------------------------------------- */
  const protocolId = incident.protocol?.id ?? null;
  if (protocolId && protocolId !== state.protocolId) {
    events.push(...activateProtocol(state, protocolId, ""));
  }
  const step = incident.protocol?.step ?? null;
  if (protocolId && step) {
    // Everything before the current step in the protocol order is settled.
    const order = PROTOCOL_STEPS[protocolId] ?? [];
    const index = order.findIndex((s) => s.step_id === step);
    if (index > 0) {
      for (const earlier of order.slice(0, index)) {
        events.push(...markStep(state, protocolId, earlier.step_id, "done", ""));
      }
    }
    events.push(...markStep(state, protocolId, step, "active", ""));
  }

  /* --- classification --------------------------------------------- */
  const category = incident.category ?? "unknown";
  const priority = incident.priority ?? "unknown";
  const classifiable = category !== "unknown" || priority !== "unknown";
  if (classifiable) {
    const changed = category !== state.category || priority !== state.priority;
    if (!state.classified) {
      events.push({
        type: VIEW_EVENT.IncidentClassified,
        payload: {
          call_id: state.callId,
          incident_id: state.incidentId,
          category: normalizeCategory(category),
          priority,
          reason: incident.summary || "",
        },
      });
      state.classified = true;
    } else if (changed) {
      events.push({
        type: VIEW_EVENT.IncidentReclassified,
        payload: {
          call_id: state.callId,
          incident_id: state.incidentId,
          category: normalizeCategory(category),
          priority,
          previous_priority: state.priority,
          reason: incident.summary || "",
        },
      });
    }
    if (changed || !state.classified) {
      state.category = category;
      // Priority is monotonic upstream; never let a projection glitch walk it back.
      if (priorityRank(priority) >= priorityRank(state.priority)) state.priority = priority;
    }
  }

  /* --- location ---------------------------------------------------- */
  const loc = incident.location;
  if (loc && typeof loc.latitude === "number" && typeof loc.longitude === "number") {
    const key = `${loc.latitude},${loc.longitude},${loc.verified ? 1 : 0}`;
    const newlyVerified = Boolean(loc.verified) && !state.locationVerified;
    if (key !== state.locationKey || newlyVerified) {
      state.locationKey = key;
      if (loc.verified) state.locationVerified = true;
      events.push({
        type: loc.verified ? VIEW_EVENT.LocationVerified : VIEW_EVENT.LocationCandidate,
        payload: {
          call_id: state.callId,
          address: loc.normalized || loc.raw || "",
          confidence: num(loc.confidence),
          coords: toVec2(loc.latitude, loc.longitude),
        },
      });
    }
  }

  /* --- facts -------------------------------------------------------- */
  for (const fact of structuredFacts(incident)) {
    if (state.facts[fact.key] === fact.value) continue;
    state.facts[fact.key] = fact.value;
    events.push({
      type: VIEW_EVENT.FactExtracted,
      payload: {
        call_id: state.callId,
        key: fact.key,
        label: fact.label,
        value: fact.value,
        confidence: fact.confidence,
        critical: fact.critical,
      },
    });
  }

  /* --- still missing ------------------------------------------------ */
  const missing = Array.isArray(incident.missing_fields) ? incident.missing_fields : [];
  for (const field of missing) {
    const key = `missing:${field}`;
    if (state.facts[key]) continue;
    state.facts[key] = field;
    events.push({
      type: VIEW_EVENT.FactMissing,
      payload: {
        call_id: state.callId,
        key,
        label: labelFor(field),
        critical: field === "location" || field === "breathing",
      },
    });
  }

  /* --- units and route (may land here rather than on a proposal) ---- */
  if (incident.response_plan) {
    events.push(...projectPlan(state, incident.response_plan));
  }

  return events;
}

/** Facts the deck can render as label/value pairs, drawn from structured state. */
interface FlatFact {
  key: string;
  label: string;
  value: string;
  confidence: number;
  critical: boolean;
}

function structuredFacts(incident: IncidentState): FlatFact[] {
  const out: FlatFact[] = [];
  const confidence = num(incident.confidence, 1);
  const a = incident.assessment;

  if (a?.chief_complaint) {
    out.push({
      key: "chief_complaint",
      label: "Chief complaint",
      value: a.chief_complaint,
      confidence,
      critical: false,
    });
  }
  if (a?.conscious && a.conscious !== "unknown") {
    out.push({
      key: "conscious",
      label: "Conscious",
      value: a.conscious,
      confidence,
      critical: a.conscious === "no",
    });
  }
  if (a?.breathing && a.breathing !== "unknown") {
    out.push({
      key: "breathing",
      label: "Breathing",
      value: a.breathing,
      confidence,
      critical: a.breathing === "no",
    });
  }
  if (typeof incident.people_at_risk === "number") {
    out.push({
      key: "people_at_risk",
      label: "People at risk",
      value: String(incident.people_at_risk),
      confidence,
      critical: false,
    });
  }
  if (incident.location?.normalized) {
    out.push({
      key: "address",
      label: "Address",
      value: incident.location.normalized,
      confidence: num(incident.location.confidence, confidence),
      critical: false,
    });
  }
  for (const hazard of incident.hazards ?? []) {
    out.push({
      key: `hazard:${slug(hazard)}`,
      label: "Hazard",
      value: hazard,
      confidence,
      critical: true,
    });
  }
  // Verified free-text observations. `unverified_facts` stay off the deck on
  // purpose: the model is generous with them and they would crowd out the real
  // picture. They remain visible in `incident.updated` for the diagnostics panel.
  for (const fact of incident.facts ?? []) {
    out.push({
      key: `fact:${slug(fact)}`,
      label: "Observed",
      value: fact,
      confidence,
      critical: CRITICAL_PATTERN.test(fact),
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Response plan -> units + route                                      */
/* ------------------------------------------------------------------ */

function projectPlan(
  state: ProjectionState,
  plan: NonNullable<IncidentState["response_plan"]>,
): DerivedEvent[] {
  const events: DerivedEvent[] = [];
  const units = Array.isArray(plan.units) ? plan.units : [];

  if (units.length > 0) {
    const key = units.map((u) => u.unit_id).join(",");
    if (key !== state.unitsKey) {
      state.unitsKey = key;
      events.push({
        type: VIEW_EVENT.RespondersAvailable,
        payload: {
          incident_id: state.incidentId,
          units: units.map((u) => ({
            unit_id: u.unit_id,
            kind: responderKind(plan.services, u.type),
            label: `${u.unit_id} · ${u.type}`,
            coords: toVec2(u.latitude, u.longitude),
            eta_s: minutesToSeconds(u.eta_minutes),
            distance_m: kmToMetres(u.distance_km),
          })),
        },
      });
    }
  }

  const route = plan.route;
  if (route) {
    const key = `${route.unit_id}:${route.distance_km}:${route.eta_minutes}`;
    if (key !== state.routeKey) {
      state.routeKey = key;
      events.push({
        type: VIEW_EVENT.RouteProposed,
        payload: {
          incident_id: state.incidentId,
          route_id: routeIdFor(state, route.unit_id),
          unit_id: route.unit_id,
          path: polylineToPath(route.polyline),
          eta_s: minutesToSeconds(route.eta_minutes),
          distance_m: kmToMetres(route.distance_km),
        },
      });
    }
  }
  return events;
}

function projectDispatch(
  state: ProjectionState,
  payload: Record<string, unknown>,
): DerivedEvent[] {
  const plan = {
    services: (payload.services as IncidentState["recommended_services"]) ?? [],
    units: (payload.units as NonNullable<IncidentState["response_plan"]>["units"]) ?? [],
    route: (payload.route as NonNullable<IncidentState["response_plan"]>["route"]) ?? null,
    reason: str(payload.reason),
    cad_id: null,
  };
  return projectPlan(state, plan);
}

export function routeIdFor(state: ProjectionState, unitId: string): string {
  return `route-${unitId}`;
}

function responderKind(services: unknown, type: string): "ems" | "fire" | "police" {
  const list = Array.isArray(services) ? services.map(String) : [];
  if (list.includes("FIRE")) return "fire";
  if (list.includes("POLICE")) return "police";
  if (/engine|truck|ladder/i.test(type)) return "fire";
  if (/patrol|police/i.test(type)) return "police";
  return "ems";
}

function normalizeCategory(category: string): string {
  // The deck knows medical/fire/police; `other` reads as unknown to it.
  return category === "medical" || category === "fire" || category === "police"
    ? category
    : "unknown";
}

/* ------------------------------------------------------------------ */
/* Protocol helpers                                                    */
/* ------------------------------------------------------------------ */

function activateProtocol(
  state: ProjectionState,
  protocolId: string,
  why: string,
): DerivedEvent[] {
  state.protocolId = protocolId;
  state.steps = {};
  return [
    {
      type: VIEW_EVENT.ProtocolActivated,
      payload: {
        call_id: state.callId,
        protocol_id: protocolId,
        name: PROTOCOL_NAMES[protocolId] ?? protocolId,
        steps: PROTOCOL_STEPS[protocolId] ?? [],
        why,
      },
    },
  ];
}

function markStep(
  state: ProjectionState,
  protocolId: string,
  stepId: string,
  status: "active" | "done" | "blocked",
  why: string,
): DerivedEvent[] {
  if (!protocolId || !stepId) return [];
  // `done` never regresses to `active`: a protocol that jumps forward and back
  // (escalation, then a clarifying question) must not un-tick the tree.
  const current = state.steps[stepId];
  if (current === status) return [];
  if (current === "done" && status === "active") return [];
  state.steps[stepId] = status;
  return [
    {
      type: VIEW_EVENT.ProtocolStep,
      payload: {
        call_id: state.callId,
        protocol_id: protocolId,
        step_id: stepId,
        status,
        why,
      },
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Coercion                                                            */
/* ------------------------------------------------------------------ */

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function num(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

export type { Vec2 };
