import type { Signals } from "../protocol/machine.js";
import type { BreathingState, Category, Priority, TriState } from "../schemas/incident.js";
import type { ModelExtraction } from "../schemas/model-output.js";
import type { TriggerResult } from "./triggers.js";

/** Unified view of what this utterance told us, after reconciling triggers and the model. */
export interface Observations {
  category: Category;
  model_priority: Priority;
  priority_hint: Priority;
  location_raw: string | null;
  location_confidence: number;
  people_at_risk: number | null;
  chief_complaint: string | null;
  /** Facts established deterministically (regex triggers). */
  verified_facts: string[];
  /** Facts proposed by the model with their confidence. */
  model_facts: { text: string; confidence: number }[];
  hazards: string[];
  signals: Signals;
  contradiction: string | null;
  summary: string;
  confidence: number;
  notes: string[];
}

const BREATHING_SEVERITY: Record<BreathingState, number> = { unknown: 0, normal: 1, labored: 2, no: 3 };
const CONSCIOUS_SEVERITY: Record<TriState, number> = { unknown: 0, yes: 1, no: 2 };

export interface MergeOptions {
  /** A model "no" that contradicts an explicit trigger value needs at least this confidence. */
  severeOverrideMinConfidence?: number;
}

export function normalizeFact(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").replace(/[.!?]+$/, "").trim();
}

/**
 * Reconcile the deterministic trigger layer with the (validated, confidence-gated) model
 * output. Triggers win on anything they explicitly matched; severity is biased upward
 * because a missed life threat costs more than an extra question.
 */
export function mergeObservations(
  triggers: TriggerResult,
  model: ModelExtraction | null,
  options: MergeOptions = {},
): Observations {
  const minOverride = options.severeOverrideMinConfidence ?? 0.8;
  const notes: string[] = [];

  const signals: Signals = {};

  // Breathing
  const tb = triggers.signals.breathing;
  const mb = model && model.breathing !== "unknown" ? model.breathing : undefined;
  if (tb && mb) {
    if (mb === "no" && tb !== "no") {
      if (model!.confidence >= minOverride) {
        signals.breathing = "no";
        notes.push(`model reported breathing=no over trigger ${tb} (confidence ${model!.confidence})`);
      } else {
        signals.breathing = tb;
        notes.push(`ignored model breathing=no; trigger says ${tb} and confidence ${model!.confidence} < ${minOverride}`);
      }
    } else {
      signals.breathing = BREATHING_SEVERITY[mb] > BREATHING_SEVERITY[tb] ? mb : tb;
    }
  } else if (tb ?? mb) {
    signals.breathing = tb ?? mb;
  }

  // Consciousness
  const tc = triggers.signals.conscious;
  const mc = model && model.conscious !== "unknown" ? model.conscious : undefined;
  if (tc && mc) {
    if (mc === "no" && tc !== "no") {
      if (model!.confidence >= minOverride) {
        signals.conscious = "no";
        notes.push(`model reported conscious=no over trigger ${tc}`);
      } else {
        signals.conscious = tc;
        notes.push(`ignored model conscious=no; trigger says ${tc}`);
      }
    } else {
      signals.conscious = CONSCIOUS_SEVERITY[mc] > CONSCIOUS_SEVERITY[tc] ? mc : tc;
    }
  } else if (tc ?? mc) {
    signals.conscious = tc ?? mc;
  }

  const category: Category = triggers.category ?? (model && model.category_confidence >= 0.5 ? model.category : "unknown");
  if (triggers.category && model && model.category !== "unknown" && model.category !== triggers.category) {
    notes.push(`category: trigger ${triggers.category} preferred over model ${model.category}`);
  }

  const verified_facts = [...triggers.facts.map(normalizeFact)];
  const model_facts = (model?.facts ?? [])
    .map((f) => ({ text: normalizeFact(f.text), confidence: f.confidence }))
    .filter((f) => f.text.length > 0 && !verified_facts.includes(f.text));

  const hazards = Array.from(new Set([...triggers.hazards, ...(model?.hazards ?? [])].map(normalizeFact).filter(Boolean)));

  const triggersMatched = triggers.matched.length > 0;
  let confidence: number;
  if (model) {
    confidence = triggersMatched ? Math.max(model.confidence, 0.8) : model.confidence;
  } else {
    confidence = triggersMatched ? 0.7 : 0.3;
  }

  const summaryFromTriggers = () => {
    const bits: string[] = [];
    if (triggers.chief_complaint) bits.push(`caller reports ${triggers.chief_complaint}`);
    if (signals.breathing === "no") bits.push("patient not breathing");
    if (signals.conscious === "no") bits.push("patient unresponsive");
    if (triggers.location_raw) bits.push(`address ${triggers.location_raw}`);
    return bits.length ? bits.join("; ") : "";
  };

  return {
    category,
    model_priority: model?.priority ?? "unknown",
    priority_hint: triggers.priority_hint ?? "unknown",
    location_raw: triggers.location_raw ?? model?.location_raw ?? null,
    location_confidence: triggers.location_raw ? 0.9 : model?.location_confidence ?? 0,
    people_at_risk: model?.people_at_risk ?? triggers.people_at_risk,
    chief_complaint: triggers.chief_complaint ?? (model?.chief_complaint ? normalizeFact(model.chief_complaint) : null),
    verified_facts,
    model_facts,
    hazards,
    signals,
    contradiction: model?.contradiction ?? null,
    summary: model?.summary?.trim() || summaryFromTriggers(),
    confidence: Math.round(confidence * 100) / 100,
    notes,
  };
}
