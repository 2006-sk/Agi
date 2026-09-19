import { detectTriggers, type TriggerContext, type TriggerResult } from "../engine/triggers.js";
import { EMPTY_EXTRACTION, type ModelExtraction } from "../schemas/model-output.js";

/**
 * Deterministic extraction used when the model fails twice (timeout, malformed JSON,
 * schema violation). Everything here comes from the regex trigger layer, so the
 * result is trustworthy for what it did match and silent about everything else.
 */
export function fallbackExtraction(utterance: string, ctx: TriggerContext = {}, triggers?: TriggerResult): ModelExtraction {
  const t = triggers ?? detectTriggers(utterance, ctx);
  const matchedAnything = t.matched.length > 0;

  const summaryParts: string[] = [];
  if (t.chief_complaint) summaryParts.push(`Caller reports ${t.chief_complaint}`);
  if (t.signals.breathing === "no") summaryParts.push("patient is not breathing");
  else if (t.signals.breathing === "labored") summaryParts.push("patient has difficulty breathing");
  if (t.signals.conscious === "no") summaryParts.push("patient is unresponsive");
  else if (t.signals.conscious === "yes") summaryParts.push("patient is conscious");
  if (t.location_raw) summaryParts.push(`location given as ${t.location_raw}`);
  if (t.hazards.length) summaryParts.push(`hazards: ${t.hazards.join(", ")}`);

  return {
    ...EMPTY_EXTRACTION,
    category: t.category ?? "unknown",
    category_confidence: t.category ? 0.8 : 0,
    priority: t.priority_hint ?? "unknown",
    priority_confidence: t.priority_hint ? 0.8 : 0,
    location_raw: t.location_raw,
    location_confidence: t.location_raw ? 0.85 : 0,
    people_at_risk: t.people_at_risk,
    chief_complaint: t.chief_complaint,
    facts: t.facts.map((text) => ({ text, confidence: 0.9 })),
    hazards: [...t.hazards],
    conscious: t.signals.conscious ?? "unknown",
    breathing: t.signals.breathing ?? "unknown",
    contradiction: null,
    summary: summaryParts.length ? `${summaryParts.join("; ")}.` : "No structured information detected in this utterance.",
    confidence: matchedAnything ? 0.6 : 0.2,
  };
}
