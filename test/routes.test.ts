import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { buildServer } from "../src/index.js";
import { MEDICAL_SCENARIO } from "../src/scenario.js";
import type { AnalyzeResponse } from "../src/schemas/analyze.js";
import type { IncidentState } from "../src/schemas/incident.js";

let app: FastifyInstance;

beforeAll(async () => {
  const config = loadConfig({ USE_MOCK_MODEL: "true", LOG_LEVEL: "silent" });
  app = await buildServer({ config, logger: false });
});

afterAll(async () => {
  await app.close();
});

async function runDemo(sessionId: string): Promise<IncidentState> {
  let state: Partial<IncidentState> = {};
  for (const turn of MEDICAL_SCENARIO) {
    const res = await app.inject({
      method: "POST",
      url: "/internal/analyze",
      payload: { session_id: sessionId, utterance: turn.utterance, current_state: state },
    });
    expect(res.statusCode).toBe(200);
    state = (res.json() as AnalyzeResponse).state;
  }
  return state as IncidentState;
}

describe("GET /internal/health", () => {
  it("reports the model configuration and loaded protocols", async () => {
    const res = await app.inject({ method: "GET", url: "/internal/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.model_client).toBe("mock");
    expect(body.protocols.map((p: { id: string }) => p.id)).toContain("MED_CARDIAC_01");
  });
});

describe("POST /internal/analyze", () => {
  it("rejects invalid bodies with 400", async () => {
    const res = await app.inject({ method: "POST", url: "/internal/analyze", payload: { session_id: "", utterance: "" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("invalid_request");
  });

  it("returns the contract fields from sambanova.md plus integration extras", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/internal/analyze",
      payload: { session_id: "call_route", utterance: "Wait, he stopped breathing", current_state: {}, conversation_summary: "" },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as AnalyzeResponse;
    expect(Object.keys(body)).toEqual(
      expect.arrayContaining(["state_patch", "protocol_transition", "next_response", "proposed_tools", "confidence", "state", "events", "meta"]),
    );
    expect(body.state_patch.priority).toBe("critical");
    expect(body.state_patch.human_required).toBe(true);
  });
});

describe("POST /internal/tools/execute", () => {
  it("blocks consequential tools without approval (403)", async () => {
    const state = await runDemo("call_tools_a");
    const res = await app.inject({
      method: "POST",
      url: "/internal/tools/execute",
      payload: { session_id: "call_tools_a", tool: { name: "create_cad_draft", arguments: {} }, current_state: state },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("human_approval_required");
  });

  it("rejects tools the protocol does not allow at the current step (409)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/internal/tools/execute",
      payload: { session_id: "call_tools_b", tool: { name: "create_cad_draft", arguments: {} }, current_state: {}, approved: true },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe("illegal_at_step");
  });

  it("executes an approved CAD draft and marks the incident dispatched", async () => {
    const state = await runDemo("call_tools_c");
    const res = await app.inject({
      method: "POST",
      url: "/internal/tools/execute",
      payload: {
        session_id: "call_tools_c",
        tool: { name: "create_cad_draft", arguments: {} },
        current_state: state,
        approved: true,
        reviewer: "dispatcher_1",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.execution.name).toBe("create_cad_draft");
    expect(body.execution.result.cad_id).toMatch(/^CAD-\d{4}-\d{6}$/);
    expect(body.state.status).toBe("dispatched");
    expect(body.state.human_required).toBe(false);
    expect(body.state.response_plan.cad_id).toBe(body.execution.result.cad_id);
    expect(body.state_patch.status).toBe("dispatched");
    expect(body.events.map((e: { type: string }) => e.type)).toEqual(["tool.started", "tool.completed", "incident.updated"]);
  });

  it("runs informational tools without approval and validates arguments", async () => {
    const ok = await app.inject({
      method: "POST",
      url: "/internal/tools/execute",
      payload: { session_id: "call_tools_d", tool: { name: "normalize_address", arguments: { raw_address: "170 St. Germain Avenue" } } },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().execution.result.normalized).toBe("170 St Germain Ave, San Francisco, CA 94114");

    const bad = await app.inject({
      method: "POST",
      url: "/internal/tools/execute",
      payload: { session_id: "call_tools_d", tool: { name: "normalize_address", arguments: {} } },
    });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error).toBe("invalid_arguments");

    const unknown = await app.inject({
      method: "POST",
      url: "/internal/tools/execute",
      payload: { session_id: "call_tools_d", tool: { name: "launch_helicopter", arguments: {} } },
    });
    expect(unknown.statusCode).toBe(400);
  });
});
