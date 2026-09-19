import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { diffState } from "../engine/patch.js";
import { getProtocol, protocolForCategory } from "../protocol/registry.js";
import { ToolExecuteRequest, type ToolExecuteResponse } from "../schemas/analyze.js";
import { EventFactory } from "../schemas/events.js";
import { hydrateState, type IncidentState } from "../schemas/incident.js";
import type { CadDraft, SpecialistRequest } from "../tools/cad.js";
import { executeTool, isConsequential, safeArguments, ToolError } from "../tools/index.js";

export interface ToolRouteOptions {
  now?: () => Date;
  idGen?: () => string;
}

/**
 * Executes a proposed tool. Informational tools run freely; consequential tools
 * (CAD draft, specialist request) require `approved: true`, which the gateway sets
 * only after an `approval.resolved` event from a human reviewer.
 */
export async function toolRoutes(app: FastifyInstance, options: ToolRouteOptions = {}): Promise<void> {
  const now = options.now ?? (() => new Date());
  const idGen = options.idGen ?? (() => `evt_${randomUUID()}`);

  app.post("/internal/tools/execute", async (request, reply) => {
    const parsed = ToolExecuteRequest.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_request",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    const body = parsed.data;
    const before = hydrateState(body.session_id, body.current_state, now());
    const draft: IncidentState = structuredClone(before);
    const toolName = body.tool.name;

    if (isConsequential(toolName) && !body.approved) {
      request.log.warn({ session_id: body.session_id, tool: toolName }, "consequential tool blocked: approval required");
      return reply.code(403).send({
        error: "human_approval_required",
        tool: toolName,
        message: `${toolName} is a consequential action and can only run with approved: true after human review`,
      });
    }

    const machine = getProtocol(draft.protocol.id) ?? protocolForCategory(draft.category);
    const step = machine.currentStep(draft);
    if (!machine.isToolLegal(step, toolName)) {
      return reply.code(409).send({
        error: "illegal_at_step",
        tool: toolName,
        step,
        message: `${toolName} is not permitted by protocol ${machine.id} at step ${step}`,
      });
    }

    const events = new EventFactory(body.session_id, { now, idGen });
    events.emit("tool.started", { tool: toolName, arguments: safeArguments(toolName, body.tool.arguments) });
    let execution;
    try {
      execution = executeTool(toolName, body.tool.arguments, { state: draft, now });
    } catch (error) {
      if (error instanceof ToolError) {
        return reply.code(400).send({ error: error.code, tool: toolName, message: error.message });
      }
      throw error;
    }
    events.emit("tool.completed", {
      tool: toolName,
      result_summary: execution.result_summary,
      result: execution.result,
      duration_ms: execution.duration_ms,
    });

    // Post-effects of consequential tools on the incident state.
    if (toolName === "create_cad_draft") {
      const cad = execution.result as CadDraft;
      if (draft.response_plan) draft.response_plan = { ...draft.response_plan, cad_id: cad.cad_id };
      draft.status = "dispatched";
      draft.human_required = false;
      draft.summary = `Dispatch approved${body.reviewer ? ` by ${body.reviewer}` : ""}: ${cad.incident_type}, ${
        cad.units_assigned.join(", ") || "units pending"
      } (${cad.cad_id})`;
    } else if (toolName === "request_specialist") {
      const spec = execution.result as SpecialistRequest;
      if (!draft.facts.includes(`specialist requested: ${spec.type}`)) draft.facts.push(`specialist requested: ${spec.type}`);
    }
    draft.updated_at = now().toISOString();

    const changed = JSON.stringify(draft) !== JSON.stringify(before);
    if (changed) events.emit("incident.updated", { ...draft });

    request.log.info(
      { session_id: body.session_id, tool: toolName, approved: body.approved, reviewer: body.reviewer, duration_ms: execution.duration_ms },
      "tool executed",
    );

    const response: ToolExecuteResponse = {
      session_id: body.session_id,
      execution,
      state_patch: diffState(before, draft),
      state: draft,
      events: events.all(),
    };
    return reply.send(response);
  });
}
