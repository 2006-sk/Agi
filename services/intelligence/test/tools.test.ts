import { describe, expect, it } from "vitest";
import { createInitialState } from "../src/schemas/incident.js";
import { calculateRoute, geocodeAddress, normalizeAddress } from "../src/tools/gis.js";
import { executeTool, isConsequential, safeArguments, TOOLS, ToolError } from "../src/tools/index.js";
import { findAvailableUnits } from "../src/tools/units.js";

const DEMO = { latitude: 37.754, longitude: -122.452 };

describe("normalize_address / geocode_address", () => {
  it("normalizes the demo address to the master-plan form", () => {
    const n = normalizeAddress({ raw_address: "We're at 170 St. Germain Avenue" });
    expect(n.normalized).toBe("170 St Germain Ave, San Francisco, CA 94114");
    expect(n.components).toMatchObject({ number: "170", street: "St Germain Ave", city: "San Francisco" });
    expect(n.confidence).toBeGreaterThan(0.9);
    const g = geocodeAddress({ normalized_address: n.normalized });
    expect(g).toMatchObject({ latitude: 37.754, longitude: -122.452, verified: true, source: "sample_table" });
  });

  it("is idempotent and handles apartment numbers", () => {
    const once = normalizeAddress({ raw_address: "1800 Market Street apt 4B" });
    const twice = normalizeAddress({ raw_address: once.normalized });
    expect(twice.normalized).toBe(once.normalized);
    expect(once.components.unit).toBe("4B");
    expect(geocodeAddress({ normalized_address: once.normalized }).source).toBe("sample_table");
  });

  it("geocodes unknown but well-formed addresses deterministically", () => {
    const a = geocodeAddress({ normalized_address: "2200 Valencia St, San Francisco, CA" });
    const b = geocodeAddress({ normalized_address: "2200 Valencia Street" });
    expect(a).toEqual(b);
    expect(a.verified).toBe(true);
    expect(a.source).toBe("deterministic_estimate");
    expect(a.latitude).toBeGreaterThan(37.7);
    expect(a.longitude).toBeLessThan(-122.3);
  });

  it("leaves vague places unverified", () => {
    const g = geocodeAddress({ normalized_address: "near the big park" });
    expect(g.verified).toBe(false);
    expect(g.latitude).toBeNull();
  });
});

describe("find_available_units / calculate_route", () => {
  it("returns the closest available EMS units sorted by ETA", () => {
    const r = findAvailableUnits({ service: "EMS", location: DEMO, limit: 3 });
    expect(r.units.map((u) => u.unit_id)).toEqual(["M-20", "M-24", "M-07"]);
    expect(r.units.every((u) => u.status === "available")).toBe(true);
    expect(r.units[0]!.eta_minutes).toBeLessThanOrEqual(r.units[1]!.eta_minutes);
    expect(r.units.map((u) => u.unit_id)).not.toContain("M-12"); // busy
  });

  it("filters by service", () => {
    expect(findAvailableUnits({ service: "FIRE", location: DEMO, limit: 5 }).units.every((u) => u.service === "FIRE")).toBe(true);
    expect(findAvailableUnits({ service: "POLICE", location: DEMO, limit: 1 }).units).toHaveLength(1);
  });

  it("draws a street-like polyline from the unit to the incident", () => {
    const unit = findAvailableUnits({ service: "EMS", location: DEMO, limit: 1 }).units[0]!;
    const route = calculateRoute({ unit, incident_location: DEMO });
    expect(route.polyline[0]).toEqual([unit.latitude, unit.longitude]);
    expect(route.polyline.at(-1)).toEqual([DEMO.latitude, DEMO.longitude]);
    expect(route.polyline).toHaveLength(5);
    expect(route.eta_minutes).toBeGreaterThanOrEqual(2);
    expect(route.distance_km).toBeGreaterThan(0);
  });
});

describe("tool registry", () => {
  it("classifies consequential vs informational tools", () => {
    expect(isConsequential("create_cad_draft")).toBe(true);
    expect(isConsequential("request_specialist")).toBe(true);
    expect(isConsequential("find_available_units")).toBe(false);
    expect(Object.keys(TOOLS)).toHaveLength(6);
  });

  it("validates arguments and reports schema errors", () => {
    expect(() => executeTool("find_available_units", { service: "EMS" }, { state: createInitialState("s"), now: () => new Date() })).toThrow(
      ToolError,
    );
    expect(() => executeTool("normalize_address", { raw_address: "" }, { state: createInitialState("s"), now: () => new Date() })).toThrow(
      /invalid arguments/,
    );
  });

  it("creates a CAD draft from the session state with a stable id", () => {
    const state = createInitialState("call_001");
    state.category = "medical";
    state.priority = "critical";
    state.assessment.breathing = "no";
    state.location.normalized = "170 St Germain Ave, San Francisco, CA 94114";
    state.recommended_services = ["EMS"];
    const now = () => new Date("2026-09-19T18:02:11.120Z");
    const a = executeTool("create_cad_draft", {}, { state, now });
    const b = executeTool("create_cad_draft", {}, { state, now });
    expect(a.result).toEqual(b.result);
    expect(a.result).toMatchObject({
      status: "draft",
      incident_type: "MEDICAL - CARDIAC/RESPIRATORY ARREST",
      priority_code: "P1",
      address: "170 St Germain Ave, San Francisco, CA 94114",
    });
    expect((a.result as { cad_id: string }).cad_id).toMatch(/^CAD-2026-\d{6}$/);
    expect(a.result_summary).toMatch(/CAD draft/);
    expect(safeArguments("create_cad_draft", { incident_state: state })).toEqual({
      session_id: "call_001",
      category: "medical",
      priority: "critical",
      address: "170 St Germain Ave, San Francisco, CA 94114",
      services: ["EMS"],
    });
  });

  it("queues a specialist request", () => {
    const state = createInitialState("call_001");
    const exec = executeTool(
      "request_specialist",
      { type: "cpr_instructions", reason: "patient not breathing" },
      { state, now: () => new Date("2026-09-19T18:02:11.120Z") },
    );
    expect(exec.result).toMatchObject({ type: "cpr_instructions", status: "queued" });
    expect((exec.result as { request_id: string }).request_id).toMatch(/^SPC-\d{5}$/);
  });
});
