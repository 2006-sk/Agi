/**
 * Deterministic stand-in for the intelligence service (SambaNova + protocol
 * engine), used by the in-browser mock event stream. It follows the same rules
 * as the backend: the "model" only observes facts, the protocol decides steps,
 * prompts come from templates, life-threat phrases always escalate, and
 * consequential tools only run with explicit approval.
 */
import {
  IncidentState,
  PRIORITY_RANK,
  PROTOCOL_STEPS,
  type BreathingState,
  type Category,
  type DispatchProposedPayload,
  type EventType,
  type Priority,
  type ProposedTool,
  type ResponderUnit,
  type Route,
  type Service,
  type TriState,
} from "../contracts/index.ts";
import { STATIONS } from "./scenario.ts";

// ---------------------------------------------------------------------------
// Simulated GIS / units / CAD (mirrors services/intelligence/src/tools)
// ---------------------------------------------------------------------------

const SF_CENTER = { latitude: 37.7749, longitude: -122.4194 };

const SUFFIXES: Record<string, string> = {
  street: "St", st: "St", avenue: "Ave", ave: "Ave", boulevard: "Blvd", blvd: "Blvd", road: "Rd", rd: "Rd", drive: "Dr", dr: "Dr",
  lane: "Ln", ln: "Ln", way: "Way", court: "Ct", ct: "Ct", place: "Pl", pl: "Pl", terrace: "Ter", ter: "Ter", highway: "Hwy", hwy: "Hwy",
  parkway: "Pkwy", pkwy: "Pkwy", circle: "Cir", cir: "Cir",
};

const KNOWN_ADDRESSES = [
  { key: "170 st germain ave", normalized: "170 St Germain Ave, San Francisco, CA 94114", latitude: 37.754, longitude: -122.452 },
  { key: "150 st germain ave", normalized: "150 St Germain Ave, San Francisco, CA 94114", latitude: 37.7538, longitude: -122.4512 },
  { key: "100 hoffman ave", normalized: "100 Hoffman Ave, San Francisco, CA 94114", latitude: 37.7513, longitude: -122.4405 },
  { key: "1145 stanyan st", normalized: "1145 Stanyan St, San Francisco, CA 94117", latitude: 37.7643, longitude: -122.4531 },
  { key: "285 olympia way", normalized: "285 Olympia Way, San Francisco, CA 94131", latitude: 37.7509, longitude: -122.4623 },
  { key: "1001 potrero ave", normalized: "1001 Potrero Ave, San Francisco, CA 94110", latitude: 37.7561, longitude: -122.4048 },
  { key: "2425 geary blvd", normalized: "2425 Geary Blvd, San Francisco, CA 94115", latitude: 37.7826, longitude: -122.4437 },
  { key: "3555 cesar chavez st", normalized: "3555 Cesar Chavez St, San Francisco, CA 94110", latitude: 37.7483, longitude: -122.4183 },
  { key: "1800 market st", normalized: "1800 Market St, San Francisco, CA 94102", latitude: 37.7719, longitude: -122.4247 },
  { key: "555 market st", normalized: "555 Market St, San Francisco, CA 94105", latitude: 37.7898, longitude: -122.3998 },
  { key: "100 larkin st", normalized: "100 Larkin St, San Francisco, CA 94102", latitude: 37.7793, longitude: -122.4159 },
  { key: "935 folsom st", normalized: "935 Folsom St, San Francisco, CA 94107", latitude: 37.7796, longitude: -122.4059 },
];

export function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

const titleCase = (word: string) => (word ? word[0]!.toUpperCase() + word.slice(1).toLowerCase() : word);

interface NormalizedAddress {
  normalized: string;
  key: string;
  number: string | null;
  street: string | null;
  unit: string | null;
  confidence: number;
}

export function normalizeAddress(rawAddress: string): NormalizedAddress {
  let text = rawAddress.replace(/\s+/g, " ").trim().replace(/[.,;]+$/, "");
  text = text.replace(/^(?:we'?re|we are|i'?m|i am|it'?s|it is|at|the address is|address is)\s+(?:at\s+)?/i, "");
  text = text.replace(/,?\s*(?:san francisco|sf)?(?:,\s*ca)?(?:\s*\d{5})?\s*$/i, "").trim().replace(/[.,]+$/, "");
  let unit: string | null = null;
  const unitMatch = text.match(/(?:,?\s*(?:apt\.?|apartment|unit|suite|#)\s*)([\w-]+)\s*$/i);
  if (unitMatch?.[1]) {
    unit = unitMatch[1].toUpperCase();
    text = text.slice(0, unitMatch.index).trim().replace(/[.,]+$/, "");
  }
  const tokens = text
    .replace(/\./g, "")
    .split(" ")
    .filter(Boolean)
    .map((token) => SUFFIXES[token.toLowerCase()] ?? titleCase(token));
  const number = tokens[0] && /^\d+[a-z]?$/i.test(tokens[0]) ? tokens[0] : null;
  const streetTokens = number ? tokens.slice(1) : tokens;
  const street = streetTokens.length ? streetTokens.join(" ") : null;
  const key = [number, street].filter(Boolean).join(" ").toLowerCase();
  const known = KNOWN_ADDRESSES.find((entry) => entry.key === key);
  const hasSuffix = streetTokens.some((t) => Object.values(SUFFIXES).includes(t));
  let normalized: string;
  let confidence: number;
  if (known) {
    normalized = known.normalized;
    confidence = 0.96;
  } else {
    const line = [number, street].filter(Boolean).join(" ");
    normalized = line ? `${line}, San Francisco, CA` : rawAddress.trim();
    confidence = number && hasSuffix ? 0.82 : number ? 0.6 : 0.35;
  }
  if (unit) normalized = normalized.replace(/(, San Francisco)/, ` Apt ${unit}$1`);
  return { normalized, key, number, street, unit, confidence };
}

interface GeocodeResult {
  latitude: number | null;
  longitude: number | null;
  confidence: number;
  verified: boolean;
  source: "sample_table" | "deterministic_estimate" | "unresolved";
}

export function geocode(address: NormalizedAddress): GeocodeResult {
  const known = KNOWN_ADDRESSES.find((entry) => entry.key === address.key);
  if (known) return { latitude: known.latitude, longitude: known.longitude, confidence: 0.96, verified: true, source: "sample_table" };
  if (address.number && address.street) {
    const hash = fnv1a(address.key);
    const latOffset = ((hash & 0xffff) / 0xffff - 0.5) * 0.06;
    const lngOffset = (((hash >>> 16) & 0xffff) / 0xffff - 0.5) * 0.08;
    return {
      latitude: Number((SF_CENTER.latitude + latOffset).toFixed(5)),
      longitude: Number((SF_CENTER.longitude + lngOffset).toFixed(5)),
      confidence: 0.72,
      verified: true,
      source: "deterministic_estimate",
    };
  }
  return { latitude: null, longitude: null, confidence: 0.2, verified: false, source: "unresolved" };
}

interface LatLng {
  latitude: number;
  longitude: number;
}

function haversineKm(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

const estimateRoadKm = (a: LatLng, b: LatLng) => Number((haversineKm(a, b) * 1.3).toFixed(2));
const estimateEtaMinutes = (roadKm: number) => Math.max(2, Math.round(roadKm / 0.6 + 1.5));

export function findAvailableUnits(service: Service, location: LatLng, limit = 3): ResponderUnit[] {
  return STATIONS.filter((u) => u.service === service && u.status === "available")
    .map((u) => {
      const distance_km = estimateRoadKm(u, location);
      return { ...u, distance_km, eta_minutes: estimateEtaMinutes(distance_km) };
    })
    .sort((a, b) => a.eta_minutes - b.eta_minutes || a.distance_km - b.distance_km || a.unit_id.localeCompare(b.unit_id))
    .slice(0, limit);
}

export function calculateRoute(unit: ResponderUnit, incident: LatLng): Route {
  const dLat = incident.latitude - unit.latitude;
  const dLng = incident.longitude - unit.longitude;
  const round = (n: number) => Number(n.toFixed(5));
  const polyline: [number, number][] = [
    [round(unit.latitude), round(unit.longitude)],
    [round(unit.latitude + dLat * 0.35), round(unit.longitude)],
    [round(unit.latitude + dLat * 0.35), round(unit.longitude + dLng * 0.6)],
    [round(incident.latitude), round(unit.longitude + dLng * 0.6)],
    [round(incident.latitude), round(incident.longitude)],
  ];
  const distance_km = estimateRoadKm(unit, incident);
  return { unit_id: unit.unit_id, distance_km, eta_minutes: estimateEtaMinutes(distance_km), polyline };
}

export function cadId(sessionId: string): string {
  return `CAD-2026-${String(fnv1a(`cad:${sessionId}`) % 1_000_000).padStart(6, "0")}`;
}

export function specialistId(sessionId: string, type: string): string {
  return `SPC-${String(fnv1a(`spc:${sessionId}:${type}`) % 100_000).padStart(5, "0")}`;
}

// ---------------------------------------------------------------------------
// Observation (what a model would extract) - regex triggers, deterministic
// ---------------------------------------------------------------------------

interface Observation {
  category: Category | null;
  priority: Priority | null;
  chief_complaint: string | null;
  facts: string[];
  unverified: string[];
  hazards: string[];
  conscious: TriState | null;
  breathing: BreathingState | null;
  location_raw: string | null;
  people_at_risk: number | null;
  hazards_answered: boolean;
  triggers: string[];
}

const ADDRESS_RE =
  /(\d{1,5})\s+((?:[A-Za-z.']+\s+){1,4}?)(street|st\.?|avenue|ave\.?|boulevard|blvd\.?|road|rd\.?|drive|dr\.?|lane|ln\.?|way|court|ct\.?|place|pl\.?|terrace|ter\.?|highway|hwy\.?|parkway|pkwy\.?)\b(?:,?\s*(?:apt\.?|apartment|unit|#)\s*([\w-]+))?/i;

const YES_RE = /^\s*(yes|yeah|yep|yup|he is|she is|they are|awake|normal|normally|he's awake|she's awake|breathing)\b/i;
const NO_RE = /^\s*(no|nope|not really|he's not|she's not|he isn'?t|she isn'?t|not|barely|nothing)\b/i;

function maxPriority(a: Priority, b: Priority): Priority {
  return PRIORITY_RANK[a] >= PRIORITY_RANK[b] ? a : b;
}

export function observe(text: string, state: IncidentState): Observation {
  const t = text.toLowerCase();
  const obs: Observation = {
    category: null,
    priority: null,
    chief_complaint: null,
    facts: [],
    unverified: [],
    hazards: [],
    conscious: null,
    breathing: null,
    location_raw: null,
    people_at_risk: null,
    hazards_answered: false,
    triggers: [],
  };
  const hit = (name: string) => obs.triggers.push(name);
  const step = state.protocol.step;
  const asked = state.protocol.asked;

  // life-threat phrases first: they always take effect
  if (/stopped breathing|not breathing|isn'?t breathing|no pulse|can'?t find a pulse|quit breathing/.test(t)) {
    obs.breathing = "no";
    obs.priority = "critical";
    obs.category ??= "medical";
    hit("not_breathing");
  }
  if (/unresponsive|not responding|passed out|won'?t wake up|unconscious|collapsed/.test(t)) {
    obs.conscious = "no";
    obs.priority = "critical";
    obs.category ??= "medical";
    hit("unresponsive");
  }
  if (!obs.breathing && /can'?t (?:catch|get)(?: his| her| their)? breath|short(?:ness)? of breath|trouble breathing|difficulty breathing|wheez|gasping|struggling to breathe/.test(t)) {
    obs.breathing = "labored";
    obs.priority = maxPriority(obs.priority ?? "unknown", "high");
    obs.category ??= "medical";
    hit("labored_breathing");
    if (/catch/.test(t)) obs.unverified.push("shortness of breath");
  }
  if (!obs.conscious && /\b(awake|responding|talking|alert|conscious)\b/.test(t) && !/not responding|unresponsive/.test(t)) {
    obs.conscious = "yes";
    hit("conscious");
  }
  if (/chest pain|chest (?:is )?(?:tight|hurt)|pressure in (?:his|her|my|the) chest|heart attack/.test(t)) {
    obs.category ??= "medical";
    obs.priority = maxPriority(obs.priority ?? "unknown", "high");
    obs.chief_complaint = "chest pain";
    obs.facts.push("chest pain");
    hit("chest_pain");
    if (/really bad|severe|terrible|crushing|worst/.test(t)) obs.unverified.push("severe pain");
  }
  if (/\b(bleeding|blood everywhere|stab wound|gunshot wound)\b/.test(t)) {
    obs.category ??= "medical";
    obs.priority = maxPriority(obs.priority ?? "unknown", "high");
    obs.chief_complaint ??= "bleeding";
    obs.facts.push("bleeding");
    hit("bleeding");
  }
  if (/\b(seizure|seizing|convuls)/.test(t)) {
    obs.category ??= "medical";
    obs.priority = maxPriority(obs.priority ?? "unknown", "high");
    obs.chief_complaint ??= "seizure";
    obs.facts.push("seizure");
    hit("seizure");
  }
  if (/\b(fell|fall|fallen|slipped)\b/.test(t) && !obs.chief_complaint) {
    obs.category ??= "medical";
    obs.priority = maxPriority(obs.priority ?? "unknown", "medium");
    obs.chief_complaint = "fall";
    obs.facts.push("fall");
    hit("fall");
  }
  if (/\b(fire|smoke|flames|burning|on fire)\b/.test(t) && !/fire(?:d|s)? (?:him|her|them)/.test(t)) {
    obs.category ??= "fire";
    obs.priority = maxPriority(obs.priority ?? "unknown", "high");
    obs.chief_complaint ??= "fire";
    obs.facts.push("fire reported");
    obs.hazards.push("fire");
    hit("fire");
  }
  if (/\b(gun|shots? fired|shooting|stabb|robbery|robbed|burglar|breaking in|weapon|assault|attacked|intruder)\b/.test(t)) {
    obs.category ??= "police";
    obs.priority = maxPriority(obs.priority ?? "unknown", "high");
    obs.chief_complaint ??= "violent incident";
    obs.facts.push("possible violence");
    obs.hazards.push("weapon");
    hit("police");
  }
  if (/\bsweat/.test(t)) {
    obs.facts.push("sweating");
    hit("sweating");
  }
  if (/\b(?:my )?(dad|father|husband|brother|grandpa|grandfather|uncle|boyfriend)\b/.test(t)) {
    obs.facts.push("adult male");
    obs.people_at_risk ??= 1;
    hit("relation_adult_male");
  } else if (/\b(?:my )?(mom|mother|wife|sister|grandma|grandmother|aunt|girlfriend)\b/.test(t)) {
    obs.facts.push("adult female");
    obs.people_at_risk ??= 1;
    hit("relation_adult_female");
  } else if (/\b(baby|infant|toddler|child|kid|son|daughter)\b/.test(t)) {
    obs.facts.push("child");
    obs.people_at_risk ??= 1;
    hit("relation_child");
  }
  const people = t.match(/(\d+)\s+(?:people|persons|residents|patients|victims)/);
  if (people) {
    obs.people_at_risk = Number(people[1]);
    hit("people_count");
  }

  const address = text.match(ADDRESS_RE);
  if (address) {
    obs.location_raw = address[0].trim();
    hit("address");
  }

  // short answers only mean something right after the matching question
  if (step === "conscious_check" && asked.includes("conscious_check") && !obs.conscious) {
    if (YES_RE.test(text)) {
      obs.conscious = "yes";
      hit("answer_yes");
    } else if (NO_RE.test(text)) {
      obs.conscious = "no";
      obs.priority = "critical";
      hit("answer_no");
    }
  }
  if (step === "breathing_check" && asked.includes("breathing_check") && !obs.breathing) {
    if (YES_RE.test(text)) {
      obs.breathing = "normal";
      hit("answer_yes");
    } else if (NO_RE.test(text)) {
      obs.breathing = "no";
      obs.priority = "critical";
      hit("answer_no");
    }
  }
  if (step === "collect_hazards" && asked.includes("collect_hazards")) {
    obs.hazards_answered = true;
    const hazard = t.match(/\b(traffic|weapons?|fumes|gas|dog|fire|smoke|electrical|downed (?:power )?line|flood|ice|crowd)\b/);
    if (hazard?.[1] && !NO_RE.test(text)) obs.hazards.push(hazard[1]);
    hit("hazards_answer");
  }
  return obs;
}

// ---------------------------------------------------------------------------
// Protocol engine
// ---------------------------------------------------------------------------

export interface EngineEvent {
  type: EventType;
  payload: Record<string, unknown>;
}

export interface ProtocolTransition {
  protocol_id: string;
  from: string | null;
  to: string;
  reason: string;
  escalation: boolean;
}

export interface AnalyzeResult {
  state: IncidentState;
  events: EngineEvent[];
  next_response: string;
  confidence: number;
  explanation: string;
  protocol_transition: ProtocolTransition | null;
  proposed_tools: ProposedTool[];
  triggers: string[];
  dispatch: DispatchProposedPayload | null;
}

const CONFIRM_STEPS = new Set(["conscious_check", "breathing_check", "collect_hazards"]);

function protocolFor(category: Category): string {
  return category === "medical" ? "MED_CARDIAC_01" : "GENERAL_INTAKE_01";
}

function serviceFor(category: Category): Service | null {
  if (category === "medical") return "EMS";
  if (category === "fire") return "FIRE";
  if (category === "police") return "POLICE";
  return null;
}

function isComplete(state: IncidentState, step: string): boolean {
  switch (step) {
    case "verify_location":
      return state.location.verified;
    case "identify_problem":
      return state.assessment.chief_complaint !== null;
    case "conscious_check":
      return state.assessment.conscious !== "unknown" && state.protocol.asked.includes("conscious_check");
    case "breathing_check":
      return state.assessment.breathing !== "unknown" && state.protocol.asked.includes("breathing_check");
    case "collect_hazards":
      return state.assessment.hazards_checked;
    case "prepare_response":
      return state.recommended_services.length > 0 && state.location.verified && state.response_plan !== null;
    default:
      return false;
  }
}

function missingFor(state: IncidentState, step: string | null): string[] {
  switch (step) {
    case "verify_location":
      return ["location"];
    case "identify_problem":
      return ["chief_complaint"];
    case "conscious_check":
      return ["consciousness"];
    case "breathing_check":
      return ["breathing"];
    case "collect_hazards":
      return ["hazards"];
    case "prepare_response":
      return state.recommended_services.length ? [] : ["recommended_services"];
    case "human_dispatch_approval": {
      const missing: string[] = [];
      if (!state.location.verified) missing.push("location");
      if (state.protocol.id === "MED_CARDIAC_01" && !state.assessment.hazards_checked) missing.push("hazards");
      return missing;
    }
    default:
      return [];
  }
}

function promptFor(state: IncidentState, notBreathing: boolean): string {
  const step = state.protocol.step;
  const loc = state.location;
  if (state.protocol.id === "GENERAL_INTAKE_01") {
    switch (step) {
      case "verify_location":
        return loc.raw && !loc.verified
          ? `I heard ${loc.raw}. Can you confirm that address?`
          : "I'm here to help. What is the exact address of the emergency?";
      case "identify_problem":
        return "Tell me exactly what is happening.";
      case "prepare_response":
        return "I'm preparing help now. Stay on the line with me.";
      default:
        return loc.verified ? "I'm alerting the emergency dispatcher now. Stay on the line." : "Help is being prepared, but I need the exact address. Where are you right now?";
    }
  }
  switch (step) {
    case "verify_location":
      if (!loc.raw) return "I'm here to help. What is the exact address of the emergency?";
      if (!loc.verified) return `I heard ${loc.raw}. Can you confirm that address, and is there an apartment or floor number?`;
      return `Thank you, I have ${loc.normalized}.`;
    case "identify_problem":
      return state.assessment.chief_complaint ? `Okay, ${state.assessment.chief_complaint}. I'm going to ask a few quick questions.` : "Tell me exactly what is happening.";
    case "conscious_check":
      return "Is the person awake and responding to you?";
    case "breathing_check":
      return state.assessment.conscious === "no" ? "Is the person breathing? Watch their chest and tell me what you see." : "Is the person breathing normally right now?";
    case "collect_hazards":
      return "Is there anything that could put you or the paramedics in danger, like traffic, weapons or fumes?";
    case "prepare_response":
      return "I'm preparing help now. Stay on the line with me.";
    case "human_dispatch_approval":
      if (!loc.verified) return "Help is being prepared, but I need the exact address. Where are you right now?";
      if (notBreathing) return "I understand. Stay on the line while I alert the emergency dispatcher.";
      if (state.response_plan?.route) {
        return `Paramedics are being prepared for ${loc.normalized}, about ${state.response_plan.route.eta_minutes} minutes away. Stay on the line with me.`;
      }
      return "I'm alerting the emergency dispatcher now. Stay on the line.";
    default:
      return "I'm here with you. Tell me what is happening.";
  }
}

const toolStarted = (tool: string, args: Record<string, unknown>): EngineEvent => ({ type: "tool.started", payload: { tool, arguments: args } });
const toolCompleted = (tool: string, result_summary: string, result: unknown, duration_ms: number): EngineEvent => ({
  type: "tool.completed",
  payload: { tool, result_summary, result, duration_ms },
});

function pushUnique(list: string[], value: string): void {
  if (!list.includes(value)) list.push(value);
}

/** One caller utterance in, an incident update plus the events the backend would emit out. */
export function analyzeUtterance(previous: IncidentState, utterance: string, now: Date = new Date()): AnalyzeResult {
  const state: IncidentState = IncidentState.parse(structuredClone(previous));
  const events: EngineEvent[] = [];
  const proposed: ProposedTool[] = [];
  const obs = observe(utterance, state);

  if (state.category === "unknown" && obs.category) state.category = obs.category;
  if (obs.priority) state.priority = maxPriority(state.priority, obs.priority);
  if (obs.chief_complaint && !state.assessment.chief_complaint) state.assessment.chief_complaint = obs.chief_complaint;
  if (obs.conscious) state.assessment.conscious = obs.conscious;
  if (obs.breathing) state.assessment.breathing = obs.breathing;
  if (obs.hazards_answered) state.assessment.hazards_checked = true;
  if (obs.people_at_risk !== null) state.people_at_risk = obs.people_at_risk;
  for (const fact of obs.facts) pushUnique(state.facts, fact);
  for (const fact of obs.unverified) if (!state.facts.includes(fact)) pushUnique(state.unverified_facts, fact);
  for (const hazard of obs.hazards) pushUnique(state.hazards, hazard);
  const service = serviceFor(state.category);
  if (service && state.assessment.chief_complaint && !state.recommended_services.includes(service)) state.recommended_services.push(service);

  // protocol selection follows the category; a late classification restarts at the first step
  const protocolId = protocolFor(state.category);
  const steps = PROTOCOL_STEPS[protocolId]!;
  if (state.protocol.id !== protocolId) {
    state.protocol.id = protocolId;
    state.protocol.step = null;
  }
  const from = state.protocol.step;
  let step = state.protocol.step ?? steps[0]!;
  const indexOf = (id: string) => steps.indexOf(id);

  // informational tools: address normalization + geocoding, whenever an unverified address is present
  if (obs.location_raw && !state.location.verified) {
    state.location.raw = obs.location_raw;
    const normalized = normalizeAddress(obs.location_raw);
    events.push(toolStarted("normalize_address", { raw_address: obs.location_raw }));
    events.push(toolCompleted("normalize_address", `Normalized to ${normalized.normalized} (confidence ${normalized.confidence})`, normalized, 0.4));
    const geo = geocode(normalized);
    events.push(toolStarted("geocode_address", { normalized_address: normalized.normalized }));
    events.push(
      toolCompleted(
        "geocode_address",
        geo.verified ? `Geocoded to ${geo.latitude}, ${geo.longitude} (${geo.source})` : `Could not resolve ${normalized.normalized}`,
        geo,
        0.3,
      ),
    );
    state.location = {
      raw: obs.location_raw,
      normalized: normalized.normalized,
      latitude: geo.latitude,
      longitude: geo.longitude,
      confidence: geo.confidence,
      verified: geo.verified,
    };
  }

  // escalations are the only way to skip steps, and only forward
  let transition: ProtocolTransition | null = null;
  let notBreathing = false;
  if (state.protocol.id === "MED_CARDIAC_01") {
    if (state.assessment.breathing === "no") {
      notBreathing = true;
      state.priority = "critical";
      pushUnique(state.facts, "not breathing");
      if (!state.recommended_services.includes("EMS")) state.recommended_services.push("EMS");
      if (indexOf("human_dispatch_approval") > indexOf(step)) {
        transition = { protocol_id: protocolId, from, to: "human_dispatch_approval", reason: "Caller reports patient is not breathing", escalation: true };
        step = "human_dispatch_approval";
      }
      if (!state.facts.includes("specialist requested: cpr_instructions")) {
        proposed.push({
          name: "request_specialist",
          arguments: { type: "cpr_instructions", reason: "Patient not breathing; pre-arrival CPR instructions require dispatcher approval" },
          human_required: true,
          reason: "Patient not breathing; pre-arrival CPR instructions require dispatcher approval",
        });
      }
    } else if (state.assessment.conscious === "no") {
      state.priority = "critical";
      pushUnique(state.facts, "unresponsive");
      if (!state.recommended_services.includes("EMS")) state.recommended_services.push("EMS");
      if (indexOf("breathing_check") > indexOf(step)) {
        transition = { protocol_id: protocolId, from, to: "breathing_check", reason: "Caller reports patient is unresponsive", escalation: true };
        step = "breathing_check";
      }
    } else if (state.assessment.breathing === "labored") {
      state.priority = maxPriority(state.priority, "high");
      pushUnique(state.facts, "difficulty breathing");
      if (!state.recommended_services.includes("EMS")) state.recommended_services.push("EMS");
    }
  }

  // response preparation: units + route once the location is verified and services are known
  let dispatch: DispatchProposedPayload | null = null;
  const prepare = () => {
    if (state.response_plan || !state.location.verified || state.location.latitude === null || state.location.longitude === null) return;
    const primary = state.recommended_services[0];
    if (!primary) return;
    const here = { latitude: state.location.latitude, longitude: state.location.longitude };
    const units = findAvailableUnits(primary, here);
    events.push(toolStarted("find_available_units", { service: primary, location: here, limit: 3 }));
    events.push(
      toolCompleted(
        "find_available_units",
        units.length ? `${units.length} ${primary} unit(s) available; closest ${units[0]!.unit_id} ~${units[0]!.eta_minutes} min` : `no ${primary} units available`,
        { service: primary, units },
        0.15,
      ),
    );
    let route: Route | null = null;
    if (units[0]) {
      route = calculateRoute(units[0], here);
      events.push(toolStarted("calculate_route", { unit: { unit_id: units[0].unit_id, latitude: units[0].latitude, longitude: units[0].longitude }, incident_location: here }));
      events.push(toolCompleted("calculate_route", `${route.unit_id}: ${route.distance_km} km, ETA ${route.eta_minutes} min`, route, 0.05));
    }
    const reason = `Dispatch ${state.recommended_services.join("/")} (${units[0]?.unit_id ?? "unit pending"}) to ${state.location.normalized}`;
    state.response_plan = { services: [...state.recommended_services], units, route, reason, proposed_at: now.toISOString(), cad_id: null };
    dispatch = {
      action_id: `act_${fnv1a(`${state.session_id}:${now.getTime()}`).toString(16)}`,
      services: [...state.recommended_services],
      units,
      route,
      reason,
      human_required: true,
    };
  };

  // normal forward progression
  let guard = 0;
  while (guard < steps.length) {
    guard += 1;
    if (step === "prepare_response" || step === "human_dispatch_approval") prepare();
    if (!isComplete(state, step)) break;
    const next = steps[indexOf(step) + 1];
    if (!next) break;
    step = next;
  }
  if (step === "human_dispatch_approval") prepare();

  if (step !== from) {
    transition ??= {
      protocol_id: protocolId,
      from,
      to: step,
      reason: from === null ? `Protocol ${protocolId} selected for ${state.category} intake` : `${from} complete`,
      escalation: false,
    };
    transition.to = step;
  }
  state.protocol.step = step;

  if (dispatch) {
    state.status = "awaiting_approval";
    state.human_required = true;
    proposed.unshift({ name: "create_cad_draft", arguments: {}, human_required: true, reason: (dispatch as DispatchProposedPayload).reason });
  } else if (step === "human_dispatch_approval") {
    state.human_required = true;
  }

  // approved prompt for the current step
  const prompt = promptFor(state, notBreathing);
  if (CONFIRM_STEPS.has(step) && !state.protocol.asked.includes(step)) state.protocol.asked.push(step);
  state.protocol.last_prompt = prompt;
  state.missing_fields = missingFor(state, step);

  const confidence = obs.triggers.length ? Math.min(0.97, 0.62 + 0.09 * obs.triggers.length) : 0.55;
  state.confidence = Math.max(state.confidence, confidence);
  state.updated_at = now.toISOString();
  state.summary = buildSummary(state);

  if (transition) events.push({ type: "protocol.changed", payload: { protocol_id: protocolId, previous_step: transition.from, current_step: transition.to, reason: transition.reason, escalation: transition.escalation } });
  if (dispatch) events.push({ type: "dispatch.proposed", payload: { ...(dispatch as DispatchProposedPayload) } });
  events.push({ type: "incident.updated", payload: { ...state } });

  return {
    state,
    events,
    next_response: prompt,
    confidence,
    explanation: explain(obs, state, dispatch !== null),
    protocol_transition: transition,
    proposed_tools: proposed,
    triggers: obs.triggers,
    dispatch,
  };
}

function buildSummary(state: IncidentState): string {
  const parts: string[] = [];
  if (state.assessment.chief_complaint) parts.push(`Caller reports ${state.assessment.chief_complaint}`);
  else parts.push("Caller reports an emergency");
  const who = state.facts.find((f) => ["adult male", "adult female", "child"].includes(f));
  if (who) parts[0] += ` (${who})`;
  if (state.location.normalized) parts.push(`at ${state.location.normalized}`);
  if (state.assessment.breathing === "no") parts.push("patient not breathing");
  else if (state.assessment.breathing === "labored") parts.push("breathing labored");
  if (state.response_plan?.route) parts.push(`${state.response_plan.route.unit_id} prepared, ETA ${state.response_plan.route.eta_minutes} min`);
  return `${parts.join(", ")}.`;
}

function explain(obs: Observation, state: IncidentState, proposed: boolean): string {
  if (obs.triggers.includes("not_breathing") || obs.triggers.includes("answer_no") && state.assessment.breathing === "no") {
    return "Caller reports patient is not breathing; escalated to critical and prepared EMS dispatch for human approval.";
  }
  if (obs.triggers.includes("unresponsive")) return "Caller reports patient is unresponsive; escalated to critical, checking breathing.";
  if (obs.triggers.includes("address")) {
    return state.location.verified ? `Address verified as ${state.location.normalized}.` : `Address heard as ${state.location.raw}; could not verify it yet.`;
  }
  if (obs.triggers.includes("labored_breathing") || obs.triggers.includes("conscious")) {
    return `Patient ${state.assessment.conscious === "yes" ? "conscious" : "consciousness unknown"}, breathing ${state.assessment.breathing}; continuing the medical protocol.`;
  }
  if (obs.triggers.includes("chest_pain")) return "Caller reports chest pain; classified as a high-priority medical incident. Address still needed.";
  if (obs.triggers.includes("fire")) return "Caller reports a fire; classified for fire response via general intake.";
  if (obs.triggers.includes("police")) return "Caller reports a possible violent incident; classified for police response.";
  if (obs.triggers.includes("hazards_answer")) return proposed ? "Scene hazards recorded; response prepared for approval." : "Scene hazards recorded.";
  if (obs.triggers.length === 0) return "No new facts extracted from this utterance; repeating the current protocol question.";
  return `Extracted ${obs.triggers.join(", ")}.`;
}
