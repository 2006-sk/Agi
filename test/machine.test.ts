import { describe, expect, it } from "vitest";
import { ProtocolDefinition } from "../src/protocol/definition.js";
import { evaluateWhen, renderTemplate } from "../src/protocol/machine.js";
import { getProtocol, listProtocols, protocolForCategory } from "../src/protocol/registry.js";
import { createInitialState, type IncidentState } from "../src/schemas/incident.js";

const medical = protocolForCategory("medical");

function stateAt(step: string, mutate: (s: IncidentState) => void = () => undefined): IncidentState {
  const s = createInitialState("call_test");
  s.category = "medical";
  s.protocol.id = medical.id;
  s.protocol.step = step;
  mutate(s);
  return s;
}

describe("protocol registry", () => {
  it("loads valid protocol definitions from JSON", () => {
    const ids = listProtocols().map((p) => p.id);
    expect(ids).toContain("MED_CARDIAC_01");
    expect(ids).toContain("GENERAL_INTAKE_01");
    expect(medical.def.steps.map((s) => s.id)).toEqual([
      "verify_location",
      "identify_problem",
      "conscious_check",
      "breathing_check",
      "collect_hazards",
      "prepare_response",
      "human_dispatch_approval",
    ]);
  });

  it("maps categories to protocols and unknown ids to undefined", () => {
    expect(protocolForCategory("medical").id).toBe("MED_CARDIAC_01");
    expect(protocolForCategory("unknown").id).toBe("GENERAL_INTAKE_01");
    expect(protocolForCategory("fire").id).toBe("GENERAL_INTAKE_01");
    expect(getProtocol("NOPE")).toBeUndefined();
    expect(getProtocol(null)).toBeUndefined();
  });

  it("rejects protocol definitions with dangling references", () => {
    const broken = {
      ...structuredClone(medical.def),
      steps: medical.def.steps.map((s) => (s.id === "verify_location" ? { ...s, allowed_next: ["does_not_exist"] } : s)),
    };
    expect(() => ProtocolDefinition.parse(broken)).toThrow(/unknown next step/);
    expect(() => ProtocolDefinition.parse({ ...structuredClone(medical.def), initial_step: "nope" })).toThrow(/initial_step/);
  });
});

describe("ProtocolMachine.advance", () => {
  it("stays on verify_location until the address is verified", () => {
    const s = stateAt("verify_location", (st) => {
      st.location.raw = "170 St Germain Ave";
    });
    expect(medical.advance(s).to).toBe("verify_location");
  });

  it("skips already-satisfied steps but stops at unconfirmed clinical checks", () => {
    const s = stateAt("verify_location", (st) => {
      st.location = { raw: "x", normalized: "x", latitude: 1, longitude: 2, confidence: 0.9, verified: true };
      st.assessment.chief_complaint = "chest pain";
      st.assessment.conscious = "yes"; // volunteered, but conscious_check has not been asked
    });
    const result = medical.advance(s);
    expect(result.to).toBe("conscious_check");
    expect(result.path).toEqual(["verify_location", "identify_problem", "conscious_check"]);
  });

  it("advances past a confirm step once it was asked and answered", () => {
    const s = stateAt("conscious_check", (st) => {
      st.location.verified = true;
      st.assessment.chief_complaint = "chest pain";
      st.assessment.conscious = "yes";
      st.protocol.asked = ["verify_location", "conscious_check"];
    });
    expect(medical.advance(s).to).toBe("breathing_check");
  });

  it("does not leave prepare_response without recommended services", () => {
    const s = stateAt("prepare_response", (st) => {
      st.location.verified = true;
      st.assessment.chief_complaint = "chest pain";
      st.assessment.conscious = "yes";
      st.assessment.breathing = "normal";
      st.assessment.hazards_checked = true;
      st.protocol.asked = ["conscious_check", "breathing_check", "collect_hazards"];
    });
    expect(medical.advance(s).to).toBe("prepare_response");
    s.recommended_services = ["EMS"];
    expect(medical.advance(s).to).toBe("human_dispatch_approval");
  });
});

describe("transitions and escalations", () => {
  it("only allows the primary edge or a forward escalation jump", () => {
    expect(medical.canTransition("verify_location", "identify_problem")).toBe(true);
    expect(medical.canTransition("verify_location", "conscious_check")).toBe(false);
    expect(medical.canTransition("breathing_check", "human_dispatch_approval")).toBe(true); // not_breathing jump
    expect(medical.canTransition("collect_hazards", "verify_location")).toBe(false);
    expect(medical.canTransition("collect_hazards", "collect_hazards")).toBe(true);
  });

  it("finds escalations by signal and never jumps backwards", () => {
    const notBreathing = medical.escalationsFor({ breathing: "no" });
    expect(notBreathing.map((e) => e.id)).toEqual(["not_breathing"]);
    expect(medical.escalationTarget("conscious_check", notBreathing[0]!)).toBe("human_dispatch_approval");

    const unconscious = medical.escalationsFor({ conscious: "no" })[0]!;
    expect(medical.escalationTarget("verify_location", unconscious)).toBe("breathing_check");
    expect(medical.escalationTarget("collect_hazards", unconscious)).toBe("collect_hazards");

    const labored = medical.escalationsFor({ breathing: "labored" })[0]!;
    expect(labored.jump_to).toBeNull();
    expect(medical.escalationTarget("conscious_check", labored)).toBe("conscious_check");
    expect(medical.escalationsFor({})).toEqual([]);
  });
});

describe("tools, prompts and missing fields", () => {
  it("exposes legal tools per step including always-legal address tools", () => {
    expect(medical.legalTools("conscious_check")).toEqual(["normalize_address", "geocode_address"]);
    expect(medical.isToolLegal("conscious_check", "create_cad_draft")).toBe(false);
    expect(medical.isToolLegal("human_dispatch_approval", "create_cad_draft")).toBe(true);
    expect(medical.isToolLegal("prepare_response", "find_available_units")).toBe(true);
  });

  it("selects the first approved prompt whose condition holds and renders placeholders", () => {
    const empty = stateAt("verify_location");
    expect(medical.selectPrompt("verify_location", empty)).toMatch(/exact address/);

    const heard = stateAt("verify_location", (st) => {
      st.location.raw = "170 St. Germain Avenue";
    });
    expect(medical.selectPrompt("verify_location", heard)).toBe(
      "I heard 170 St. Germain Avenue. Can you confirm that address, and is there an apartment or floor number?",
    );

    const arrest = stateAt("human_dispatch_approval", (st) => {
      st.location.verified = true;
      st.assessment.breathing = "no";
    });
    expect(medical.selectPrompt("human_dispatch_approval", arrest)).toBe(
      "I understand. Stay on the line while I alert the emergency dispatcher.",
    );

    const noAddress = stateAt("human_dispatch_approval", (st) => {
      st.assessment.breathing = "no";
    });
    expect(medical.selectPrompt("human_dispatch_approval", noAddress)).toMatch(/need the exact address/);
  });

  it("evaluates when-clauses with negation and conjunction", () => {
    const s = stateAt("verify_location", (st) => {
      st.location.raw = "x";
    });
    expect(evaluateWhen("default", s)).toBe(true);
    expect(evaluateWhen("location_captured", s)).toBe(true);
    expect(evaluateWhen("!location_verified", s)).toBe(true);
    expect(evaluateWhen("location_captured,location_verified", s)).toBe(false);
    expect(() => evaluateWhen("bogus", s)).toThrow(/unknown predicate/);
    expect(renderTemplate("ETA {{eta_minutes}} for {{unit_id}} at {{location_normalized}}", s)).toBe("ETA a few for a unit at x");
  });

  it("reports missing fields up to the current step", () => {
    const s = stateAt("human_dispatch_approval", (st) => {
      st.assessment.chief_complaint = "chest pain";
      st.assessment.breathing = "no";
      st.recommended_services = ["EMS"];
    });
    expect(medical.missingFields(s, "human_dispatch_approval")).toEqual(["location", "consciousness", "hazards"]);
    expect(medical.missingFields(s, "verify_location")).toEqual(["location"]);
  });

  it("marks open-ended checks answered only after they were asked", () => {
    const notAsked = stateAt("collect_hazards");
    expect(medical.markAnswered(notAsked, "collect_hazards")).toBe(false);
    expect(notAsked.assessment.hazards_checked).toBe(false);

    const asked = stateAt("collect_hazards", (st) => {
      st.protocol.asked = ["collect_hazards"];
    });
    expect(medical.markAnswered(asked, "collect_hazards")).toBe(true);
    expect(asked.assessment.hazards_checked).toBe(true);
    expect(medical.markAnswered(asked, "conscious_check")).toBe(false);
  });
});
