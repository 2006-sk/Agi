import { randomUUID } from "node:crypto";
import { type Logger, type ModelClient, runExtraction, silentLogger } from "../model/client.js";
import { fallbackExtraction } from "../model/fallback.js";
import { buildExtractionMessages } from "../model/prompts.js";
import type { ProtocolMachine } from "../protocol/machine.js";
import { getProtocol, protocolForCategory, servicesForCategory } from "../protocol/registry.js";
import {
  type AnalyzeRequest,
  type AnalyzeResponse,
  type ProtocolTransition,
  type ToolExecution,
  type ToolName,
  type ToolProposal,
} from "../schemas/analyze.js";
import { EventFactory } from "../schemas/events.js";
import {
  hydrateState,
  type IncidentState,
  maxPriority,
  PRIORITY_RANK,
  type ResponderUnit,
  type Route,
  type Service,
} from "../schemas/incident.js";
import type { FindAvailableUnitsResult } from "../tools/units.js";
import { fnv1a, normalizeAddress, type GeocodeResult, type NormalizedAddress } from "../tools/gis.js";
import { executeTool, isConsequential, safeArguments, ToolError } from "../tools/index.js";
import { mergeObservations, type Observations } from "./observations.js";
import { diffState } from "./patch.js";
import { detectTriggers } from "./triggers.js";

export interface AnalyzerDeps {
  model: ModelClient;
  confidenceThreshold: number;
  logger?: Logger;
  now?: () => Date;
  idGen?: () => string;
}

function addUnique(list: string[], value: string): boolean {
  if (!value || list.includes(value)) return false;
  list.push(value);
  return true;
}

function addressKey(text: string): string {
  return normalizeAddress({ raw_address: text }).key;
}

/**
 * Turn one finalized caller utterance plus the current incident state into a validated
 * incident update. The model observes; the protocol engine decides.
 */
export async function analyze(request: AnalyzeRequest, deps: AnalyzerDeps): Promise<AnalyzeResponse> {
  const startedAt = performance.now();
  const logger = deps.logger ?? silentLogger;
  const now = deps.now ?? (() => new Date());
  const idGen = deps.idGen ?? (() => `evt_${randomUUID()}`);

  const before = hydrateState(request.session_id, request.current_state, now());
  const draft: IncidentState = structuredClone(before);
  const rejected: string[] = [];
  const events = new EventFactory(request.session_id, { now, idGen });
  const executed: ToolExecution[] = [];
  const proposals: ToolProposal[] = [];

  // ---- 1. Protocol context at the start of the turn -------------------------------------
  let machine: ProtocolMachine = getProtocol(draft.protocol.id) ?? protocolForCategory(draft.category);
  const stepAtStart: string | null = machine.hasStep(draft.protocol.step) ? draft.protocol.step : null;
  const contextStep = stepAtStart ?? machine.initialStep();

  // ---- 2. Deterministic triggers and model extraction --------------------------------------
  const triggers = detectTriggers(request.utterance, {
    step: stepAtStart,
    lastPrompt: draft.protocol.last_prompt,
  });

  const promptInput = {
    utterance: request.utterance,
    state: draft,
    conversationSummary: request.conversation_summary,
    stepId: stepAtStart,
    stepGoal: machine.step(contextStep).goal,
    lastPrompt: draft.protocol.last_prompt,
  };
  const extraction = await runExtraction(deps.model, buildExtractionMessages(promptInput), {
    logger,
    fallback: () => fallbackExtraction(request.utterance, { step: stepAtStart, lastPrompt: draft.protocol.last_prompt }, triggers),
    buildRepair: (note) => buildExtractionMessages({ ...promptInput, repairNote: note }),
  });

  // ---- 3. Confidence gate --------------------------------------------------------------------
  let validation: AnalyzeResponse["meta"]["validation"] = extraction.validation;
  let modelApplied = true;
  if (extraction.source !== "fallback" && extraction.extraction.confidence < deps.confidenceThreshold) {
    modelApplied = false;
    validation = "low_confidence";
    rejected.push(
      `model output ignored: confidence ${extraction.extraction.confidence} below threshold ${deps.confidenceThreshold}`,
    );
  }
  const obs: Observations = mergeObservations(triggers, modelApplied ? extraction.extraction : null);
  rejected.push(...obs.notes);

  // ---- 4. Category and protocol selection ------------------------------------------------------
  const transitionReasons: string[] = [];
  if (obs.category !== "unknown" && obs.category !== draft.category) {
    if (draft.category === "unknown") {
      draft.category = obs.category;
    } else {
      rejected.push(`category change ${draft.category} -> ${obs.category} ignored; requires human review`);
    }
  }
  const targetMachine = protocolForCategory(draft.category);
  if (targetMachine.id !== draft.protocol.id) {
    const previousStep = draft.protocol.step;
    const hadProtocol = draft.protocol.id !== null;
    machine = targetMachine;
    draft.protocol.id = machine.id;
    draft.protocol.step = machine.hasStep(previousStep) ? previousStep : machine.initialStep();
    transitionReasons.push(
      hadProtocol
        ? `Category classified as ${draft.category}; switched to protocol ${machine.id}`
        : `Protocol ${machine.id} selected for ${draft.category} intake`,
    );
  } else if (!machine.hasStep(draft.protocol.step)) {
    draft.protocol.step = machine.initialStep();
  }

  const currentStep = (): string => draft.protocol.step as string;

  // ---- 5. Apply observations ---------------------------------------------------------------------
  // Location capture / correction
  if (obs.location_raw) {
    const incoming = obs.location_raw.trim();
    if (!draft.location.raw) {
      draft.location = { raw: incoming, normalized: null, latitude: null, longitude: null, confidence: 0, verified: false };
    } else if (addressKey(incoming) !== addressKey(draft.location.raw)) {
      if (!draft.location.verified || obs.location_confidence >= 0.8) {
        rejected.push(`location corrected from "${draft.location.raw}" to "${incoming}"; re-verifying`);
        draft.location = { raw: incoming, normalized: null, latitude: null, longitude: null, confidence: 0, verified: false };
      } else {
        rejected.push(`conflicting address "${incoming}" ignored (low confidence); keeping verified location`);
      }
    }
  }

  if (!draft.assessment.chief_complaint && obs.chief_complaint) draft.assessment.chief_complaint = obs.chief_complaint;
  if (obs.signals.conscious) draft.assessment.conscious = obs.signals.conscious;
  if (obs.signals.breathing) draft.assessment.breathing = obs.signals.breathing;
  if (obs.people_at_risk !== null && obs.people_at_risk !== draft.people_at_risk) draft.people_at_risk = obs.people_at_risk;

  for (const fact of obs.verified_facts) {
    addUnique(draft.facts, fact);
    draft.unverified_facts = draft.unverified_facts.filter((f) => f !== fact);
  }
  for (const fact of obs.model_facts) {
    if (draft.facts.includes(fact.text)) continue;
    if (draft.unverified_facts.includes(fact.text)) {
      // Second mention corroborates the fact.
      draft.unverified_facts = draft.unverified_facts.filter((f) => f !== fact.text);
      draft.facts.push(fact.text);
    } else {
      draft.unverified_facts.push(fact.text);
    }
  }
  for (const hazard of obs.hazards) addUnique(draft.hazards, hazard);
  if (obs.hazards.length && stepAtStart === "collect_hazards") draft.assessment.hazards_checked = true;

  // Priority is monotonic within a call: upgrades apply, downgrades are rejected.
  let priority = maxPriority(draft.priority, machine.def.min_priority);
  if (obs.priority_hint !== "unknown") priority = maxPriority(priority, obs.priority_hint);
  if (modelApplied && obs.model_priority !== "unknown") {
    if (PRIORITY_RANK[obs.model_priority] < PRIORITY_RANK[draft.priority]) {
      rejected.push(`model priority downgrade ${draft.priority} -> ${obs.model_priority} ignored`);
    } else {
      priority = maxPriority(priority, obs.model_priority);
    }
  }
  draft.priority = priority;
  if (obs.summary) draft.summary = obs.summary;

  // Open-ended checks (hazards) complete on any answer once asked.
  if (stepAtStart) machine.markAnswered(draft, stepAtStart);

  // ---- 6. Escalations (deterministic, from this turn's signals) ---------------------------------
  const escalations = machine.escalationsFor(obs.signals);
  let escalated = false;
  let specialistProposal: { type: string; reason: string } | null = null;
  for (const esc of escalations) {
    draft.priority = maxPriority(draft.priority, esc.priority);
    for (const service of esc.services) addUnique(draft.recommended_services as string[], service);
    for (const fact of esc.facts) {
      addUnique(draft.facts, fact);
      draft.unverified_facts = draft.unverified_facts.filter((f) => f !== fact);
    }
    const target = machine.escalationTarget(currentStep(), esc);
    if (target !== currentStep()) {
      if (!machine.canTransition(currentStep(), target)) {
        rejected.push(`escalation ${esc.id} jump ${currentStep()} -> ${target} not legal; ignored`);
      } else {
        draft.protocol.step = target;
        escalated = true;
        transitionReasons.push(esc.reason);
      }
    } else if (esc.jump_to) {
      transitionReasons.push(esc.reason);
    }
    if (esc.propose_specialist) specialistProposal = esc.propose_specialist;
    if (esc.priority === "critical") draft.human_required = true;
  }

  // ---- 7. Informational tools -------------------------------------------------------------------
  const runInformational = (name: ToolName, args: Record<string, unknown>): ToolExecution | null => {
    if (isConsequential(name)) {
      rejected.push(`tool ${name} is consequential and cannot run without approval`);
      return null;
    }
    if (!machine.isToolLegal(currentStep(), name)) {
      rejected.push(`tool ${name} not legal at step ${currentStep()}`);
      return null;
    }
    events.emit("tool.started", { tool: name, arguments: safeArguments(name, args) });
    try {
      const execution = executeTool(name, args, { state: draft, now });
      events.emit("tool.completed", {
        tool: name,
        result_summary: execution.result_summary,
        result: execution.result,
        duration_ms: execution.duration_ms,
      });
      executed.push(execution);
      return execution;
    } catch (error) {
      const message = error instanceof ToolError ? error.message : String(error);
      rejected.push(`tool ${name} failed: ${message}`);
      events.emit("tool.completed", { tool: name, result_summary: `failed: ${message}`, result: null, duration_ms: 0 });
      return null;
    }
  };

  if (draft.location.raw && !draft.location.verified) {
    const normalized = runInformational("normalize_address", { raw_address: draft.location.raw });
    if (normalized) {
      const result = normalized.result as NormalizedAddress;
      draft.location.normalized = result.normalized;
      draft.location.confidence = result.confidence;
      const geocoded = runInformational("geocode_address", { normalized_address: result.normalized });
      if (geocoded) {
        const geo = geocoded.result as GeocodeResult;
        draft.location.latitude = geo.latitude;
        draft.location.longitude = geo.longitude;
        draft.location.verified = geo.verified;
        draft.location.confidence = Math.min(result.confidence, geo.confidence);
        if (!geo.verified) rejected.push("address could not be geocoded; location remains unverified");
      }
    }
  }

  // ---- 8. Advance through completed steps ----------------------------------------------------------
  const completedPath: string[] = [];
  for (let round = 0; round < 3; round += 1) {
    const advanced = machine.advance(draft);
    if (advanced.to !== advanced.from) {
      if (!machine.canTransition(advanced.from, advanced.path[1] as string)) {
        rejected.push(`transition ${advanced.from} -> ${advanced.to} not legal; staying`);
        break;
      }
      draft.protocol.step = advanced.to;
      completedPath.push(...advanced.path.slice(0, -1));
    }
    // Entering prepare_response selects services deterministically, then keeps advancing.
    if (currentStep() === "prepare_response" && draft.recommended_services.length === 0) {
      const services: Service[] = machine.def.default_services.length
        ? machine.def.default_services
        : servicesForCategory(draft.category);
      if (services.length) {
        draft.recommended_services = [...services];
        continue;
      }
    }
    break;
  }
  if (completedPath.length) transitionReasons.push(`Completed ${completedPath.join(", ")}`);
  if (currentStep() === "human_dispatch_approval" && draft.recommended_services.length === 0) {
    const services: Service[] = machine.def.default_services.length
      ? machine.def.default_services
      : servicesForCategory(draft.category);
    if (services.length) draft.recommended_services = [...services];
  }

  // ---- 9. Prepare the response plan (units + route) when legal ---------------------------------
  let newPlan = false;
  const canPlan =
    draft.location.verified &&
    draft.location.latitude !== null &&
    draft.location.longitude !== null &&
    draft.recommended_services.length > 0 &&
    machine.isToolLegal(currentStep(), "find_available_units");
  if (canPlan) {
    const incidentLocation = { latitude: draft.location.latitude as number, longitude: draft.location.longitude as number };
    const planIsCurrent =
      draft.response_plan !== null &&
      draft.response_plan.route !== null &&
      draft.response_plan.route.polyline.at(-1)?.[0] === incidentLocation.latitude &&
      draft.response_plan.route.polyline.at(-1)?.[1] === incidentLocation.longitude &&
      JSON.stringify(draft.response_plan.services) === JSON.stringify(draft.recommended_services);
    if (!planIsCurrent) {
      const service = draft.recommended_services[0] as Service;
      const unitsExecution = runInformational("find_available_units", { service, location: incidentLocation, limit: 3 });
      if (unitsExecution) {
        const units = (unitsExecution.result as FindAvailableUnitsResult).units as ResponderUnit[];
        let route: Route | null = null;
        const closest = units[0];
        if (closest) {
          const routeExecution = runInformational("calculate_route", {
            unit: { unit_id: closest.unit_id, latitude: closest.latitude, longitude: closest.longitude },
            incident_location: incidentLocation,
          });
          route = (routeExecution?.result as Route | undefined) ?? null;
        }
        const reason =
          transitionReasons.find((r) => escalations.some((e) => e.reason === r)) ??
          `${draft.recommended_services.join("/")} response prepared for ${draft.assessment.chief_complaint ?? draft.category} incident`;
        draft.response_plan = {
          services: [...draft.recommended_services],
          units,
          route,
          reason,
          proposed_at: now().toISOString(),
          cad_id: null,
        };
        newPlan = true;
      }
    }
  }

  // ---- 10. Consequential proposals (never executed here) -----------------------------------------
  if (draft.response_plan && !draft.response_plan.cad_id && machine.isToolLegal(currentStep(), "create_cad_draft")) {
    proposals.push({
      name: "create_cad_draft",
      arguments: {},
      human_required: true,
      reason: `Dispatch ${draft.response_plan.services.join("/")} (${draft.response_plan.units[0]?.unit_id ?? "unit"}) to ${
        draft.location.normalized ?? draft.location.raw
      }`,
    });
  }
  if (specialistProposal && machine.isToolLegal(currentStep(), "request_specialist")) {
    proposals.push({
      name: "request_specialist",
      arguments: { type: specialistProposal.type, reason: specialistProposal.reason },
      human_required: true,
      reason: specialistProposal.reason,
    });
  } else if (specialistProposal) {
    rejected.push(`request_specialist not legal at step ${currentStep()}; proposal withheld`);
  }

  // ---- 11. Finalize state ------------------------------------------------------------------------------
  if (draft.response_plan && draft.status === "active") draft.status = "awaiting_approval";
  draft.human_required =
    draft.human_required || machine.humanRequiredAt(currentStep()) || proposals.length > 0 || draft.status === "awaiting_approval";
  draft.missing_fields = machine.missingFields(draft, currentStep());
  draft.confidence = obs.confidence;
  draft.updated_at = now().toISOString();

  const nextResponse = machine.selectPrompt(currentStep(), draft);
  addUnique(draft.protocol.asked, currentStep());
  draft.protocol.last_prompt = nextResponse;

  // ---- 12. Transition, events, patch --------------------------------------------------------------------
  let transition: ProtocolTransition | null = null;
  if (draft.protocol.id !== before.protocol.id || draft.protocol.step !== before.protocol.step) {
    transition = {
      protocol_id: machine.id,
      from: before.protocol.step,
      to: currentStep(),
      reason: transitionReasons.join("; ") || "Protocol state updated",
      escalation: escalated,
    };
    events.emit("protocol.changed", {
      protocol_id: transition.protocol_id,
      previous_step: transition.from,
      current_step: transition.to,
      reason: transition.reason,
      escalation: transition.escalation,
    });
  }
  if (newPlan && draft.response_plan) {
    events.emit("dispatch.proposed", {
      action_id: `dispatch_${fnv1a(`${draft.session_id}:${draft.response_plan.proposed_at}`).toString(16)}`,
      services: draft.response_plan.services,
      units: draft.response_plan.units,
      route: draft.response_plan.route,
      reason: draft.response_plan.reason,
      human_required: true,
    });
  }
  const finalState = structuredClone(draft);
  events.emit("incident.updated", { ...finalState });

  const explanation =
    (escalated ? transitionReasons.find((r) => escalations.some((e) => e.reason === r)) : undefined) ??
    obs.summary ??
    transition?.reason ??
    "No new information extracted.";

  const response: AnalyzeResponse = {
    session_id: request.session_id,
    state_patch: diffState(before, finalState),
    protocol_transition: transition,
    next_response: nextResponse,
    proposed_tools: proposals,
    confidence: obs.confidence,
    executed_tools: executed,
    state: finalState,
    events: events.all(),
    explanation: explanation || "No new information extracted.",
    meta: {
      model: extraction.model,
      model_latency_ms: extraction.latency_ms,
      source: extraction.source,
      validation,
      attempts: extraction.attempts,
      triggers_matched: triggers.matched,
      rejected,
      total_latency_ms: Math.round(performance.now() - startedAt),
    },
  };

  logger.info(
    {
      session_id: request.session_id,
      step: `${before.protocol.step ?? "-"} -> ${currentStep()}`,
      priority: draft.priority,
      model: response.meta.model,
      model_latency_ms: response.meta.model_latency_ms,
      source: response.meta.source,
      validation,
      triggers: triggers.matched,
      rejected: rejected.length,
      total_latency_ms: response.meta.total_latency_ms,
    },
    "analyze turn complete",
  );
  return response;
}
