import { readFileSync } from "node:fs";
import { z } from "zod";
import { ToolName } from "../schemas/analyze.js";
import { Category, Priority, Service } from "../schemas/incident.js";

/**
 * Protocols are data, not model output. This schema validates protocol JSON at
 * load time so a typo can never produce an undefined step at runtime.
 */

export const PREDICATE_KEYS = [
  "location_captured",
  "location_verified",
  "chief_complaint",
  "consciousness_known",
  "breathing_known",
  "hazards_checked",
  "services_recommended",
  "not_breathing",
  "unconscious",
  "plan_prepared",
] as const;
export type PredicateKey = (typeof PREDICATE_KEYS)[number];
export const PredicateKey = z.enum(PREDICATE_KEYS);

/** "default" or comma-separated predicate terms, each optionally negated with "!". */
export const WhenClause = z.string().refine(
  (clause) =>
    clause === "default" ||
    clause
      .split(",")
      .map((t) => t.trim().replace(/^!/, ""))
      .every((t) => (PREDICATE_KEYS as readonly string[]).includes(t)),
  { message: "when clause must be 'default' or predicate keys" },
);

export const PromptTemplate = z.object({
  when: WhenClause.default("default"),
  text: z.string().min(1),
});
export type PromptTemplate = z.infer<typeof PromptTemplate>;

export const StepDefinition = z.object({
  id: z.string().min(1),
  goal: z.string(),
  /** Predicates that must hold before the protocol may leave this step. */
  required: z.array(PredicateKey).default([]),
  /** The approved question must have been asked before this step counts as complete. */
  confirm: z.boolean().default(false),
  /** Any caller answer after the question completes the step (used for open checks like hazards). */
  complete_on_answer: z.boolean().default(false),
  allowed_next: z.array(z.string()).default([]),
  legal_tools: z.array(ToolName).default([]),
  human_required: z.boolean().default(false),
  prompts: z.array(PromptTemplate).min(1),
});
export type StepDefinition = z.infer<typeof StepDefinition>;

export const Escalation = z.object({
  id: z.string().min(1),
  signal: z.enum(["conscious", "breathing"]),
  value: z.string().min(1),
  priority: Priority,
  /** Step to jump forward to; null means "raise priority only". */
  jump_to: z.string().nullable().default(null),
  services: z.array(Service).default([]),
  facts: z.array(z.string()).default([]),
  reason: z.string().min(1),
  propose_specialist: z
    .object({ type: z.string(), reason: z.string() })
    .nullable()
    .default(null),
});
export type Escalation = z.infer<typeof Escalation>;

export const ProtocolDefinition = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    category: Category,
    min_priority: Priority.default("unknown"),
    default_services: z.array(Service).default([]),
    always_legal_tools: z.array(ToolName).default([]),
    initial_step: z.string().min(1),
    steps: z.array(StepDefinition).min(1),
    escalations: z.array(Escalation).default([]),
  })
  .superRefine((def, ctx) => {
    const ids = new Set(def.steps.map((s) => s.id));
    if (ids.size !== def.steps.length) {
      ctx.addIssue({ code: "custom", message: "duplicate step ids" });
    }
    if (!ids.has(def.initial_step)) {
      ctx.addIssue({ code: "custom", message: `initial_step ${def.initial_step} is not a step` });
    }
    for (const step of def.steps) {
      for (const next of step.allowed_next) {
        if (!ids.has(next)) {
          ctx.addIssue({ code: "custom", message: `step ${step.id} allows unknown next step ${next}` });
        }
      }
    }
    for (const esc of def.escalations) {
      if (esc.jump_to !== null && !ids.has(esc.jump_to)) {
        ctx.addIssue({ code: "custom", message: `escalation ${esc.id} jumps to unknown step ${esc.jump_to}` });
      }
    }
  });
export type ProtocolDefinition = z.infer<typeof ProtocolDefinition>;

export function loadProtocolFile(url: URL): ProtocolDefinition {
  const raw = JSON.parse(readFileSync(url, "utf8")) as unknown;
  return ProtocolDefinition.parse(raw);
}
