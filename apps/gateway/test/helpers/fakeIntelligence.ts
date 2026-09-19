/**
 * A stand-in for Pranay's service that behaves the way his integration notes
 * describe: stateless, state-in/state-out, protocol-gated tools, 403 on a
 * consequential tool without `approved: true`.
 *
 * The point is to test the gateway's own behaviour — sequencing, the approval
 * gate, supersession, degradation — without a model in the loop. The real
 * service is exercised separately in `e2e.test.ts`.
 */

import { randomUUID } from "node:crypto";

import type { AuraEvent, IncidentState } from "@aura/contracts";
import {
  IntelligenceError,
  type AnalyzeRequest,
  type AnalyzeResponse,
  type IntelligenceClient,
  type ToolExecuteRequest,
  type ToolExecuteResponse,
} from "../../src/clients/intelligence.js";

const DEMO_UNIT = {
  unit_id: "M-20",
  type: "ALS ambulance",
  station: "Station 20 - Olympia Way",
  latitude: 37.7509,
  longitude: -122.4623,
  eta_minutes: 4,
  distance_km: 1.2,
};

export function emptyState(sessionId: string): IncidentState {
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
    protocol: { id: null, step: null },
    recommended_services: [],
    response_plan: null,
    confidence: 0,
    human_required: false,
    summary: "",
    created_at: "2026-09-19T18:00:00.000Z",
    updated_at: "2026-09-19T18:00:00.000Z",
  };
}

function event(sessionId: string, type: string, payload: Record<string, unknown>, sequence: number): AuraEvent {
  return {
    event_id: `evt_${randomUUID()}`,
    session_id: sessionId,
    type,
    timestamp: "2026-09-19T18:00:00.000Z",
    sequence,
    payload,
  };
}

export interface FakeOptions {
  /** Force every analyze call to fail, as a dead General Compute would. */
  failAnalyze?: boolean;
  /** Report `meta.source: "fallback"`, as two bad model replies would. */
  fallbackMode?: boolean;
  /** Delay each analyze call, to test turn serialization and supersession. */
  latencyMs?: number;
}

/**
 * Recognizes exactly the phrases the demo depends on, deterministically — the
 * same phrases Pranay's service handles without the model.
 */
export class FakeIntelligence implements IntelligenceClient {
  readonly analyzeCalls: AnalyzeRequest[] = [];
  readonly toolCalls: ToolExecuteRequest[] = [];
  options: FakeOptions;

  constructor(options: FakeOptions = {}) {
    this.options = options;
  }

  async analyze(body: AnalyzeRequest): Promise<AnalyzeResponse> {
    this.analyzeCalls.push(structuredClone(body));
    if (this.options.latencyMs) {
      await new Promise((resolve) => setTimeout(resolve, this.options.latencyMs));
    }
    if (this.options.failAnalyze) {
      throw new IntelligenceError("intelligence /internal/analyze -> 503", 503);
    }

    const prior = body.current_state as Partial<IncidentState>;
    const state: IncidentState = {
      ...emptyState(body.session_id),
      ...(prior as IncidentState),
      session_id: body.session_id,
    };
    const text = body.utterance.toLowerCase();
    const events: AuraEvent[] = [];
    let sequence = 0;
    const emit = (type: string, payload: Record<string, unknown>) => {
      sequence += 1;
      events.push(event(body.session_id, type, payload, sequence));
    };

    let nextResponse = "I understand. Can you tell me your address?";
    const proposedTools: AnalyzeResponse["proposed_tools"] = [];
    let transition: AnalyzeResponse["protocol_transition"] = null;

    if (/chest pain|clutching his chest/.test(text)) {
      state.category = "medical";
      state.priority = "high";
      state.assessment = { ...state.assessment, chief_complaint: "chest pain" };
      state.facts = [...new Set([...state.facts, "chest pain"])];
      state.protocol = { id: "MED_CARDIAC_01", step: "verify_location" };
      state.missing_fields = ["location"];
      transition = {
        protocol_id: "MED_CARDIAC_01",
        from: null,
        to: "verify_location",
        reason: "Caller reports chest pain",
        escalation: false,
      };
      emit("protocol.changed", transition as unknown as Record<string, unknown>);
      nextResponse = "What is the address of the emergency?";
    }

    if (/st\.? germain/.test(text)) {
      emit("tool.started", { tool: "normalize_address", arguments: { raw_address: body.utterance } });
      emit("tool.completed", {
        tool: "normalize_address",
        result_summary: "170 St Germain Ave",
        result: { normalized: "170 St Germain Ave, San Francisco, CA 94114" },
        duration_ms: 1,
      });
      emit("tool.started", { tool: "geocode_address", arguments: {} });
      emit("tool.completed", {
        tool: "geocode_address",
        result_summary: "37.754, -122.452",
        result: { latitude: 37.754, longitude: -122.452 },
        duration_ms: 1,
      });
      state.location = {
        raw: "170 St. Germain Avenue",
        normalized: "170 St Germain Ave, San Francisco, CA 94114",
        latitude: 37.754,
        longitude: -122.452,
        confidence: 0.96,
        verified: true,
      };
      state.protocol = { id: "MED_CARDIAC_01", step: "conscious_check" };
      state.missing_fields = ["consciousness"];
      nextResponse = "Is he awake and responding to you?";
    }

    if (/awake|responding|conscious/.test(text)) {
      state.assessment = { ...state.assessment, conscious: "yes" };
      state.protocol = { id: "MED_CARDIAC_01", step: "breathing_check" };
      state.missing_fields = ["breathing"];
      nextResponse = "Is he breathing normally?";
    }

    // The demo's load-bearing trigger. Deterministic on purpose: this must work
    // whether or not a model is reachable.
    if (/stopped breathing|not breathing|no pulse/.test(text)) {
      state.priority = "critical";
      state.category = "medical";
      state.assessment = { ...state.assessment, breathing: "no" };
      state.facts = [...new Set([...state.facts, "not breathing"])];
      state.recommended_services = ["EMS"];
      state.human_required = true;
      state.status = "awaiting_approval";
      state.protocol = { id: "MED_CARDIAC_01", step: "human_dispatch_approval" };
      state.missing_fields = [];

      transition = {
        protocol_id: "MED_CARDIAC_01",
        from: "breathing_check",
        to: "human_dispatch_approval",
        reason: "Caller reports patient is not breathing",
        escalation: true,
      };
      emit("protocol.changed", transition as unknown as Record<string, unknown>);

      const hasLocation = state.location.verified;
      if (hasLocation) {
        emit("tool.started", { tool: "find_available_units", arguments: { service: "EMS" } });
        emit("tool.completed", {
          tool: "find_available_units",
          result_summary: "M-20 available, 4 min",
          result: { units: [DEMO_UNIT] },
          duration_ms: 2,
        });
        emit("tool.started", { tool: "calculate_route", arguments: { unit: "M-20" } });
        emit("tool.completed", {
          tool: "calculate_route",
          result_summary: "1.2 km, 4 min",
          result: { distance_km: 1.2 },
          duration_ms: 2,
        });
        state.response_plan = {
          services: ["EMS"],
          units: [DEMO_UNIT],
          route: {
            unit_id: "M-20",
            distance_km: 1.2,
            eta_minutes: 4,
            polyline: [
              [37.7509, -122.4623],
              [37.7521, -122.4585],
              [37.7530, -122.4552],
              [37.7535, -122.4535],
              [37.754, -122.452],
            ],
          },
          reason: "closest available ALS unit",
          cad_id: null,
        };
        emit("dispatch.proposed", {
          action_id: "act_dispatch_ems",
          services: ["EMS"],
          units: [DEMO_UNIT],
          route: state.response_plan.route,
          reason: "Patient not breathing at a verified address",
          human_required: true,
        });
        proposedTools.push({
          name: "create_cad_draft",
          arguments: {},
          human_required: true,
          reason: "Dispatch requires human approval",
        });
      }
      nextResponse = "I understand. Stay on the line while I alert the emergency dispatcher.";
    }

    state.confidence = 0.94;
    state.updated_at = "2026-09-19T18:00:10.000Z";
    emit("incident.updated", { ...state });

    return {
      session_id: body.session_id,
      state_patch: {},
      protocol_transition: transition,
      next_response: nextResponse,
      proposed_tools: proposedTools,
      confidence: 0.94,
      executed_tools: [],
      state,
      events,
      explanation: `Handled: ${body.utterance.slice(0, 40)}`,
      meta: {
        model: "fake",
        model_latency_ms: 10,
        source: this.options.fallbackMode ? "fallback" : "mock",
        validation: this.options.fallbackMode ? "fallback" : "ok",
        attempts: 1,
        triggers_matched: [],
        rejected: [],
        total_latency_ms: 11,
      },
    };
  }

  async executeTool(body: ToolExecuteRequest): Promise<ToolExecuteResponse> {
    this.toolCalls.push(structuredClone(body));

    // The hard gate, mirroring the real service.
    if (body.tool.name === "create_cad_draft" && !body.approved) {
      throw new IntelligenceError("intelligence /internal/tools/execute -> 403", 403, {
        error: "human_approval_required",
      });
    }

    const state = { ...(body.current_state as IncidentState) };
    const events: AuraEvent[] = [];
    let sequence = 0;
    const emit = (type: string, payload: Record<string, unknown>) => {
      sequence += 1;
      events.push(event(body.session_id, type, payload, sequence));
    };

    emit("tool.started", { tool: body.tool.name, arguments: body.tool.arguments });
    emit("tool.completed", {
      tool: body.tool.name,
      result_summary: "CAD-4417 created",
      result: { cad_id: "CAD-4417", units_assigned: ["M-20"] },
      duration_ms: 3,
    });

    if (body.tool.name === "create_cad_draft") {
      state.status = "dispatched";
      state.human_required = false;
      if (state.response_plan) state.response_plan = { ...state.response_plan, cad_id: "CAD-4417" };
      state.summary = `Dispatch approved by ${body.reviewer ?? "operator"}`;
      emit("incident.updated", { ...state });
    }

    return {
      session_id: body.session_id,
      execution: {
        name: body.tool.name,
        arguments: body.tool.arguments,
        result: { cad_id: "CAD-4417" },
        result_summary: "CAD-4417 created",
        duration_ms: 3,
      },
      state_patch: {},
      state,
      events,
    };
  }

  async health(): Promise<{ ok: boolean; detail: unknown }> {
    return { ok: !this.options.failAnalyze, detail: { mode: "fake" } };
  }
}
