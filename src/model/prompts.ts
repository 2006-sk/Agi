import type { IncidentState } from "../schemas/incident.js";
import { MODEL_EXTRACTION_JSON_SCHEMA } from "../schemas/model-output.js";

export interface ExtractionPromptInput {
  utterance: string;
  state: IncidentState;
  conversationSummary?: string;
  stepId: string | null;
  stepGoal: string | null;
  lastPrompt: string | null;
  /** Validation errors from a previous attempt, appended so the model can repair its output. */
  repairNote?: string;
}

export interface ModelMessages {
  system: string;
  user: string;
  /** Structured copy of the inputs for mock clients and logging. */
  utterance: string;
  stepId: string | null;
}

const SYSTEM_PROMPT = `You are the extraction engine for AURA, a human-supervised emergency-intake assistant used in a simulation.
You read ONE new caller utterance plus the known incident state and report OBSERVATIONS as strict JSON.

Rules:
- Report only what this utterance states or clearly implies. Never invent facts, addresses, or medical conclusions.
- You do not choose protocol steps, tools, questions, or dispatch actions. A deterministic protocol engine owns those.
- category: unknown | medical | fire | police | other. Use "unknown" when the utterance does not indicate one.
- priority: unknown | low | medium | high | critical. "critical" means an immediate life threat (not breathing, unresponsive, severe bleeding, people trapped in fire, active violence). Chest pain, difficulty breathing, stroke signs, seizures are at least "high".
- conscious: yes | no | unknown. breathing: normal | labored | no | unknown. "labored" means breathing but struggling (short of breath, gasping, can't catch breath). Use breathing "no" ONLY when the caller says the patient is not breathing or has stopped breathing.
- If AURA's last question was a yes/no question, interpret short answers ("no", "yeah he is") as answers to that question.
- facts: short lowercase noun phrases, e.g. "chest pain", "adult male", "sweating", "not breathing". Give each a confidence from 0 to 1. Do not repeat facts already in the known state unless the utterance restates them.
- chief_complaint: the main problem in a few words if newly stated, else null.
- location_raw: the address or place exactly as spoken, else null. Do not normalize or guess a city.
- people_at_risk: integer only if the caller states or clearly implies how many people are affected; else null.
- hazards: dangers to the caller or responders (gas smell, traffic, weapons, fire spreading), else [].
- contradiction: if the utterance conflicts with the known state (e.g. a different address), describe it in one short clause; else null.
- summary: one plain sentence a dispatcher could read on screen.
- confidence: your overall confidence in this extraction, 0 to 1.
- Output ONLY the JSON object. No prose, no markdown, no code fences.

JSON schema:
${JSON.stringify(MODEL_EXTRACTION_JSON_SCHEMA)}`;

function describeState(state: IncidentState): string {
  const lines: string[] = [];
  lines.push(`- category: ${state.category}; priority: ${state.priority}; status: ${state.status}`);
  if (state.location.raw || state.location.normalized) {
    lines.push(
      `- location: ${state.location.normalized ?? state.location.raw} (${state.location.verified ? "verified" : "unverified"})`,
    );
  } else {
    lines.push("- location: unknown");
  }
  lines.push(`- chief complaint: ${state.assessment.chief_complaint ?? "unknown"}`);
  lines.push(`- conscious: ${state.assessment.conscious}; breathing: ${state.assessment.breathing}`);
  lines.push(`- people at risk: ${state.people_at_risk ?? "unknown"}`);
  lines.push(`- facts: ${state.facts.length ? state.facts.join("; ") : "none yet"}`);
  if (state.unverified_facts.length) lines.push(`- unverified facts: ${state.unverified_facts.join("; ")}`);
  lines.push(`- hazards: ${state.hazards.length ? state.hazards.join("; ") : "none reported"}`);
  return lines.join("\n");
}

export function buildExtractionMessages(input: ExtractionPromptInput): ModelMessages {
  const parts: string[] = [];
  parts.push("KNOWN INCIDENT STATE:");
  parts.push(describeState(input.state));
  if (input.stepId) {
    parts.push(`\nCURRENT PROTOCOL STEP: ${input.stepId}${input.stepGoal ? ` (goal: ${input.stepGoal})` : ""}`);
  }
  if (input.conversationSummary) {
    parts.push(`\nCONVERSATION SO FAR: ${input.conversationSummary}`);
  }
  parts.push(`\nAURA'S LAST QUESTION: ${input.lastPrompt ? JSON.stringify(input.lastPrompt) : "(none yet)"}`);
  parts.push(`\nNEW CALLER UTTERANCE: ${JSON.stringify(input.utterance)}`);
  if (input.repairNote) {
    parts.push(`\nYOUR PREVIOUS REPLY WAS INVALID: ${input.repairNote}\nReply again with only a valid JSON object.`);
  }
  parts.push("\nReturn the JSON object now.");
  return {
    system: SYSTEM_PROMPT,
    user: parts.join("\n"),
    utterance: input.utterance,
    stepId: input.stepId,
  };
}
