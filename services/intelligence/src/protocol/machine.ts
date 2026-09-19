import type { ToolName } from "../schemas/analyze.js";
import type { BreathingState, IncidentState, TriState } from "../schemas/incident.js";
import type { Escalation, PredicateKey, ProtocolDefinition, StepDefinition } from "./definition.js";

/** Deterministic predicates the protocol JSON can reference. */
export const PREDICATES: Record<PredicateKey, (state: IncidentState) => boolean> = {
  location_captured: (s) => Boolean(s.location.raw),
  location_verified: (s) => s.location.verified,
  chief_complaint: (s) => Boolean(s.assessment.chief_complaint) && s.category !== "unknown",
  consciousness_known: (s) => s.assessment.conscious !== "unknown",
  breathing_known: (s) => s.assessment.breathing !== "unknown",
  hazards_checked: (s) => s.assessment.hazards_checked,
  services_recommended: (s) => s.recommended_services.length > 0,
  not_breathing: (s) => s.assessment.breathing === "no",
  unconscious: (s) => s.assessment.conscious === "no",
  plan_prepared: (s) => s.response_plan !== null,
};

const FIELD_FOR_PREDICATE: Partial<Record<PredicateKey, string>> = {
  location_captured: "location",
  location_verified: "location",
  chief_complaint: "chief_complaint",
  consciousness_known: "consciousness",
  breathing_known: "breathing",
  hazards_checked: "hazards",
  services_recommended: "recommended_services",
};

export function evaluateWhen(clause: string, state: IncidentState): boolean {
  if (clause === "default") return true;
  return clause.split(",").every((rawTerm) => {
    const term = rawTerm.trim();
    const negated = term.startsWith("!");
    const key = (negated ? term.slice(1) : term) as PredicateKey;
    const predicate = PREDICATES[key];
    if (!predicate) throw new Error(`unknown predicate ${key}`);
    const value = predicate(state);
    return negated ? !value : value;
  });
}

export interface Signals {
  conscious?: TriState;
  breathing?: BreathingState;
}

export interface AdvanceResult {
  from: string;
  to: string;
  path: string[];
}

export function renderTemplate(text: string, state: IncidentState, extra: Record<string, string> = {}): string {
  const plan = state.response_plan;
  const values: Record<string, string> = {
    location_raw: state.location.raw ?? "that address",
    location_normalized: state.location.normalized ?? state.location.raw ?? "your location",
    chief_complaint: state.assessment.chief_complaint ?? "the emergency",
    eta_minutes: plan?.route ? String(plan.route.eta_minutes) : "a few",
    unit_id: plan?.units[0]?.unit_id ?? "a unit",
    ...extra,
  };
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, key: string) => values[key] ?? "");
}

export class ProtocolMachine {
  private readonly byId = new Map<string, StepDefinition>();
  private readonly order: string[];

  constructor(readonly def: ProtocolDefinition) {
    for (const step of def.steps) this.byId.set(step.id, step);
    this.order = def.steps.map((s) => s.id);
  }

  get id(): string {
    return this.def.id;
  }

  initialStep(): string {
    return this.def.initial_step;
  }

  hasStep(id: string | null | undefined): id is string {
    return Boolean(id) && this.byId.has(id as string);
  }

  step(id: string): StepDefinition {
    const step = this.byId.get(id);
    if (!step) throw new Error(`protocol ${this.def.id} has no step ${id}`);
    return step;
  }

  indexOf(id: string): number {
    const index = this.order.indexOf(id);
    if (index < 0) throw new Error(`protocol ${this.def.id} has no step ${id}`);
    return index;
  }

  /** Resolve the step for a state, falling back to the initial step when missing or foreign. */
  currentStep(state: IncidentState): string {
    return this.hasStep(state.protocol.step) ? state.protocol.step : this.initialStep();
  }

  /** A step is complete when its predicates hold and, if it must be confirmed, it was asked. */
  isComplete(stepId: string, state: IncidentState): boolean {
    const step = this.step(stepId);
    const predicatesHold = step.required.every((key) => PREDICATES[key](state));
    if (!predicatesHold) return false;
    if (step.confirm && !state.protocol.asked.includes(stepId)) return false;
    return true;
  }

  /** Walk forward through completed steps along the primary edge. Pure. */
  advance(state: IncidentState): AdvanceResult {
    const from = this.currentStep(state);
    let current = from;
    const path = [current];
    for (let guard = 0; guard < this.order.length; guard += 1) {
      if (!this.isComplete(current, state)) break;
      const next = this.step(current).allowed_next[0];
      if (!next) break;
      current = next;
      path.push(current);
    }
    return { from, to: current, path };
  }

  /** Legal if it is the primary/allowed edge or a forward escalation jump. Staying put is legal. */
  canTransition(from: string, to: string): boolean {
    if (from === to) return true;
    if (this.step(from).allowed_next.includes(to)) return true;
    return this.def.escalations.some((e) => e.jump_to === to && this.indexOf(to) > this.indexOf(from));
  }

  escalationsFor(signals: Signals): Escalation[] {
    return this.def.escalations.filter((esc) => {
      const value = esc.signal === "conscious" ? signals.conscious : signals.breathing;
      return value !== undefined && value === esc.value;
    });
  }

  /** Escalations only move forward; a jump behind the current step is ignored. */
  escalationTarget(currentStep: string, esc: Escalation): string {
    if (!esc.jump_to) return currentStep;
    return this.indexOf(esc.jump_to) > this.indexOf(currentStep) ? esc.jump_to : currentStep;
  }

  legalTools(stepId: string): ToolName[] {
    const step = this.step(stepId);
    return Array.from(new Set<ToolName>([...this.def.always_legal_tools, ...step.legal_tools]));
  }

  isToolLegal(stepId: string, tool: ToolName): boolean {
    return this.legalTools(stepId).includes(tool);
  }

  /** The only text AURA may say at a step: the first approved template whose condition holds. */
  selectPrompt(stepId: string, state: IncidentState, extra: Record<string, string> = {}): string {
    const step = this.step(stepId);
    const template = step.prompts.find((p) => evaluateWhen(p.when, state)) ?? step.prompts[step.prompts.length - 1];
    if (!template) throw new Error(`step ${stepId} has no prompts`);
    return renderTemplate(template.text, state, extra);
  }

  /** Unsatisfied required predicates from the start of the protocol through the given step. */
  missingFields(state: IncidentState, stepId: string): string[] {
    const fields: string[] = [];
    const upto = this.indexOf(stepId);
    for (let i = 0; i <= upto; i += 1) {
      const step = this.step(this.order[i] as string);
      for (const key of step.required) {
        if (!PREDICATES[key](state)) {
          const field = FIELD_FOR_PREDICATE[key];
          if (field && !fields.includes(field)) fields.push(field);
        }
      }
    }
    return fields;
  }

  /** For open-ended checks (hazards), any answer after asking completes the step. Mutates the draft. */
  markAnswered(state: IncidentState, stepId: string): boolean {
    const step = this.step(stepId);
    if (!step.complete_on_answer || !state.protocol.asked.includes(stepId)) return false;
    let changed = false;
    for (const key of step.required) {
      if (key === "hazards_checked" && !state.assessment.hazards_checked) {
        state.assessment.hazards_checked = true;
        changed = true;
      }
    }
    return changed;
  }

  humanRequiredAt(stepId: string): boolean {
    return this.step(stepId).human_required;
  }
}
