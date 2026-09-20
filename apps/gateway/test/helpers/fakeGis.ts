/**
 * A stand-in for the intelligence service's simulated GIS and CAD tools.
 *
 * Vapi mode never calls `/internal/analyze` — the agent is the brain — so what
 * matters here is only the tool surface: address normalisation, geocoding, unit
 * lookup, routing, and the 403 that guards the CAD record. Behaviour and
 * argument validation mirror `services/intelligence/src/tools`, including the
 * detail the whole gate rests on: a place that cannot be geocoded comes back
 * with null coordinates rather than a guess.
 */

import { IntelligenceError } from "../../src/clients/intelligence.js";
import type {
  AnalyzeRequest,
  AnalyzeResponse,
  IntelligenceClient,
  ToolExecuteRequest,
  ToolExecuteResponse,
} from "../../src/clients/intelligence.js";
import type { IncidentState } from "@echo/contracts";

/** The demo address, plus a couple of neighbours, as in the real geocode table. */
const GEOCODE: Record<string, { lat: number; lng: number }> = {
  "170 st germain ave": { lat: 37.754, lng: -122.452 },
  "150 st germain ave": { lat: 37.7538, lng: -122.4512 },
  "100 hoffman ave": { lat: 37.7513, lng: -122.4405 },
  "1800 market st": { lat: 37.7719, lng: -122.4247 },
};

const UNITS = [
  { unit_id: "M-20", service: "EMS", type: "ALS ambulance", station: "Station 20 - Olympia Way", latitude: 37.7509, longitude: -122.4623, eta_minutes: 4, distance_km: 1.26 },
  { unit_id: "M-24", service: "EMS", type: "ALS ambulance", station: "Station 24 - Hoffman Ave", latitude: 37.7513, longitude: -122.4405, eta_minutes: 7, distance_km: 2.1 },
  { unit_id: "E-24", service: "FIRE", type: "Engine", station: "Station 24 - Hoffman Ave", latitude: 37.7513, longitude: -122.4405, eta_minutes: 6, distance_km: 2.1 },
  { unit_id: "3A21", service: "POLICE", type: "Patrol", station: "Park Station", latitude: 37.7677, longitude: -122.4551, eta_minutes: 8, distance_km: 2.6 },
];

/** Street-suffixed addresses normalise; "near the park" does not. */
function normalize(raw: string): { normalized: string; key: string; confidence: number } | null {
  const cleaned = raw.trim().toLowerCase().replace(/\./g, "");
  const match = cleaned.match(
    /(\d+)\s+([a-z0-9'\- ]+?)\s+(ave|avenue|st|street|blvd|boulevard|rd|road|way|drive|dr)\b/,
  );
  if (!match) return null;
  const suffix: Record<string, string> = {
    avenue: "Ave", ave: "Ave", street: "St", st: "St", boulevard: "Blvd", blvd: "Blvd",
    road: "Rd", rd: "Rd", way: "Way", drive: "Dr", dr: "Dr",
  };
  const street = match[2]!
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
  const key = `${match[1]} ${street} ${suffix[match[3]!]}`.toLowerCase();
  return {
    normalized: `${match[1]} ${street} ${suffix[match[3]!]}, San Francisco, CA 94114`,
    key,
    confidence: 0.96,
  };
}

export class FakeGis implements IntelligenceClient {
  readonly toolCalls: ToolExecuteRequest[] = [];

  async analyze(_body: AnalyzeRequest): Promise<AnalyzeResponse> {
    throw new IntelligenceError("analyze is not used in vapi mode", 501);
  }

  async executeTool(body: ToolExecuteRequest): Promise<ToolExecuteResponse> {
    this.toolCalls.push(structuredClone(body));
    const name = body.tool.name;
    const args = body.tool.arguments ?? {};
    const state = { ...(body.current_state as unknown as IncidentState) };

    // The hard gate, exactly as the real service enforces it.
    if ((name === "create_cad_draft" || name === "request_specialist") && !body.approved) {
      throw new IntelligenceError("intelligence /internal/tools/execute -> 403", 403, {
        error: "human_approval_required",
      });
    }

    let result: unknown = null;
    let summary = "";

    if (name === "normalize_address") {
      const raw = String(args.raw_address ?? "");
      if (!raw) throw new IntelligenceError("invalid_arguments", 400, { error: "invalid_arguments" });
      const norm = normalize(raw);
      result = norm
        ? { normalized: norm.normalized, key: norm.key, confidence: norm.confidence }
        : { normalized: null, key: null, confidence: 0 };
      summary = norm ? `Normalized to ${norm.normalized}` : `Could not normalize "${raw}"`;
    } else if (name === "geocode_address") {
      const normalized = args.normalized_address;
      if (typeof normalized !== "string" || !normalized) {
        throw new IntelligenceError("intelligence /internal/tools/execute -> 400", 400, {
          error: "invalid_arguments",
          message: "normalized_address: expected string, received undefined",
        });
      }
      const key = normalized.split(",")[0]!.trim().toLowerCase();
      const hit = GEOCODE[key];
      result = hit
        ? { latitude: hit.lat, longitude: hit.lng, confidence: 0.96 }
        : { latitude: null, longitude: null, confidence: 0.2 };
      summary = hit ? `${hit.lat}, ${hit.lng}` : "no coordinates";
    } else if (name === "find_available_units") {
      const service = String(args.service ?? "EMS");
      if (!args.location) {
        throw new IntelligenceError("intelligence /internal/tools/execute -> 400", 400, {
          error: "invalid_arguments",
          message: "location is required",
        });
      }
      const units = UNITS.filter((u) => u.service === service).slice(0, Number(args.limit) || 3);
      result = { units };
      summary = units.length ? `${units[0]!.unit_id} available` : `no ${service} units`;
    } else if (name === "calculate_route") {
      const unit = args.unit as { unit_id?: string; latitude?: number; longitude?: number } | undefined;
      const incident = args.incident_location as { latitude?: number; longitude?: number } | undefined;
      if (!unit?.unit_id || typeof incident?.latitude !== "number") {
        throw new IntelligenceError("intelligence /internal/tools/execute -> 400", 400, {
          error: "invalid_arguments",
          message: "unit and incident_location are required",
        });
      }
      const known = UNITS.find((u) => u.unit_id === unit.unit_id);
      result = {
        unit_id: unit.unit_id,
        distance_km: known?.distance_km ?? 1.5,
        eta_minutes: known?.eta_minutes ?? 5,
        polyline: [
          [unit.latitude, unit.longitude],
          [37.7521, -122.4585],
          [37.753, -122.4552],
          [37.7535, -122.4535],
          [incident.latitude, incident.longitude],
        ],
      };
      summary = `${known?.distance_km ?? 1.5} km`;
    } else if (name === "create_cad_draft") {
      result = { cad_id: "CAD-TEST-0001", units_assigned: ["M-20"], incident_type: "MEDICAL" };
      summary = "CAD-TEST-0001 created";
      state.status = "dispatched";
      state.human_required = false;
      if (state.response_plan) state.response_plan = { ...state.response_plan, cad_id: "CAD-TEST-0001" };
    } else {
      throw new IntelligenceError("unknown_tool", 400, { error: "unknown_tool", tool: name });
    }

    return {
      session_id: body.session_id,
      execution: { name, arguments: args, result, result_summary: summary, duration_ms: 1 },
      state_patch: {},
      state,
      events: [],
    };
  }

  async health(): Promise<{ ok: boolean; detail: unknown }> {
    return { ok: true, detail: { mode: "fake-gis" } };
  }
}
