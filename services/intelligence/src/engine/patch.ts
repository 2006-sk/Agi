import type { StatePatch } from "../schemas/analyze.js";
import { type Assessment, IncidentState } from "../schemas/incident.js";

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function added(before: string[], after: string[]): string[] {
  return after.filter((item) => !before.includes(item));
}

/** Express the difference between two states as a StatePatch (arrays as additions). */
export function diffState(before: IncidentState, after: IncidentState): StatePatch {
  const patch: StatePatch = {};
  if (after.category !== before.category) patch.category = after.category;
  if (after.priority !== before.priority) patch.priority = after.priority;
  if (after.status !== before.status) patch.status = after.status;
  if (!sameJson(after.location, before.location)) patch.location = { ...after.location };
  if (after.people_at_risk !== before.people_at_risk) patch.people_at_risk = after.people_at_risk;

  const factsAdded = added(before.facts, after.facts);
  if (factsAdded.length) patch.facts_added = factsAdded;
  const verified = factsAdded.filter((f) => before.unverified_facts.includes(f));
  if (verified.length) patch.facts_verified = verified;
  const unverifiedAdded = added(before.unverified_facts, after.unverified_facts);
  if (unverifiedAdded.length) patch.unverified_facts_added = unverifiedAdded;
  const hazardsAdded = added(before.hazards, after.hazards);
  if (hazardsAdded.length) patch.hazards_added = hazardsAdded;

  const assessment: Partial<Assessment> = {};
  for (const key of Object.keys(after.assessment) as (keyof Assessment)[]) {
    if (after.assessment[key] !== before.assessment[key]) {
      (assessment as Record<string, unknown>)[key] = after.assessment[key];
    }
  }
  if (Object.keys(assessment).length) patch.assessment = assessment;

  if (!sameJson(after.missing_fields, before.missing_fields)) patch.missing_fields = [...after.missing_fields];
  if (after.protocol.id !== before.protocol.id || after.protocol.step !== before.protocol.step) {
    patch.protocol = { id: after.protocol.id, step: after.protocol.step };
  }
  if (!sameJson(after.recommended_services, before.recommended_services)) {
    patch.recommended_services = [...after.recommended_services];
  }
  if (!sameJson(after.response_plan, before.response_plan)) patch.response_plan = after.response_plan;
  if (after.confidence !== before.confidence) patch.confidence = after.confidence;
  if (after.human_required !== before.human_required) patch.human_required = after.human_required;
  if (after.summary !== before.summary) patch.summary = after.summary;
  return patch;
}

/** Apply a StatePatch to a state (for the gateway or tests); returns a new validated state. */
export function applyPatch(state: IncidentState, patch: StatePatch): IncidentState {
  const next = structuredClone(state);
  if (patch.category !== undefined) next.category = patch.category;
  if (patch.priority !== undefined) next.priority = patch.priority;
  if (patch.status !== undefined) next.status = patch.status;
  if (patch.location) next.location = { ...next.location, ...patch.location };
  if (patch.people_at_risk !== undefined) next.people_at_risk = patch.people_at_risk;
  for (const fact of patch.facts_added ?? []) {
    if (!next.facts.includes(fact)) next.facts.push(fact);
    next.unverified_facts = next.unverified_facts.filter((f) => f !== fact);
  }
  for (const fact of patch.unverified_facts_added ?? []) {
    if (!next.unverified_facts.includes(fact) && !next.facts.includes(fact)) next.unverified_facts.push(fact);
  }
  for (const hazard of patch.hazards_added ?? []) {
    if (!next.hazards.includes(hazard)) next.hazards.push(hazard);
  }
  if (patch.assessment) next.assessment = { ...next.assessment, ...patch.assessment };
  if (patch.missing_fields) next.missing_fields = [...patch.missing_fields];
  if (patch.protocol) {
    next.protocol.id = patch.protocol.id;
    next.protocol.step = patch.protocol.step;
  }
  if (patch.recommended_services) next.recommended_services = [...patch.recommended_services];
  if (patch.response_plan !== undefined) next.response_plan = patch.response_plan;
  if (patch.confidence !== undefined) next.confidence = patch.confidence;
  if (patch.human_required !== undefined) next.human_required = patch.human_required;
  if (patch.summary !== undefined) next.summary = patch.summary;
  return IncidentState.parse(next);
}
