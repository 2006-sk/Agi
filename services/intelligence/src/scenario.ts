import { analyze, type AnalyzerDeps } from "./engine/analyzer.js";
import type { AnalyzeResponse, ToolName } from "./schemas/analyze.js";
import type { IncidentState, PartialIncidentState, Priority } from "./schemas/incident.js";

/** The deterministic medical demo conversation and what each turn must produce. */
export interface ScenarioExpectation {
  step: string;
  priority: Priority;
  category?: IncidentState["category"];
  escalation?: boolean;
  location_verified?: boolean;
  executed?: ToolName[];
  proposed?: ToolName[];
  human_required?: boolean;
  facts_include?: string[];
  events_include?: string[];
}

export interface ScenarioTurn {
  utterance: string;
  expect: ScenarioExpectation;
}

export const MEDICAL_SCENARIO: ScenarioTurn[] = [
  {
    utterance: "Hi, um, my dad is having really bad chest pain",
    expect: {
      step: "verify_location",
      priority: "high",
      category: "medical",
      location_verified: false,
      facts_include: ["chest pain"],
      human_required: false,
      events_include: ["protocol.changed", "incident.updated"],
    },
  },
  {
    utterance: "We're at 170 St. Germain Avenue",
    expect: {
      step: "conscious_check",
      priority: "high",
      location_verified: true,
      executed: ["normalize_address", "geocode_address"],
      events_include: ["tool.started", "tool.completed", "protocol.changed", "incident.updated"],
    },
  },
  {
    utterance: "He's awake but sweating and can't catch his breath",
    expect: {
      step: "breathing_check",
      priority: "high",
      facts_include: ["sweating", "difficulty breathing"],
      human_required: false,
    },
  },
  {
    utterance: "Wait, he stopped breathing",
    expect: {
      step: "human_dispatch_approval",
      priority: "critical",
      escalation: true,
      executed: ["find_available_units", "calculate_route"],
      proposed: ["create_cad_draft", "request_specialist"],
      human_required: true,
      facts_include: ["not breathing"],
      events_include: ["dispatch.proposed", "protocol.changed", "incident.updated"],
    },
  },
];

export interface ScenarioTurnResult {
  utterance: string;
  response: AnalyzeResponse;
  failures: string[];
}

export interface ScenarioRunResult {
  session_id: string;
  turns: ScenarioTurnResult[];
  final_state: IncidentState;
  failures: string[];
}

export function checkExpectation(response: AnalyzeResponse, expect: ScenarioExpectation): string[] {
  const failures: string[] = [];
  const state = response.state;
  if (state.protocol.step !== expect.step) failures.push(`step ${state.protocol.step} != ${expect.step}`);
  if (state.priority !== expect.priority) failures.push(`priority ${state.priority} != ${expect.priority}`);
  if (expect.category && state.category !== expect.category) failures.push(`category ${state.category} != ${expect.category}`);
  if (expect.escalation !== undefined) {
    const actual = response.protocol_transition?.escalation ?? false;
    if (actual !== expect.escalation) failures.push(`escalation ${actual} != ${expect.escalation}`);
  }
  if (expect.location_verified !== undefined && state.location.verified !== expect.location_verified) {
    failures.push(`location.verified ${state.location.verified} != ${expect.location_verified}`);
  }
  for (const tool of expect.executed ?? []) {
    if (!response.executed_tools.some((t) => t.name === tool)) failures.push(`expected executed tool ${tool}`);
  }
  for (const tool of expect.proposed ?? []) {
    const proposal = response.proposed_tools.find((t) => t.name === tool);
    if (!proposal) failures.push(`expected proposed tool ${tool}`);
    else if (!proposal.human_required) failures.push(`proposal ${tool} must have human_required=true`);
  }
  if (expect.human_required !== undefined && state.human_required !== expect.human_required) {
    failures.push(`human_required ${state.human_required} != ${expect.human_required}`);
  }
  for (const fact of expect.facts_include ?? []) {
    if (!state.facts.includes(fact)) failures.push(`expected fact "${fact}" in ${JSON.stringify(state.facts)}`);
  }
  for (const type of expect.events_include ?? []) {
    if (!response.events.some((e) => e.type === type)) failures.push(`expected event ${type}`);
  }
  return failures;
}

export async function runScenario(
  deps: AnalyzerDeps,
  turns: ScenarioTurn[] = MEDICAL_SCENARIO,
  sessionId = "call_001",
): Promise<ScenarioRunResult> {
  let state: PartialIncidentState = {};
  const results: ScenarioTurnResult[] = [];
  let summary = "";
  for (const turn of turns) {
    const response = await analyze(
      { session_id: sessionId, utterance: turn.utterance, current_state: state, conversation_summary: summary },
      deps,
    );
    state = response.state;
    summary = [summary, response.explanation].filter(Boolean).join(" ").slice(-600);
    results.push({ utterance: turn.utterance, response, failures: checkExpectation(response, turn.expect) });
  }
  return {
    session_id: sessionId,
    turns: results,
    final_state: state as IncidentState,
    failures: results.flatMap((r, i) => r.failures.map((f) => `turn ${i + 1}: ${f}`)),
  };
}

/** State with volatile fields removed, for determinism comparisons across runs. */
export function stableState(state: IncidentState): unknown {
  const clone = structuredClone(state) as Record<string, unknown>;
  delete clone.updated_at;
  const plan = clone.response_plan as { proposed_at?: string } | null;
  if (plan) delete plan.proposed_at;
  return clone;
}
