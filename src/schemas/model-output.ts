import { z } from "zod";
import { BreathingState, Category, Priority, TriState } from "./incident.js";

/**
 * What the model is allowed to return: observations about the utterance only.
 * It never names protocol steps, tools, or dispatch decisions; those are owned by
 * the deterministic protocol engine.
 */
export const ExtractedFact = z.object({
  text: z.string().describe("Short noun phrase, e.g. 'chest pain', 'adult male', 'not breathing'"),
  confidence: z.number().min(0).max(1),
});

export const ModelExtraction = z.object({
  category: Category.describe("Emergency category suggested by this utterance; 'unknown' if not stated"),
  category_confidence: z.number().min(0).max(1),
  priority: Priority.describe("Urgency suggested by this utterance; 'unknown' if not inferable"),
  priority_confidence: z.number().min(0).max(1),
  location_raw: z
    .string()
    .nullable()
    .describe("Address or place exactly as the caller said it, or null if none was mentioned"),
  location_confidence: z.number().min(0).max(1),
  people_at_risk: z.number().int().min(0).nullable().describe("Number of people affected if stated, else null"),
  chief_complaint: z
    .string()
    .nullable()
    .describe("The main problem in a few words, e.g. 'chest pain', 'house fire', or null"),
  facts: z.array(ExtractedFact).describe("New facts stated in this utterance"),
  hazards: z.array(z.string()).describe("Hazards to responders or the caller, e.g. 'gas smell'"),
  conscious: TriState.describe("Is the patient conscious/responsive per this utterance"),
  breathing: BreathingState.describe(
    "Patient breathing per this utterance: normal, labored (struggling but breathing), no (not breathing), unknown",
  ),
  contradiction: z
    .string()
    .nullable()
    .describe("If this utterance contradicts the current known state, describe it briefly; else null"),
  summary: z.string().describe("One dispatcher-facing sentence summarizing what was learned"),
  confidence: z.number().min(0).max(1).describe("Overall confidence in this extraction"),
});
export type ModelExtraction = z.infer<typeof ModelExtraction>;

export const EMPTY_EXTRACTION: ModelExtraction = {
  category: "unknown",
  category_confidence: 0,
  priority: "unknown",
  priority_confidence: 0,
  location_raw: null,
  location_confidence: 0,
  people_at_risk: null,
  chief_complaint: null,
  facts: [],
  hazards: [],
  conscious: "unknown",
  breathing: "unknown",
  contradiction: null,
  summary: "",
  confidence: 0,
};

/** JSON schema sent as `response_format.json_schema.schema` to the model endpoint. */
export const MODEL_EXTRACTION_JSON_SCHEMA = (() => {
  const schema = z.toJSONSchema(ModelExtraction, { target: "draft-07" }) as Record<string, unknown>;
  delete schema.$schema;
  return schema;
})();

export const MODEL_EXTRACTION_SCHEMA_NAME = "incident_extraction";
