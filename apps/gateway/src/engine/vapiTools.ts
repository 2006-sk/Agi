import { randomUUID } from "node:crypto";

import { CANON_EVENT, type IncidentState, type Priority, type Service } from "@echo/contracts";

import type { IntelligenceClient } from "../clients/intelligence.js";
import type { Orchestrator } from "../engine/orchestrator.js";
import type { Session } from "../session/store.js";

/**
 * Vapi mode: the agent is the brain.
 *
 * In the default ECHO mode the deterministic protocol machine drives the call
 * and Vapi is only a mouth and ears. In Vapi mode the agent's own model runs
 * the conversation and reaches back through these tools to move the incident.
 *
 * What does NOT change is the part that matters: the incident state, the live
 * deck and the human approval gate all still live here. The agent can describe
 * an emergency and ask for a dispatch; it cannot dispatch. `request_dispatch`
 * opens the gate and returns "pending" — the CAD record is still created only
 * after a human says yes, through the same code path the protocol machine uses.
 *
 * The simulated GIS and unit roster stay in Pranay's service, so both modes
 * put the same ambulance on the same street.
 */

export interface VapiToolContext {
  session: Session;
  orchestrator: Orchestrator;
  intelligence: IntelligenceClient;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

/** A blank incident, in the same shape the intelligence service produces. */
export function blankState(sessionId: string, now = new Date()): IncidentState {
  const iso = now.toISOString();
  return {
    session_id: sessionId,
    category: "unknown",
    priority: "unknown",
    status: "active",
    location: {
      raw: null,
      normalized: null,
      latitude: null,
      longitude: null,
      confidence: 0,
      verified: false,
    },
    people_at_risk: null,
    facts: [],
    unverified_facts: [],
    hazards: [],
    assessment: {
      chief_complaint: null,
      conscious: "unknown",
      breathing: "unknown",
      hazards_checked: false,
    },
    missing_fields: ["location"],
    protocol: { id: "MED_CARDIAC_01", step: "verify_location" },
    recommended_services: [],
    response_plan: null,
    confidence: 0.9,
    human_required: false,
    summary: "",
    created_at: iso,
    updated_at: iso,
  };
}

function ensureState(session: Session): IncidentState {
  if (!session.state) session.state = blankState(session.session_id);
  return session.state;
}

const PRIORITIES: Priority[] = ["unknown", "low", "medium", "high", "critical"];
const rank = (p: Priority) => Math.max(0, PRIORITIES.indexOf(p));

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

/** Which fields the dispatcher still needs, recomputed from what is known. */
function recomputeMissing(state: IncidentState): string[] {
  const missing: string[] = [];
  if (!state.location.verified) missing.push("location");
  if (!state.assessment.chief_complaint) missing.push("chief_complaint");
  if (state.assessment.conscious === "unknown") missing.push("consciousness");
  if (state.assessment.breathing === "unknown") missing.push("breathing");
  if (!state.assessment.hazards_checked) missing.push("hazards");
  return missing;
}

/**
 * Where the incident sits in the protocol.
 *
 * The agent does not drive the protocol in this mode, but the deck draws the
 * tree and Pranay's tools check step legality, so the step is derived from the
 * facts rather than left stale.
 */
function deriveStep(state: IncidentState): string {
  if (state.status === "awaiting_approval" || state.status === "dispatched") {
    return "human_dispatch_approval";
  }
  if (state.response_plan) return "prepare_response";
  if (!state.location.verified) return "verify_location";
  if (!state.assessment.chief_complaint) return "identify_problem";
  if (state.assessment.conscious === "unknown") return "conscious_check";
  if (state.assessment.breathing === "unknown") return "breathing_check";
  if (!state.assessment.hazards_checked) return "collect_hazards";
  return "prepare_response";
}

function touch(state: IncidentState): void {
  state.missing_fields = recomputeMissing(state);
  state.protocol = { id: state.protocol.id ?? "MED_CARDIAC_01", step: deriveStep(state) };
  state.updated_at = new Date().toISOString();
}

/* ------------------------------------------------------------------ */
/* Tool definitions advertised to the agent                            */
/* ------------------------------------------------------------------ */

export function toolDefinitions(serverUrl: string) {
  const tool = (
    name: string,
    description: string,
    properties: Record<string, unknown>,
    required: string[] = [],
  ) => ({
    type: "function",
    function: { name, description, parameters: { type: "object", properties, required } },
    server: { url: serverUrl },
  });

  return [
    tool(
      "update_incident",
      "Record what you have learned about the emergency. Call this as soon as you learn anything new — the dispatcher's screen updates live from it. Safe to call repeatedly.",
      {
        category: {
          type: "string",
          enum: ["medical", "fire", "police", "other"],
          description: "Kind of emergency.",
        },
        priority: {
          type: "string",
          enum: ["low", "medium", "high", "critical"],
          description: "Use critical for not breathing, no pulse, unconscious, or immediate threat to life.",
        },
        chief_complaint: { type: "string", description: "The main problem in a few words." },
        conscious: { type: "string", enum: ["yes", "no", "unknown"] },
        breathing: { type: "string", enum: ["normal", "labored", "no", "unknown"] },
        people_at_risk: { type: "number" },
        facts: {
          type: "array",
          items: { type: "string" },
          description: "Short observations, e.g. 'chest pain', 'pain radiating to arm'.",
        },
        hazards: {
          type: "array",
          items: { type: "string" },
          description: "Dangers to responders, e.g. 'gas smell', 'aggressive dog'.",
        },
      },
    ),
    tool(
      "verify_address",
      "Verify and map the caller's address. Call as soon as they give one. Nothing can be dispatched until this succeeds.",
      { address: { type: "string", description: "The address exactly as the caller said it." } },
      ["address"],
    ),
    tool(
      "find_units",
      "Find the nearest available responder units and calculate a route. Requires a verified address.",
      {
        service: {
          type: "string",
          enum: ["EMS", "FIRE", "POLICE"],
          description: "Which service is needed.",
        },
      },
      ["service"],
    ),
    tool(
      "request_dispatch",
      "Ask the human dispatcher to approve sending the units. This does NOT dispatch — a human must approve. Tell the caller help is being arranged and stay on the line.",
      { reason: { type: "string", description: "Why dispatch is needed now." } },
      ["reason"],
    ),
  ];
}

/* ------------------------------------------------------------------ */
/* Execution                                                           */
/* ------------------------------------------------------------------ */

export interface ToolResult {
  toolCallId: string;
  result: string;
}

/** Run one agent tool call and push whatever it changed to the deck. */
export async function runVapiTool(call: ToolCall, ctx: VapiToolContext): Promise<ToolResult> {
  const { session, orchestrator } = ctx;
  const args = call.arguments ?? {};
  const state = ensureState(session);

  // Show the agent's tool call on the action rail, same as the protocol path.
  orchestrator.publishRaw(session, {
    type: CANON_EVENT.ToolStarted,
    payload: { tool: call.name, arguments: args },
  });

  let summary: string;
  try {
    summary = await execute(call.name, args, ctx, state);
  } catch (error) {
    // Surface the downstream validation detail: "400" alone is untraceable
    // when the agent is the only thing driving state.
    const err = error as Error & { body?: unknown };
    const detail = err.body ? ` ${JSON.stringify(err.body).slice(0, 300)}` : "";
    const message = `${err.message}${detail}`;
    orchestrator.publishRaw(session, {
      type: CANON_EVENT.ToolCompleted,
      payload: { tool: call.name, result: null, result_summary: `failed: ${message}`, duration_ms: 0 },
    });
    return { toolCallId: call.id, result: `That did not work: ${message}` };
  }

  orchestrator.publishRaw(session, {
    type: CANON_EVENT.ToolCompleted,
    payload: { tool: call.name, result_summary: summary, duration_ms: 0 },
  });

  touch(state);
  // One full-state event; the projection turns it into every deck update.
  orchestrator.publishRaw(session, {
    type: CANON_EVENT.IncidentUpdated,
    payload: { ...state },
  });

  return { toolCallId: call.id, result: summary };
}

async function execute(
  name: string,
  args: Record<string, unknown>,
  ctx: VapiToolContext,
  state: IncidentState,
): Promise<string> {
  switch (name) {
    case "update_incident":
      return updateIncident(args, state);
    case "verify_address":
      return verifyAddress(args, ctx, state);
    case "find_units":
      return findUnits(args, ctx, state);
    case "request_dispatch":
      return requestDispatch(args, ctx, state);
    default:
      throw new Error(`unknown tool ${name}`);
  }
}

function updateIncident(args: Record<string, unknown>, state: IncidentState): string {
  const changed: string[] = [];

  const category = typeof args.category === "string" ? args.category : "";
  if (category && state.category === "unknown") {
    state.category = category as IncidentState["category"];
    changed.push(`category ${category}`);
  }

  const priority = typeof args.priority === "string" ? (args.priority as Priority) : null;
  // Priority is monotonic: only a human may calm an incident down.
  if (priority && rank(priority) > rank(state.priority)) {
    state.priority = priority;
    changed.push(`priority ${priority}`);
  }

  if (typeof args.chief_complaint === "string" && args.chief_complaint.trim()) {
    state.assessment.chief_complaint = args.chief_complaint.trim();
    changed.push("chief complaint");
  }
  if (args.conscious === "yes" || args.conscious === "no") {
    state.assessment.conscious = args.conscious;
    changed.push(`conscious ${args.conscious}`);
  }
  if (args.breathing === "normal" || args.breathing === "labored" || args.breathing === "no") {
    state.assessment.breathing = args.breathing;
    changed.push(`breathing ${args.breathing}`);
    // A caller who says the patient is not breathing has said the only thing
    // that matters; never let the model grade that as anything but critical.
    if (args.breathing === "no" && rank("critical") > rank(state.priority)) {
      state.priority = "critical";
      changed.push("priority critical");
    }
  }
  if (typeof args.people_at_risk === "number" && Number.isFinite(args.people_at_risk)) {
    state.people_at_risk = Math.max(0, Math.round(args.people_at_risk));
  }

  for (const fact of asStringArray(args.facts)) {
    if (!state.facts.includes(fact)) {
      state.facts.push(fact);
      changed.push(fact);
    }
  }
  const hazards = asStringArray(args.hazards);
  for (const hazard of hazards) {
    if (!state.hazards.includes(hazard)) state.hazards.push(hazard);
  }
  if (hazards.length > 0 || args.hazards !== undefined) state.assessment.hazards_checked = true;

  if (state.category === "medical" && state.recommended_services.length === 0) {
    state.recommended_services = ["EMS"];
  }

  return changed.length ? `Recorded: ${changed.join(", ")}.` : "Nothing new to record.";
}

async function verifyAddress(
  args: Record<string, unknown>,
  ctx: VapiToolContext,
  state: IncidentState,
): Promise<string> {
  const raw = String(args.address ?? "").trim();
  if (!raw) throw new Error("no address given");
  state.location.raw = raw;

  // Pranay's simulated GIS, so both modes land on the same coordinates. The
  // step is pinned because his protocol machine only permits these tools there.
  state.protocol = { id: "MED_CARDIAC_01", step: "verify_location" };
  const asState = () => state as unknown as Record<string, unknown>;

  const normalized = await ctx.intelligence.executeTool({
    session_id: state.session_id,
    tool: { name: "normalize_address", arguments: { raw_address: raw } },
    current_state: asState(),
    approved: false,
  });
  const norm = normalized.execution.result as { normalized?: string; confidence?: number } | null;
  if (!norm?.normalized) {
    return `I could not make sense of "${raw}". Ask for a street number and street name.`;
  }
  state.location.normalized = norm.normalized;

  const geocoded = await ctx.intelligence.executeTool({
    session_id: state.session_id,
    tool: { name: "geocode_address", arguments: { normalized_address: norm.normalized } },
    current_state: asState(),
    approved: false,
  });
  const geo = geocoded.execution.result as {
    latitude?: number | null;
    longitude?: number | null;
    confidence?: number;
  } | null;

  // A place we cannot put a pin on is not an address we can send an ambulance
  // to. Leaving `verified` false is what keeps the dispatch gate shut.
  if (typeof geo?.latitude !== "number" || typeof geo?.longitude !== "number") {
    state.location.verified = false;
    state.location.confidence = geo?.confidence ?? 0;
    return `I could not place "${raw}" on the map. Ask the caller for a street number, or the nearest cross street. Nothing can be dispatched until I have one.`;
  }

  state.location.latitude = geo.latitude;
  state.location.longitude = geo.longitude;
  state.location.confidence = geo.confidence ?? 0.9;
  state.location.verified = true;

  return `Address verified: ${state.location.normalized}. It is on the dispatcher's map.`;
}

async function findUnits(
  args: Record<string, unknown>,
  ctx: VapiToolContext,
  state: IncidentState,
): Promise<string> {
  if (!state.location.verified) {
    throw new Error("the address is not verified yet — call verify_address first");
  }
  const service = String(args.service ?? "EMS").toUpperCase() as Service;
  state.recommended_services = [service];
  state.protocol = { id: "MED_CARDIAC_01", step: "prepare_response" };

  const incidentLocation = {
    latitude: state.location.latitude as number,
    longitude: state.location.longitude as number,
  };
  const asState = () => state as unknown as Record<string, unknown>;

  const found = await ctx.intelligence.executeTool({
    session_id: state.session_id,
    tool: {
      name: "find_available_units",
      arguments: { service, location: incidentLocation, limit: 3 },
    },
    current_state: asState(),
    approved: false,
  });
  const unitsResult = found.execution.result as { units?: Record<string, unknown>[] } | null;
  const units = unitsResult?.units ?? [];
  if (units.length === 0) return `No ${service} units are available right now.`;

  // Keep the service field his schema requires; the state round-trips back to
  // his tools on the next call. Built locally and assigned only once the route
  // succeeds, so a failure here cannot leave a half-plan that would let
  // request_dispatch open the gate with nothing to send.
  const plan: NonNullable<IncidentState["response_plan"]> = {
    services: [service],
    units: units as never,
    route: null,
    reason: `closest available ${service} unit`,
    proposed_at: new Date().toISOString(),
    cad_id: null,
  };

  const closest = units[0] as { unit_id: string; latitude: number; longitude: number };
  const routed = await ctx.intelligence.executeTool({
    session_id: state.session_id,
    tool: {
      name: "calculate_route",
      arguments: {
        unit: {
          unit_id: closest.unit_id,
          latitude: closest.latitude,
          longitude: closest.longitude,
        },
        incident_location: incidentLocation,
      },
    },
    current_state: { ...asState(), response_plan: plan },
    approved: false,
  });
  const route = routed.execution.result as
    | { unit_id: string; distance_km: number; eta_minutes: number; polyline: [number, number][] }
    | null;
  if (route) plan.route = route;
  state.response_plan = plan;

  const eta = route?.eta_minutes;
  return `${closest.unit_id} is the closest ${service} unit${
    typeof eta === "number" ? `, ${eta} minutes out` : ""
  }. The route is on the map. It is NOT dispatched — call request_dispatch to ask a human to approve.`;
}

async function requestDispatch(
  args: Record<string, unknown>,
  ctx: VapiToolContext,
  state: IncidentState,
): Promise<string> {
  if (!state.location.verified) {
    throw new Error("cannot request dispatch without a verified address");
  }
  if (!state.response_plan?.units?.length || !state.response_plan.route) {
    throw new Error("no unit and route ready yet — call find_units first");
  }

  state.status = "awaiting_approval";
  state.human_required = true;
  state.protocol = { id: "MED_CARDIAC_01", step: "human_dispatch_approval" };

  const unitId = state.response_plan.route?.unit_id ?? state.response_plan.units[0]?.unit_id ?? "";
  const eta = state.response_plan.route?.eta_minutes;
  const reason = String(args.reason ?? "Dispatch requested by the intake agent");

  // One gate per call. A new id on every request would let the agent stack up
  // dispatcher prompts, and leave stale gates that could be approved later.
  const open = [...ctx.session.approvals.values()].find((a) => !a.resolved);
  if (open) {
    return "The human dispatcher has already been asked and has not decided yet. Keep the caller calm and on the line.";
  }

  ctx.orchestrator.raiseApproval(ctx.session, {
    approval_id: `dispatch_${randomUUID().slice(0, 8)}`,
    tool: { name: "create_cad_draft", arguments: {} },
    summary: `Dispatch ${state.recommended_services.join(", ") || "EMS"} (${unitId}) to ${
      state.location.normalized ?? state.location.raw
    }${typeof eta === "number" ? `, ETA ${eta} min` : ""}`,
    unit_id: unitId,
    reason,
  });

  return "The human dispatcher has been asked to approve. Tell the caller that help is being arranged and to stay on the line. Do not say the ambulance is on its way until I confirm approval.";
}

/** The system prompt the agent runs on in Vapi mode. */
export const VAPI_SYSTEM_PROMPT = `You are ECHO, an emergency call-intake assistant answering an overflow 911 line. A human dispatcher is supervising you and sees everything you record.

Open by telling the caller they have reached emergency services and that you are an AI assistant with a human dispatcher supervising.

Your job is to find out, as fast as possible:
1. WHERE the emergency is — get this first, it matters more than anything else.
2. WHAT is happening.
3. Whether the person is conscious and breathing.
4. Any danger to responders.

Rules:
- Ask ONE short question at a time. Callers are frightened; do not lecture.
- The moment you learn anything, call update_incident. Do not wait until the end.
- The moment you have an address, call verify_address.
- Once the address is verified and you know it is a medical emergency, call find_units.
- When units are found and the situation warrants it, call request_dispatch.
- If the caller says the person is not breathing, has no pulse, or is unresponsive, set priority to critical immediately and interrupt whatever you were asking.
- NEVER say an ambulance has been dispatched or is on its way. A human must approve first. Say "I am arranging help now, stay on the line."
- Do not give medical instructions beyond keeping the caller calm and on the line.
- Keep every reply under about 25 words.`;
