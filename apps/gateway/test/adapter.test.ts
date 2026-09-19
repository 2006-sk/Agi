import { describe, expect, it } from "vitest";

import { initialProjection, project, type ProjectionState } from "../src/adapter/toFrontend.js";
import { ANCHOR_LAT, ANCHOR_LNG, polylineToPath, toVec2 } from "../src/adapter/geo.js";
import type { IncidentState } from "@aura/contracts";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function baseIncident(overrides: Partial<IncidentState> = {}): IncidentState {
  return {
    session_id: "call_001",
    category: "medical",
    priority: "high",
    status: "active",
    location: {
      raw: "170 St. Germain Avenue",
      normalized: "170 St Germain Ave, San Francisco, CA 94114",
      latitude: 37.754,
      longitude: -122.452,
      confidence: 0.96,
      verified: true,
    },
    people_at_risk: 1,
    facts: ["adult male", "chest pain"],
    unverified_facts: ["address repeated"],
    hazards: [],
    assessment: {
      chief_complaint: "chest pain",
      conscious: "yes",
      breathing: "labored",
      hazards_checked: false,
    },
    missing_fields: ["hazards"],
    protocol: { id: "MED_CARDIAC_01", step: "breathing_check" },
    recommended_services: ["EMS"],
    response_plan: null,
    confidence: 0.93,
    human_required: false,
    summary: "Adult with chest pain",
    created_at: "2026-09-19T18:00:00.000Z",
    updated_at: "2026-09-19T18:00:10.000Z",
    ...overrides,
  };
}

function fresh(): ProjectionState {
  return initialProjection("call-call_001", "INC-call_001");
}

function typesOf(events: { type: string }[]): string[] {
  return events.map((e) => e.type);
}

/* ------------------------------------------------------------------ */
/* Geo                                                                 */
/* ------------------------------------------------------------------ */

describe("geo projection", () => {
  it("anchors the demo address exactly where the mock script put the incident", () => {
    expect(toVec2(ANCHOR_LAT, ANCHOR_LNG)).toEqual({ x: 12.5, z: -27 });
  });

  it("puts north at -z and east at +x", () => {
    const north = toVec2(ANCHOR_LAT + 0.01, ANCHOR_LNG);
    const east = toVec2(ANCHOR_LAT, ANCHOR_LNG + 0.01);
    expect(north.z).toBeLessThan(-27);
    expect(east.x).toBeGreaterThan(12.5);
  });

  it("keeps a far-away unit on the plate instead of losing it off screen", () => {
    const faraway = toVec2(37.9, -122.2);
    expect(Math.abs(faraway.x)).toBeLessThanOrEqual(58);
    expect(Math.abs(faraway.z)).toBeLessThanOrEqual(58);
  });

  it("keeps the closest EMS station inside the city", () => {
    // M-20, Station 20 Olympia Way — the unit the demo always dispatches.
    const m20 = toVec2(37.7509, -122.4623);
    expect(Math.abs(m20.x)).toBeLessThan(58);
    expect(Math.abs(m20.z)).toBeLessThan(58);
  });

  it("drops malformed polyline points rather than emitting NaN coordinates", () => {
    const path = polylineToPath([
      [37.754, -122.452],
      // @ts-expect-error deliberately malformed input from an upstream change
      ["bad", null],
      [37.7509, -122.4623],
    ]);
    expect(path).toHaveLength(2);
    for (const p of path) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.z)).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Projection                                                          */
/* ------------------------------------------------------------------ */

describe("incident.updated projection", () => {
  it("activates the protocol before emitting any step", () => {
    const { events } = project("incident.updated", baseIncident() as never, fresh());
    const protocolEvents = typesOf(events).filter((t) => t.startsWith("protocol."));
    expect(protocolEvents[0]).toBe("protocol.activated");
    expect(protocolEvents).toContain("protocol.step");
  });

  it("marks every earlier protocol step done and the current one active", () => {
    const { events } = project("incident.updated", baseIncident() as never, fresh());
    const steps = events.filter((e) => e.type === "protocol.step");
    const byId = Object.fromEntries(steps.map((e) => [e.payload.step_id, e.payload.status]));
    expect(byId.verify_location).toBe("done");
    expect(byId.identify_problem).toBe("done");
    expect(byId.conscious_check).toBe("done");
    expect(byId.breathing_check).toBe("active");
    // Steps the call has not reached are not reported at all.
    expect(byId.human_dispatch_approval).toBeUndefined();
  });

  it("classifies once, then reclassifies with the previous priority", () => {
    const first = project("incident.updated", baseIncident() as never, fresh());
    expect(typesOf(first.events)).toContain("incident.classified");

    const second = project(
      "incident.updated",
      baseIncident({ priority: "critical" }) as never,
      first.state,
    );
    const reclass = second.events.find((e) => e.type === "incident.reclassified");
    expect(reclass).toBeDefined();
    expect(reclass?.payload.previous_priority).toBe("high");
    expect(reclass?.payload.priority).toBe("critical");
    expect(typesOf(second.events)).not.toContain("incident.classified");
  });

  it("never walks priority back down on its own", () => {
    const up = project("incident.updated", baseIncident({ priority: "critical" }) as never, fresh());
    const down = project("incident.updated", baseIncident({ priority: "low" }) as never, up.state);
    expect(down.state.priority).toBe("critical");
  });

  it("emits location.verified with city coordinates only when verified", () => {
    const unverified = baseIncident({
      location: { ...baseIncident().location, verified: false, confidence: 0.4 },
    });
    const a = project("incident.updated", unverified as never, fresh());
    expect(typesOf(a.events)).toContain("location.candidate");
    expect(typesOf(a.events)).not.toContain("location.verified");

    const b = project("incident.updated", baseIncident() as never, a.state);
    const verified = b.events.find((e) => e.type === "location.verified");
    expect(verified).toBeDefined();
    expect(verified?.payload.coords).toEqual({ x: 12.5, z: -27 });
  });

  it("does not re-emit a fact it has already reported", () => {
    const first = project("incident.updated", baseIncident() as never, fresh());
    const factCount = first.events.filter((e) => e.type === "fact.extracted").length;
    expect(factCount).toBeGreaterThan(0);

    const second = project("incident.updated", baseIncident() as never, first.state);
    expect(second.events.filter((e) => e.type === "fact.extracted")).toHaveLength(0);
  });

  it("re-emits a fact whose value actually changed", () => {
    const first = project("incident.updated", baseIncident() as never, fresh());
    const changed = baseIncident({
      assessment: { ...baseIncident().assessment, breathing: "no" },
    });
    const second = project("incident.updated", changed as never, first.state);
    const breathing = second.events.find(
      (e) => e.type === "fact.extracted" && e.payload.key === "breathing",
    );
    expect(breathing?.payload.value).toBe("no");
    expect(breathing?.payload.critical).toBe(true);
  });

  it("flags life-threat observations as critical", () => {
    const incident = baseIncident({ facts: ["adult male", "not breathing"] });
    const { events } = project("incident.updated", incident as never, fresh());
    const fact = events.find(
      (e) => e.type === "fact.extracted" && String(e.payload.value) === "not breathing",
    );
    expect(fact?.payload.critical).toBe(true);
  });

  it("keeps model-only facts off the deck", () => {
    const { events } = project("incident.updated", baseIncident() as never, fresh());
    const values = events
      .filter((e) => e.type === "fact.extracted")
      .map((e) => String(e.payload.value));
    expect(values).not.toContain("address repeated");
  });

  it("reports missing fields once, with readable labels", () => {
    const first = project("incident.updated", baseIncident() as never, fresh());
    const missing = first.events.find((e) => e.type === "fact.missing");
    expect(missing?.payload.label).toBe("Scene hazards");

    const second = project("incident.updated", baseIncident() as never, first.state);
    expect(second.events.filter((e) => e.type === "fact.missing")).toHaveLength(0);
  });

  it("emits units and route from a response plan", () => {
    const incident = baseIncident({
      response_plan: {
        services: ["EMS"],
        units: [
          {
            unit_id: "M-20",
            type: "ALS ambulance",
            station: "Station 20",
            latitude: 37.7509,
            longitude: -122.4623,
            eta_minutes: 4,
            distance_km: 1.2,
          },
        ],
        route: {
          unit_id: "M-20",
          distance_km: 1.2,
          eta_minutes: 4,
          polyline: [
            [37.7509, -122.4623],
            [37.754, -122.452],
          ],
        },
        reason: "closest available ALS unit",
        cad_id: null,
      },
    });
    const { events } = project("incident.updated", incident as never, fresh());

    const units = events.find((e) => e.type === "responders.available");
    expect(units).toBeDefined();
    const unitList = units?.payload.units as { kind: string; eta_s: number; distance_m: number }[];
    expect(unitList[0]?.kind).toBe("ems");
    expect(unitList[0]?.eta_s).toBe(240);
    expect(unitList[0]?.distance_m).toBe(1200);

    const route = events.find((e) => e.type === "route.proposed");
    expect(route?.payload.unit_id).toBe("M-20");
    expect(route?.payload.route_id).toBe("route-M-20");
    expect((route?.payload.path as unknown[]).length).toBe(2);
  });

  it("does not repeat an unchanged route on every turn", () => {
    const incident = baseIncident({
      response_plan: {
        services: ["EMS"],
        units: [
          {
            unit_id: "M-20",
            type: "ALS ambulance",
            station: "Station 20",
            latitude: 37.7509,
            longitude: -122.4623,
            eta_minutes: 4,
            distance_km: 1.2,
          },
        ],
        route: { unit_id: "M-20", distance_km: 1.2, eta_minutes: 4, polyline: [[37.754, -122.452]] },
        reason: "closest",
        cad_id: null,
      },
    });
    const first = project("incident.updated", incident as never, fresh());
    const second = project("incident.updated", incident as never, first.state);
    expect(typesOf(second.events)).not.toContain("route.proposed");
    expect(typesOf(second.events)).not.toContain("responders.available");
  });

  it("treats an `other` category as unknown rather than inventing one", () => {
    const { events } = project(
      "incident.updated",
      baseIncident({ category: "other" }) as never,
      fresh(),
    );
    const classified = events.find((e) => e.type === "incident.classified");
    expect(classified?.payload.category).toBe("unknown");
  });
});

describe("tool projection", () => {
  it("pairs a completion with the invocation that opened it", () => {
    const a = project("tool.started", { tool: "geocode_address", arguments: {} }, fresh());
    const invoked = a.events[0];
    expect(invoked?.type).toBe("tool.invoked");
    expect(invoked?.payload.stage).toBe("verify");

    const b = project(
      "tool.completed",
      { tool: "geocode_address", result_summary: "37.754, -122.452" },
      a.state,
    );
    const result = b.events[0];
    expect(result?.type).toBe("tool.result");
    expect(result?.payload.tool_call_id).toBe(invoked?.payload.tool_call_id);
    expect(result?.payload.status).toBe("ok");
  });

  it("marks a failed tool as an error instead of a silent success", () => {
    const a = project("tool.started", { tool: "calculate_route", arguments: {} }, fresh());
    const b = project(
      "tool.completed",
      { tool: "calculate_route", result: null, result_summary: "failed: no unit available" },
      a.state,
    );
    expect(b.events[0]?.payload.status).toBe("error");
  });

  it("ignores a completion with no matching invocation", () => {
    const { events } = project("tool.completed", { tool: "geocode_address" }, fresh());
    expect(events).toHaveLength(0);
  });

  it("gives concurrent tools distinct call ids", () => {
    const a = project("tool.started", { tool: "geocode_address", arguments: {} }, fresh());
    const b = project("tool.started", { tool: "find_available_units", arguments: {} }, a.state);
    expect(a.events[0]?.payload.tool_call_id).not.toBe(b.events[0]?.payload.tool_call_id);
  });
});

describe("protocol.changed projection", () => {
  it("closes the old step and opens the new one", () => {
    const seed = project("incident.updated", baseIncident() as never, fresh());
    const { events } = project(
      "protocol.changed",
      {
        protocol_id: "MED_CARDIAC_01",
        from: "breathing_check",
        to: "human_dispatch_approval",
        reason: "Caller reports patient is not breathing",
        escalation: true,
      },
      seed.state,
    );
    const steps = events.filter((e) => e.type === "protocol.step");
    const byId = Object.fromEntries(steps.map((e) => [e.payload.step_id, e.payload.status]));
    expect(byId.breathing_check).toBe("done");
    expect(byId.human_dispatch_approval).toBe("active");
  });

  it("never un-ticks a completed step when the protocol doubles back", () => {
    const seed = project("incident.updated", baseIncident() as never, fresh());
    const back = project(
      "protocol.changed",
      {
        protocol_id: "MED_CARDIAC_01",
        from: "breathing_check",
        to: "verify_location",
        reason: "address contradicted",
        escalation: false,
      },
      seed.state,
    );
    const revisit = back.events.find(
      (e) => e.type === "protocol.step" && e.payload.step_id === "verify_location",
    );
    expect(revisit).toBeUndefined();
    expect(back.state.steps.verify_location).toBe("done");
  });
});

describe("voice event projection", () => {
  it("turns an agent line into an aura transcript line", () => {
    const { events } = project("agent.speaking", { text: "Stay on the line.", active: true }, fresh());
    expect(events[0]?.type).toBe("transcript.final");
    expect(events[0]?.payload.speaker).toBe("aura");
  });

  it("emits nothing when the agent stops speaking", () => {
    const { events } = project("agent.speaking", { text: "Stay on the line.", active: false }, fresh());
    expect(events).toHaveLength(0);
  });

  it("maps a barge-in onto the deck's interrupt signal", () => {
    const { events } = project(
      "agent.interrupted",
      { interrupted_text: "Is he...", reason: "barge_in" },
      fresh(),
    );
    expect(events[0]?.type).toBe("audio.interrupted");
    expect(events[0]?.payload.reason).toBe("barge_in");
  });

  it("opens a call card when the voice layer starts a call", () => {
    const { events } = project("call.started", { caller_label: "caller", language: "en" }, fresh());
    expect(events[0]?.type).toBe("call.incoming");
    expect(events[0]?.payload.call_id).toBe("call-call_001");
  });

  it("passes unknown canonical types through without deriving anything", () => {
    const { events } = project("system.degraded", { failed_dependency: "gradium" }, fresh());
    expect(events).toHaveLength(0);
  });
});

describe("projection purity", () => {
  it("does not mutate the state it was given", () => {
    const before = fresh();
    const snapshot = JSON.stringify(before);
    project("incident.updated", baseIncident() as never, before);
    expect(JSON.stringify(before)).toBe(snapshot);
  });

  it("is deterministic for the same input sequence", () => {
    const run = () => {
      let state = fresh();
      const out: string[] = [];
      for (const incident of [baseIncident(), baseIncident({ priority: "critical" })]) {
        const result = project("incident.updated", incident as never, state);
        state = result.state;
        out.push(...typesOf(result.events));
      }
      return out;
    };
    expect(run()).toEqual(run());
  });
});
