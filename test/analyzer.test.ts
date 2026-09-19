import { describe, expect, it } from "vitest";
import { analyze, type AnalyzerDeps } from "../src/engine/analyzer.js";
import { applyPatch } from "../src/engine/patch.js";
import type { ModelClient } from "../src/model/client.js";
import { MockModelClient } from "../src/model/mock.js";
import { MEDICAL_SCENARIO, runScenario, stableState } from "../src/scenario.js";
import type { AnalyzeResponse } from "../src/schemas/analyze.js";
import { createInitialState, type IncidentState, type PartialIncidentState } from "../src/schemas/incident.js";

const fixedNow = () => new Date("2026-09-19T18:02:11.120Z");
let counter = 0;
const idGen = () => `evt_${String((counter += 1)).padStart(4, "0")}`;

function deps(model: ModelClient = new MockModelClient(), threshold = 0.5): AnalyzerDeps {
  return { model, confidenceThreshold: threshold, now: fixedNow, idGen };
}

async function turn(utterance: string, state: PartialIncidentState, d: AnalyzerDeps = deps()): Promise<AnalyzeResponse> {
  return analyze({ session_id: "call_test", utterance, current_state: state, conversation_summary: "" }, d);
}

const CONSEQUENTIAL = ["create_cad_draft", "request_specialist"];

describe("scripted medical conversation (mock model)", () => {
  it("follows the expected progression and is deterministic across runs", async () => {
    const first = await runScenario(deps(), MEDICAL_SCENARIO);
    expect(first.failures).toEqual([]);
    const second = await runScenario(deps(), MEDICAL_SCENARIO);
    expect(stableState(second.final_state)).toEqual(stableState(first.final_state));

    const steps = first.turns.map((t) => t.response.state.protocol.step);
    expect(steps).toEqual(["verify_location", "conscious_check", "breathing_check", "human_dispatch_approval"]);
    const priorities = first.turns.map((t) => t.response.state.priority);
    expect(priorities).toEqual(["high", "high", "high", "critical"]);
  });

  it("changes priority and protocol on 'he stopped breathing' within one turn", async () => {
    const result = await runScenario(deps(), MEDICAL_SCENARIO);
    const last = result.turns.at(-1)!.response;
    expect(last.protocol_transition).toMatchObject({
      protocol_id: "MED_CARDIAC_01",
      from: "breathing_check",
      to: "human_dispatch_approval",
      escalation: true,
      reason: "Caller reports patient is not breathing",
    });
    expect(last.state_patch.priority).toBe("critical");
    expect(last.state_patch.facts_added).toContain("not breathing");
    expect(last.state_patch.human_required).toBe(true);
    expect(last.next_response).toBe("I understand. Stay on the line while I alert the emergency dispatcher.");
    expect(last.state.response_plan?.units[0]?.unit_id).toBe("M-20");
    expect(last.state.response_plan?.route?.polyline.at(-1)).toEqual([37.754, -122.452]);
    expect(last.events.map((e) => e.type)).toEqual([
      "tool.started",
      "tool.completed",
      "tool.started",
      "tool.completed",
      "protocol.changed",
      "dispatch.proposed",
      "incident.updated",
    ]);
  });

  it("never executes consequential tools and always flags proposals human_required", async () => {
    const result = await runScenario(deps(), MEDICAL_SCENARIO);
    for (const t of result.turns) {
      expect(t.response.executed_tools.map((e) => e.name).filter((n) => CONSEQUENTIAL.includes(n))).toEqual([]);
      expect(t.response.proposed_tools.every((p) => p.human_required)).toBe(true);
    }
    const last = result.turns.at(-1)!.response;
    expect(last.proposed_tools.map((p) => p.name)).toEqual(["create_cad_draft", "request_specialist"]);
    expect(last.state.human_required).toBe(true);
    expect(last.state.status).toBe("awaiting_approval");
  });

  it("emits well-formed event envelopes with incident.updated last", async () => {
    const result = await runScenario(deps(), MEDICAL_SCENARIO);
    for (const t of result.turns) {
      const events = t.response.events;
      expect(events.map((e) => e.sequence)).toEqual(events.map((_, i) => i + 1));
      expect(events.every((e) => e.session_id === "call_001" && e.timestamp === fixedNow().toISOString())).toBe(true);
      expect(events.at(-1)?.type).toBe("incident.updated");
      expect(events.at(-1)?.payload).toEqual(t.response.state);
    }
  });

  it("produces patches that re-apply to the previous state", async () => {
    let state: PartialIncidentState = {};
    for (const scenarioTurn of MEDICAL_SCENARIO) {
      const before = state;
      const response = await analyze(
        { session_id: "call_001", utterance: scenarioTurn.utterance, current_state: before, conversation_summary: "" },
        deps(),
      );
      const hydratedBefore = { ...createInitialState("call_001", fixedNow()), ...before } as IncidentState;
      const reapplied = applyPatch(hydratedBefore, response.state_patch);
      const strip = (s: IncidentState) => {
        const { updated_at: _u, protocol, ...rest } = s;
        return { ...rest, protocol: { id: protocol.id, step: protocol.step } };
      };
      expect(strip(reapplied)).toEqual(strip(response.state));
      state = response.state;
    }
  });
});

describe("model reliability guards", () => {
  it("keeps the protocol moving on deterministic fallback when the model returns garbage", async () => {
    const garbage = Array.from({ length: 8 }, () => "<<not json>>");
    const model = new MockModelClient({ queue: garbage });
    const result = await runScenario(deps(model), MEDICAL_SCENARIO);
    expect(result.failures).toEqual([]);
    expect(result.turns.every((t) => t.response.meta.source === "fallback")).toBe(true);
    expect(result.turns.every((t) => t.response.meta.validation === "fallback")).toBe(true);
  });

  it("ignores low-confidence model output but still applies triggers", async () => {
    const utterance = "it's my neighbor, he looks kind of grey";
    const model = new MockModelClient({
      script: {
        [utterance.toLowerCase()]: {
          category: "medical",
          category_confidence: 0.9,
          priority: "critical",
          priority_confidence: 0.9,
          facts: [{ text: "grey skin", confidence: 0.9 }],
          confidence: 0.2,
        },
      },
    });
    const r = await turn(utterance, {}, deps(model));
    expect(r.meta.validation).toBe("low_confidence");
    expect(r.state.category).toBe("unknown");
    expect(r.state.priority).toBe("unknown");
    expect(r.state.facts).toEqual([]);
    expect(r.state.protocol.id).toBe("GENERAL_INTAKE_01");
    expect(r.meta.rejected.some((n) => /below threshold/.test(n))).toBe(true);

    // Same low confidence, but a trigger phrase present: the trigger still lands.
    const r2 = await turn("he stopped breathing", {}, deps(new MockModelClient({ script: { "he stopped breathing": { confidence: 0.1 } } })));
    expect(r2.meta.validation).toBe("low_confidence");
    expect(r2.state.priority).toBe("critical");
    expect(r2.state.assessment.breathing).toBe("no");
  });

  it("rejects model priority downgrades and category flips", async () => {
    const critical = (await runScenario(deps(), MEDICAL_SCENARIO)).final_state;
    const utterance = "okay he seems a little better now";
    const model = new MockModelClient({
      script: {
        [utterance]: { category: "other", category_confidence: 0.9, priority: "low", priority_confidence: 0.9, confidence: 0.9 },
      },
    });
    const r = await turn(utterance, critical, deps(model));
    expect(r.state.priority).toBe("critical");
    expect(r.state.category).toBe("medical");
    expect(r.state.protocol.step).toBe("human_dispatch_approval");
    expect(r.meta.rejected).toEqual(
      expect.arrayContaining([expect.stringMatching(/priority downgrade/), expect.stringMatching(/category change/)]),
    );
  });

  it("requires high confidence for the model to contradict an explicit trigger with a life-threat", async () => {
    const base = (await runScenario(deps(), MEDICAL_SCENARIO.slice(0, 3))).final_state; // at breathing_check
    const utterance = "he is breathing normally now";
    const lowConf = new MockModelClient({ script: { [utterance]: { breathing: "no", confidence: 0.6 } } });
    const r1 = await turn(utterance, base, deps(lowConf));
    expect(r1.state.assessment.breathing).toBe("normal");
    expect(r1.protocol_transition?.escalation ?? false).toBe(false);
    expect(r1.state.protocol.step).toBe("collect_hazards");

    const highConf = new MockModelClient({ script: { [utterance]: { breathing: "no", confidence: 0.95 } } });
    const r2 = await turn(utterance, base, deps(highConf));
    expect(r2.state.assessment.breathing).toBe("no");
    expect(r2.state.protocol.step).toBe("human_dispatch_approval");
  });

  it("only ever moves along legal protocol edges", async () => {
    const result = await runScenario(deps(), MEDICAL_SCENARIO);
    const order = ["verify_location", "identify_problem", "conscious_check", "breathing_check", "collect_hazards", "prepare_response", "human_dispatch_approval"];
    let previous = -1;
    for (const t of result.turns) {
      const index = order.indexOf(t.response.state.protocol.step as string);
      expect(index).toBeGreaterThanOrEqual(previous);
      previous = index;
    }
  });
});

describe("other conversation shapes", () => {
  it("escalates an unresponsive patient before the address is known, then asks for it", async () => {
    const r1 = await turn("my wife collapsed and she's not responding", {});
    expect(r1.state.priority).toBe("critical");
    expect(r1.state.protocol.step).toBe("breathing_check");
    expect(r1.protocol_transition?.escalation).toBe(true);
    expect(r1.next_response).toMatch(/Is the person breathing\?/);
    expect(r1.state.missing_fields).toContain("location");

    const r2 = await turn("no she's not breathing", r1.state);
    expect(r2.state.protocol.step).toBe("human_dispatch_approval");
    expect(r2.state.response_plan).toBeNull(); // no verified location yet
    expect(r2.next_response).toMatch(/need the exact address/);
    expect(r2.proposed_tools.map((p) => p.name)).toEqual(["request_specialist"]);

    const r3 = await turn("100 Hoffman Avenue", r2.state);
    expect(r3.state.location.verified).toBe(true);
    expect(r3.state.response_plan?.units.length).toBeGreaterThan(0);
    expect(r3.events.map((e) => e.type)).toContain("dispatch.proposed");
    expect(r3.proposed_tools.map((p) => p.name)).toContain("create_cad_draft");
    expect(r3.next_response).toBe("I understand. Stay on the line while I alert the emergency dispatcher.");
  });

  it("routes non-medical calls through the general intake protocol", async () => {
    const r1 = await turn("hello? there's a fire in my kitchen", {});
    expect(r1.state.category).toBe("fire");
    expect(r1.state.protocol.id).toBe("GENERAL_INTAKE_01");
    expect(r1.state.protocol.step).toBe("verify_location");

    const r2 = await turn("935 Folsom Street", r1.state);
    expect(r2.state.protocol.step).toBe("human_dispatch_approval");
    expect(r2.state.recommended_services).toEqual(["FIRE", "EMS"]);
    expect(r2.state.response_plan?.units.every((u) => u.service === "FIRE")).toBe(true);
    expect(r2.state.human_required).toBe(true);
  });

  it("completes the hazards check on any answer once asked and prepares the response", async () => {
    const base = (await runScenario(deps(), MEDICAL_SCENARIO.slice(0, 3))).final_state; // breathing_check asked
    const r1 = await turn("yes, he's breathing normally", base);
    expect(r1.state.assessment.breathing).toBe("normal");
    expect(r1.state.protocol.step).toBe("collect_hazards");
    expect(r1.next_response).toMatch(/danger/);

    const r2 = await turn("no, nothing like that", r1.state);
    expect(r2.state.assessment.hazards_checked).toBe(true);
    expect(r2.state.protocol.step).toBe("human_dispatch_approval");
    expect(r2.protocol_transition?.reason).toMatch(/Completed collect_hazards, prepare_response/);
    expect(r2.state.response_plan).not.toBeNull();
    expect(r2.next_response).toMatch(/Paramedics are being prepared for 170 St Germain Ave/);
  });

  it("re-verifies a corrected address instead of trusting the old one", async () => {
    const base = (await runScenario(deps(), MEDICAL_SCENARIO.slice(0, 2))).final_state;
    const r = await turn("sorry, it's actually 150 St Germain Avenue", base);
    expect(r.state.location.raw).toBe("150 St Germain Avenue");
    expect(r.state.location.normalized).toBe("150 St Germain Ave, San Francisco, CA 94114");
    expect(r.state.location.verified).toBe(true);
    expect(r.meta.rejected.some((n) => /location corrected/.test(n))).toBe(true);
    expect(r.executed_tools.map((t) => t.name)).toEqual(["normalize_address", "geocode_address"]);
  });

  it("promotes a model fact to verified on its second mention", async () => {
    const model = new MockModelClient({
      script: {
        "his lips are blue": { facts: [{ text: "cyanosis", confidence: 0.6 }], confidence: 0.9 },
        "yeah his lips are really blue": { facts: [{ text: "cyanosis", confidence: 0.6 }], confidence: 0.9 },
      },
    });
    const r1 = await turn("his lips are blue", {}, deps(model));
    expect(r1.state.unverified_facts).toContain("cyanosis");
    expect(r1.state.facts).not.toContain("cyanosis");
    const r2 = await turn("yeah his lips are really blue", r1.state, deps(model));
    expect(r2.state.facts).toContain("cyanosis");
    expect(r2.state.unverified_facts).not.toContain("cyanosis");
    expect(r2.state_patch.facts_verified).toEqual(["cyanosis"]);
  });
});
