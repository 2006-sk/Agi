import { z } from "zod";
import {
  Assessment,
  Category,
  IncidentState,
  IncidentStatus,
  Location,
  PartialIncidentState,
  Priority,
  ResponsePlan,
  Service,
} from "./incident.js";
import { EventEnvelope } from "./events.js";

export const ToolName = z.enum([
  "normalize_address",
  "geocode_address",
  "find_available_units",
  "calculate_route",
  "create_cad_draft",
  "request_specialist",
]);
export type ToolName = z.infer<typeof ToolName>;

export const AnalyzeRequest = z.object({
  session_id: z.string().min(1),
  utterance: z.string().min(1),
  current_state: PartialIncidentState.optional().default({}),
  conversation_summary: z.string().optional().default(""),
});
export type AnalyzeRequest = z.infer<typeof AnalyzeRequest>;

/** Only the fields that changed this turn; arrays are expressed as additions. */
export const StatePatch = z.object({
  category: Category.optional(),
  priority: Priority.optional(),
  status: IncidentStatus.optional(),
  location: Location.partial().optional(),
  people_at_risk: z.number().int().nullable().optional(),
  facts_added: z.array(z.string()).optional(),
  unverified_facts_added: z.array(z.string()).optional(),
  facts_verified: z.array(z.string()).optional(),
  hazards_added: z.array(z.string()).optional(),
  assessment: Assessment.partial().optional(),
  missing_fields: z.array(z.string()).optional(),
  protocol: z
    .object({
      id: z.string().nullable(),
      step: z.string().nullable(),
    })
    .optional(),
  recommended_services: z.array(Service).optional(),
  response_plan: ResponsePlan.nullable().optional(),
  confidence: z.number().optional(),
  human_required: z.boolean().optional(),
  summary: z.string().optional(),
});
export type StatePatch = z.infer<typeof StatePatch>;

export const ProtocolTransition = z.object({
  protocol_id: z.string(),
  from: z.string().nullable(),
  to: z.string(),
  reason: z.string(),
  escalation: z.boolean().default(false),
});
export type ProtocolTransition = z.infer<typeof ProtocolTransition>;

export const ToolProposal = z.object({
  name: ToolName,
  arguments: z.record(z.string(), z.unknown()),
  human_required: z.boolean(),
  reason: z.string(),
});
export type ToolProposal = z.infer<typeof ToolProposal>;

export const ToolExecution = z.object({
  name: ToolName,
  arguments: z.record(z.string(), z.unknown()),
  result: z.unknown(),
  result_summary: z.string(),
  duration_ms: z.number(),
});
export type ToolExecution = z.infer<typeof ToolExecution>;

export const AnalysisMeta = z.object({
  model: z.string(),
  model_latency_ms: z.number().nullable(),
  source: z.enum(["model", "fallback", "mock", "none"]),
  validation: z.enum(["ok", "retried", "fallback", "low_confidence"]),
  attempts: z.number().int(),
  triggers_matched: z.array(z.string()),
  rejected: z.array(z.string()),
  total_latency_ms: z.number(),
});
export type AnalysisMeta = z.infer<typeof AnalysisMeta>;

export const AnalyzeResponse = z.object({
  session_id: z.string(),
  state_patch: StatePatch,
  protocol_transition: ProtocolTransition.nullable(),
  next_response: z.string(),
  proposed_tools: z.array(ToolProposal),
  confidence: z.number().min(0).max(1),
  // Additive fields for integration:
  executed_tools: z.array(ToolExecution),
  state: IncidentState,
  events: z.array(EventEnvelope),
  explanation: z.string(),
  meta: AnalysisMeta,
});
export type AnalyzeResponse = z.infer<typeof AnalyzeResponse>;

export const ToolExecuteRequest = z.object({
  session_id: z.string().min(1),
  tool: z.object({
    name: ToolName,
    arguments: z.record(z.string(), z.unknown()).default({}),
  }),
  current_state: PartialIncidentState.optional().default({}),
  approved: z.boolean().optional().default(false),
  reviewer: z.string().optional(),
});
export type ToolExecuteRequest = z.infer<typeof ToolExecuteRequest>;

export const ToolExecuteResponse = z.object({
  session_id: z.string(),
  execution: ToolExecution,
  state_patch: StatePatch,
  state: IncidentState,
  events: z.array(EventEnvelope),
});
export type ToolExecuteResponse = z.infer<typeof ToolExecuteResponse>;
