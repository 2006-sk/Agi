/**
 * Deterministic demo data for the built-in mock event stream.
 *
 * Mirrors what the backend team publishes in `packages/demo-scenarios`: the
 * scripted call, the greeting and post-approval lines (configuration, never
 * model output), background incidents, the responder roster and the city frame.
 */
import type { IncidentState, Service } from "../contracts/index.ts";

export interface ScenarioCaller {
  label: string;
  language: string;
  channel: string;
}

export interface ScenarioTurn {
  utterance: string;
  /** Silence after AURA finishes before the caller starts, ms at pace 1. */
  pause_before_ms: number;
  /** Cadence of simulated STT partials. */
  ms_per_word: number;
  /** The caller interrupts AURA's current line. */
  barge_in?: boolean;
  /** Fraction of AURA's estimated speaking time at which the barge-in happens. */
  barge_in_at?: number;
  note: string;
}

export interface ScenarioLines {
  dispatch_confirmed: string;
  specialist_cpr: string;
  dispatch_rejected: string;
  system_error: string;
}

export interface Scenario {
  id: string;
  title: string;
  description: string;
  caller: ScenarioCaller;
  greeting: string;
  turns: ScenarioTurn[];
  lines: ScenarioLines;
}

export const MEDICAL_CARDIAC_SCENARIO: Scenario = {
  id: "medical_cardiac",
  title: "Chest pain to cardiac arrest",
  description:
    "Adult male with chest pain at 170 St Germain Ave. The caller interrupts with 'he stopped breathing'; AURA escalates to critical, prepares EMS and opens the human-approval gate.",
  caller: { label: "Caller 4471", language: "en-US", channel: "overflow-line-2" },
  greeting: "Emergency intake, this is AURA. I'm here to help. Tell me what's happening.",
  turns: [
    { utterance: "Hi, um, my dad is having really bad chest pain", pause_before_ms: 900, ms_per_word: 260, note: "Classified medical / high. AURA asks for the address." },
    { utterance: "We're at 170 St. Germain Avenue", pause_before_ms: 800, ms_per_word: 280, note: "Address captured, normalized and geocoded in the same turn. Camera flies to the beacon." },
    { utterance: "He's awake but sweating and can't catch his breath", pause_before_ms: 700, ms_per_word: 250, note: "Conscious = yes, breathing = labored. Protocol moves to breathing_check." },
    {
      utterance: "Wait, he stopped breathing",
      pause_before_ms: 0,
      ms_per_word: 230,
      barge_in: true,
      barge_in_at: 0.45,
      note: "Barge-in. Priority -> critical, protocol jumps to human_dispatch_approval, EMS route prepared, approval gate opens.",
    },
  ],
  lines: {
    dispatch_confirmed: "Paramedics are on the way. Unit {{unit_id}} is about {{eta_minutes}} minutes from {{location_normalized}}. Stay on the line with me.",
    specialist_cpr:
      "I'm going to help you do CPR until they arrive. Kneel beside him, put the heel of your hand on the center of his chest, and push hard and fast, about twice a second. I'll count with you.",
    dispatch_rejected: "A dispatcher is reviewing the request right now. Stay on the line with me.",
    system_error: "I'm having trouble processing that. Stay on the line, a dispatcher is joining now.",
  },
};

export const SCENARIOS: Record<string, Scenario> = { [MEDICAL_CARDIAC_SCENARIO.id]: MEDICAL_CARDIAC_SCENARIO };
export const DEFAULT_SCENARIO_ID = MEDICAL_CARDIAC_SCENARIO.id;

export function fillTemplate(text: string, vars: Record<string, string | number | null | undefined>): string {
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
    const value = vars[key];
    return value === null || value === undefined ? "" : String(value);
  });
}

// ---------------------------------------------------------------------------
// Ambient incidents (locations from the intelligence service's known-address table)
// ---------------------------------------------------------------------------

export interface AmbientIncident {
  session_id: string;
  caller: ScenarioCaller;
  state: Partial<IncidentState>;
}

export const AMBIENT_INCIDENTS: AmbientIncident[] = [
  {
    session_id: "call_ambient_fire_01",
    caller: { label: "Caller 2210", language: "en-US", channel: "overflow-line-1" },
    state: {
      category: "fire",
      priority: "high",
      status: "active",
      location: { raw: "935 Folsom Street", normalized: "935 Folsom St, San Francisco, CA 94107", latitude: 37.7796, longitude: -122.4059, confidence: 0.96, verified: true },
      people_at_risk: 6,
      facts: ["smoke from third floor", "residents evacuating"],
      hazards: ["smoke"],
      missing_fields: ["recommended_services"],
      protocol: { id: "GENERAL_INTAKE_01", step: "prepare_response", asked: [], last_prompt: null },
      recommended_services: ["FIRE"],
      confidence: 0.88,
      assessment: { chief_complaint: "structure fire", conscious: "unknown", breathing: "unknown", hazards_checked: true },
      summary: "Smoke reported from the third floor of a residential building; residents evacuating.",
    },
  },
  {
    session_id: "call_ambient_police_01",
    caller: { label: "Caller 3187", language: "en-US", channel: "overflow-line-3" },
    state: {
      category: "police",
      priority: "medium",
      status: "active",
      location: { raw: "555 Market Street", normalized: "555 Market St, San Francisco, CA 94105", latitude: 37.7898, longitude: -122.3998, confidence: 0.96, verified: true },
      people_at_risk: 1,
      facts: ["suspect fled on foot", "no weapon seen"],
      protocol: { id: "GENERAL_INTAKE_01", step: "identify_problem", asked: [], last_prompt: null },
      recommended_services: ["POLICE"],
      confidence: 0.81,
      assessment: { chief_complaint: "theft in progress", conscious: "unknown", breathing: "unknown", hazards_checked: false },
      summary: "Retail theft; suspect fled eastbound on foot.",
    },
  },
  {
    session_id: "call_ambient_medical_01",
    caller: { label: "Caller 0952", language: "es-US", channel: "overflow-line-4" },
    state: {
      category: "medical",
      priority: "medium",
      status: "active",
      location: { raw: "2425 Geary Boulevard", normalized: "2425 Geary Blvd, San Francisco, CA 94115", latitude: 37.7826, longitude: -122.4437, confidence: 0.96, verified: true },
      people_at_risk: 1,
      facts: ["fall", "hip pain", "elderly"],
      missing_fields: ["hazards"],
      protocol: { id: "MED_CARDIAC_01", step: "collect_hazards", asked: ["conscious_check", "breathing_check"], last_prompt: null },
      recommended_services: ["EMS"],
      confidence: 0.9,
      assessment: { chief_complaint: "fall with hip pain", conscious: "yes", breathing: "normal", hazards_checked: false },
      summary: "Elderly patient fell at home, conscious and breathing, hip pain.",
    },
  },
  {
    session_id: "call_ambient_other_01",
    caller: { label: "Caller 7730", language: "en-US", channel: "overflow-line-5" },
    state: {
      category: "other",
      priority: "low",
      status: "active",
      location: { raw: "1001 Potrero Avenue", normalized: "1001 Potrero Ave, San Francisco, CA 94110", latitude: 37.7561, longitude: -122.4048, confidence: 0.96, verified: true },
      people_at_risk: 0,
      facts: ["downed power line", "no injuries"],
      hazards: ["electrical"],
      missing_fields: ["recommended_services"],
      protocol: { id: "GENERAL_INTAKE_01", step: "prepare_response", asked: [], last_prompt: null },
      recommended_services: [],
      confidence: 0.77,
      assessment: { chief_complaint: "downed power line", conscious: "unknown", breathing: "unknown", hazards_checked: true },
      summary: "Downed power line across the sidewalk, no injuries reported.",
    },
  },
];

// ---------------------------------------------------------------------------
// Responder roster (mirrors the intelligence service's simulated units)
// ---------------------------------------------------------------------------

export interface Station {
  unit_id: string;
  service: Service;
  type: string;
  station: string;
  latitude: number;
  longitude: number;
  status: "available" | "en_route" | "busy";
}

export const STATIONS: Station[] = [
  { unit_id: "M-20", service: "EMS", type: "ALS ambulance", station: "Station 20 - Olympia Way", latitude: 37.7509, longitude: -122.4623, status: "available" },
  { unit_id: "M-24", service: "EMS", type: "ALS ambulance", station: "Station 24 - Hoffman Ave", latitude: 37.7513, longitude: -122.4405, status: "available" },
  { unit_id: "M-12", service: "EMS", type: "ALS ambulance", station: "Station 12 - Stanyan St", latitude: 37.7643, longitude: -122.4531, status: "busy" },
  { unit_id: "M-07", service: "EMS", type: "ALS ambulance", station: "Station 7 - Folsom St", latitude: 37.76, longitude: -122.4147, status: "available" },
  { unit_id: "M-01", service: "EMS", type: "ALS ambulance", station: "Station 1 - Folsom St", latitude: 37.7796, longitude: -122.4059, status: "available" },
  { unit_id: "E-24", service: "FIRE", type: "Engine", station: "Station 24 - Hoffman Ave", latitude: 37.7513, longitude: -122.4405, status: "available" },
  { unit_id: "E-12", service: "FIRE", type: "Engine", station: "Station 12 - Stanyan St", latitude: 37.7643, longitude: -122.4531, status: "available" },
  { unit_id: "T-07", service: "FIRE", type: "Truck", station: "Station 7 - Folsom St", latitude: 37.76, longitude: -122.4147, status: "available" },
  { unit_id: "3A21", service: "POLICE", type: "Patrol", station: "Park Station - Waller St", latitude: 37.7677, longitude: -122.4551, status: "available" },
  { unit_id: "3B12", service: "POLICE", type: "Patrol", station: "Ingleside Station", latitude: 37.7247, longitude: -122.446, status: "available" },
];

/** Geographic frame of the simulated city; everything in the demo data falls inside it. */
export const DEMO_CITY = {
  name: "San Francisco (simulated)",
  center: { latitude: 37.758, longitude: -122.432 },
  half_extent: { latitude: 0.045, longitude: 0.055 },
  downtown: { latitude: 37.789, longitude: -122.402 },
} as const;
