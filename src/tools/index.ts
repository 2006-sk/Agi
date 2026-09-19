import type { ZodType } from "zod";
import type { ToolExecution, ToolName } from "../schemas/analyze.js";
import type { IncidentState } from "../schemas/incident.js";
import { CreateCadDraftArgs, createCadDraft, RequestSpecialistArgs, requestSpecialist } from "./cad.js";
import {
  CalculateRouteArgs,
  calculateRoute,
  GeocodeAddressArgs,
  geocodeAddress,
  NormalizeAddressArgs,
  normalizeAddress,
} from "./gis.js";
import { FindAvailableUnitsArgs, findAvailableUnits } from "./units.js";

export type ToolKind = "informational" | "consequential";

export interface ToolContext {
  state: IncidentState;
  now: () => Date;
}

export interface ToolDefinition<A = unknown, R = unknown> {
  name: ToolName;
  kind: ToolKind;
  description: string;
  args: ZodType<A>;
  run: (args: A, ctx: ToolContext) => R;
  summarize: (result: R, args: A) => string;
}

export class ToolError extends Error {
  constructor(
    readonly code: "unknown_tool" | "invalid_arguments" | "approval_required" | "illegal_at_step",
    message: string,
  ) {
    super(message);
    this.name = "ToolError";
  }
}

function define<A, R>(def: ToolDefinition<A, R>): ToolDefinition<A, R> {
  return def;
}

const normalizeAddressTool = define({
  name: "normalize_address",
  kind: "informational",
  description: "Normalize a spoken address into a canonical postal form",
  args: NormalizeAddressArgs,
  run: (args) => normalizeAddress(args),
  summarize: (r) => `Normalized to ${r.normalized} (confidence ${r.confidence.toFixed(2)})`,
});

const geocodeAddressTool = define({
  name: "geocode_address",
  kind: "informational",
  description: "Resolve a normalized address to coordinates",
  args: GeocodeAddressArgs,
  run: (args) => geocodeAddress(args),
  summarize: (r) =>
    r.verified ? `Geocoded to ${r.latitude}, ${r.longitude} (${r.source})` : "Address could not be geocoded",
});

const findAvailableUnitsTool = define({
  name: "find_available_units",
  kind: "informational",
  description: "List the closest available responder units for a service",
  args: FindAvailableUnitsArgs,
  run: (args) => findAvailableUnits(args),
  summarize: (r) =>
    r.units.length
      ? `${r.units.length} ${r.service} unit(s) available; closest ${r.units[0]!.unit_id} ~${r.units[0]!.eta_minutes} min`
      : `No ${r.service} units available`,
});

const calculateRouteTool = define({
  name: "calculate_route",
  kind: "informational",
  description: "Estimate the route, distance and ETA from a unit to the incident",
  args: CalculateRouteArgs,
  run: (args) => calculateRoute(args),
  summarize: (r) => `${r.unit_id}: ${r.distance_km} km, ETA ${r.eta_minutes} min`,
});

const createCadDraftTool = define({
  name: "create_cad_draft",
  kind: "consequential",
  description: "Create a CAD dispatch record draft (requires human approval)",
  args: CreateCadDraftArgs,
  run: (args, ctx) => createCadDraft(args, ctx.now(), ctx.state),
  summarize: (r) => `CAD draft ${r.cad_id} created (${r.incident_type}, ${r.priority_code})`,
});

const requestSpecialistTool = define({
  name: "request_specialist",
  kind: "consequential",
  description: "Request a specialist such as pre-arrival instruction support (requires human approval)",
  args: RequestSpecialistArgs,
  run: (args, ctx) => requestSpecialist(args, ctx.now(), ctx.state.session_id),
  summarize: (r) => `Specialist request ${r.request_id} queued (${r.type})`,
});

export const TOOLS: Record<ToolName, ToolDefinition<unknown, unknown>> = {
  normalize_address: normalizeAddressTool as ToolDefinition<unknown, unknown>,
  geocode_address: geocodeAddressTool as ToolDefinition<unknown, unknown>,
  find_available_units: findAvailableUnitsTool as ToolDefinition<unknown, unknown>,
  calculate_route: calculateRouteTool as ToolDefinition<unknown, unknown>,
  create_cad_draft: createCadDraftTool as ToolDefinition<unknown, unknown>,
  request_specialist: requestSpecialistTool as ToolDefinition<unknown, unknown>,
};

export function getTool(name: string): ToolDefinition<unknown, unknown> {
  const tool = (TOOLS as Record<string, ToolDefinition<unknown, unknown> | undefined>)[name];
  if (!tool) throw new ToolError("unknown_tool", `unknown tool ${name}`);
  return tool;
}

export function isConsequential(name: ToolName): boolean {
  return TOOLS[name].kind === "consequential";
}

/** Validate arguments against the tool's schema, run it, and time it. */
export function executeTool(name: ToolName, rawArgs: unknown, ctx: ToolContext): ToolExecution {
  const tool = getTool(name);
  const parsed = tool.args.safeParse(rawArgs);
  if (!parsed.success) {
    const issue = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
    throw new ToolError("invalid_arguments", `invalid arguments for ${name}: ${issue}`);
  }
  const started = performance.now();
  const result = tool.run(parsed.data, ctx);
  return {
    name,
    arguments: safeArguments(name, parsed.data),
    result,
    result_summary: tool.summarize(result, parsed.data),
    duration_ms: Math.round((performance.now() - started) * 100) / 100,
  };
}

/** Arguments as broadcast to the frontend; a full incident state is reduced to a short summary. */
export function safeArguments(name: ToolName, args: unknown): Record<string, unknown> {
  if (name === "create_cad_draft") {
    const state =
      typeof args === "object" && args !== null && "incident_state" in args
        ? (args as { incident_state?: IncidentState }).incident_state
        : undefined;
    if (!state) return {};
    return {
      session_id: state.session_id,
      category: state.category,
      priority: state.priority,
      address: state.location.normalized ?? state.location.raw,
      services: state.recommended_services,
    };
  }
  return typeof args === "object" && args !== null ? (args as Record<string, unknown>) : { value: args };
}
