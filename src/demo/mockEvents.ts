/**
 * The demo script.
 *
 * A deterministic, timed reproduction of the full medical scenario, emitted through
 * the exact same `applyEvent` pipeline the live WebSocket uses. Nothing here is
 * referenced by visual components — swapping this for `/ws/calls/{session_id}`
 * changes no component.
 *
 * The script is split at the human-approval gate. `SCRIPT_PRE` runs on a clock;
 * everything after the gate waits for a real operator decision, because a unit
 * must never be shown moving before approval.
 */

import {
  AURA_EVENT,
  type AuraEvent,
  type Speaker,
  type Vec2,
} from '@/types/events';
import {
  DEMO_INCIDENT,
  LANDMARKS,
  METRES_PER_UNIT,
  pathLength,
  streetRoute,
} from '@/lib/cityLayout';

/* ------------------------------------------------------------------ */
/* Authoring helpers                                                   */
/* ------------------------------------------------------------------ */

export type ScriptedEvent = {
  /** Milliseconds from the start of this script segment. */
  at: number;
  type: string;
  payload: Record<string, unknown>;
};

export const SESSION_ID = 'aura-demo-0197';
export const HERO_CALL = 'call-8841';

const CALL_B = 'call-8837';
const CALL_C = 'call-8845';

const INCIDENT_ID = 'INC-2291';
const ROUTE_ID = 'route-medic12';
const UNIT_ID = 'MEDIC-12';
const APPROVAL_ID = 'APR-7741';

function e(at: number, type: string, payload: Record<string, unknown>): ScriptedEvent {
  return { at, type, payload };
}

/** Deterministic envelope generator for audio levels — no Math.random. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rnd = mulberry32(0x5eed1);

/**
 * Audio level ticks at 20Hz for a speech window. The orb and waveform pulse in
 * sync with these — they are what makes the caller feel alive.
 */
function speech(
  from: number,
  to: number,
  speaker: Speaker,
  intensity = 1,
  callId: string = HERO_CALL,
): ScriptedEvent[] {
  const out: ScriptedEvent[] = [];
  const step = 50;
  const span = Math.max(step, to - from);
  for (let t = from; t <= to; t += step) {
    const progress = (t - from) / span;
    // Envelope: quick attack, sustained middle, decay at the end of the phrase.
    const envelope = Math.min(1, progress * 6) * Math.min(1, (1 - progress) * 5 + 0.25);
    // Syllabic wobble so it reads as speech rather than a sine wave.
    const syllable = 0.55 + 0.45 * Math.abs(Math.sin((t - from) / 95));
    const level = Math.max(
      0.02,
      Math.min(1, envelope * syllable * intensity * (0.72 + rnd() * 0.4)),
    );
    out.push(
      e(t, AURA_EVENT.AudioLevel, {
        call_id: callId,
        level: Number(level.toFixed(3)),
        speaker,
      }),
    );
  }
  return out;
}

const EMS_POST = LANDMARKS.find((l) => l.id === 'ems-post-4')!;
const DEMO_ROUTE: Vec2[] = streetRoute({ x: EMS_POST.x, z: EMS_POST.z }, DEMO_INCIDENT);
const DEMO_ROUTE_M = Math.round(pathLength(DEMO_ROUTE) * METRES_PER_UNIT);

/* ------------------------------------------------------------------ */
/* Segment 1 — calm idle through the approval gate                     */
/* ------------------------------------------------------------------ */

const PRE: ScriptedEvent[] = [
  /* 1. Calm idle city. Nothing but the session opening. */
  e(0, AURA_EVENT.SessionStarted, { session_id: SESSION_ID, city: 'Bayside' }),

  /* 2. The call arrives. */
  e(2600, AURA_EVENT.CallIncoming, {
    call_id: HERO_CALL,
    caller_number: '+1 (415) 555-0163',
    location_hint: 'Near Alder & 3rd',
    coords: DEMO_INCIDENT,
  }),

  // The critical slots the operator needs filled — dark and hollow until confirmed.
  e(2680, AURA_EVENT.FactMissing, { call_id: HERO_CALL, key: 'location', label: 'Location', critical: true }),
  e(2700, AURA_EVENT.FactMissing, { call_id: HERO_CALL, key: 'complaint', label: 'Chief complaint', critical: true }),
  e(2720, AURA_EVENT.FactMissing, { call_id: HERO_CALL, key: 'breathing', label: 'Breathing', critical: true }),
  e(2740, AURA_EVENT.FactMissing, { call_id: HERO_CALL, key: 'consciousness', label: 'Consciousness', critical: true }),
  e(2760, AURA_EVENT.FactMissing, { call_id: HERO_CALL, key: 'patient_age', label: 'Patient age', critical: false }),
  e(2780, AURA_EVENT.FactMissing, { call_id: HERO_CALL, key: 'caller_relation', label: 'Caller relation', critical: false }),

  e(2820, AURA_EVENT.ToolInvoked, {
    call_id: HERO_CALL,
    tool_call_id: 'tc-locate-1',
    tool: 'geolocate',
    label: 'Geolocate caller',
    stage: 'locate',
  }),

  /* 3. The caller speaks; transcript and waveform animate. */
  ...speech(3000, 3900, 'caller', 1),
  e(3050, AURA_EVENT.TranscriptPartial, { call_id: HERO_CALL, turn_id: 't1', speaker: 'caller', text: 'I need help—' }),
  e(3400, AURA_EVENT.TranscriptPartial, { call_id: HERO_CALL, turn_id: 't1', speaker: 'caller', text: 'I need help, my dad just collapsed in the' }),
  e(3850, AURA_EVENT.TranscriptFinal, { call_id: HERO_CALL, turn_id: 't1', speaker: 'caller', text: 'I need help, my dad just collapsed in the kitchen.' }),

  e(3600, AURA_EVENT.ToolResult, {
    call_id: HERO_CALL,
    tool_call_id: 'tc-locate-1',
    tool: 'geolocate',
    status: 'ok',
    summary: 'ANI/ALI → 1420 Alder St · 0.62',
  }),
  e(3660, AURA_EVENT.LocationCandidate, {
    call_id: HERO_CALL,
    address: '1420 Alder St',
    confidence: 0.62,
    coords: DEMO_INCIDENT,
  }),
  e(3950, AURA_EVENT.FactExtracted, {
    call_id: HERO_CALL, key: 'caller_relation', label: 'Caller relation',
    value: 'Son, on scene', confidence: 0.88,
  }),

  // A second and third call land so the stack has weight and can reorder.
  e(4050, AURA_EVENT.CallIncoming, {
    call_id: CALL_B,
    caller_number: '+1 (415) 555-0921',
    location_hint: 'Sutter & 5th',
    coords: { x: -38, z: 22 },
  }),
  e(4180, AURA_EVENT.IncidentClassified, {
    call_id: CALL_B, incident_id: 'INC-2288', category: 'fire', priority: 'low',
    reason: 'Automatic alarm, no smoke reported',
  }),
  e(4600, AURA_EVENT.CallIncoming, {
    call_id: CALL_C,
    caller_number: '+1 (415) 555-0344',
    location_hint: 'Harbor Way',
    coords: { x: 44, z: -14 },
  }),
  e(4720, AURA_EVENT.IncidentClassified, {
    call_id: CALL_C, incident_id: 'INC-2290', category: 'police', priority: 'low',
    reason: 'Noise complaint',
  }),

  /* AURA answers — violet, reasoning. */
  ...speech(4200, 4900, 'aura', 0.72),
  e(4240, AURA_EVENT.TranscriptPartial, { call_id: HERO_CALL, turn_id: 't2', speaker: 'aura', text: 'Stay with me.' }),
  e(4820, AURA_EVENT.TranscriptFinal, { call_id: HERO_CALL, turn_id: 't2', speaker: 'aura', text: 'Stay with me. Is he awake, and is he breathing?' }),

  e(4900, AURA_EVENT.FactExtracted, {
    call_id: HERO_CALL, key: 'complaint', label: 'Chief complaint',
    value: 'Adult collapse', confidence: 0.81, critical: true,
  }),

  ...speech(5050, 6150, 'caller', 1),
  e(5100, AURA_EVENT.TranscriptPartial, { call_id: HERO_CALL, turn_id: 't3', speaker: 'caller', text: "He's breathing but he won't wake up." }),
  e(5900, AURA_EVENT.TranscriptFinal, {
    call_id: HERO_CALL, turn_id: 't3', speaker: 'caller',
    text: "He's breathing but he won't wake up. We're at 1420 Alder Street, apartment 3B.",
  }),

  /* 4. The address is verified and the city pin locks into place. */
  e(5250, AURA_EVENT.ToolInvoked, {
    call_id: HERO_CALL, tool_call_id: 'tc-verify-1', tool: 'verify_address',
    label: 'Verify address', stage: 'verify',
  }),
  e(6050, AURA_EVENT.LocationVerified, {
    call_id: HERO_CALL,
    address: '1420 Alder St, Apt 3B',
    confidence: 0.97,
    coords: DEMO_INCIDENT,
  }),
  e(6090, AURA_EVENT.ToolResult, {
    call_id: HERO_CALL, tool_call_id: 'tc-verify-1', tool: 'verify_address',
    status: 'ok', summary: 'Verified · unit 3B · 0.97',
  }),
  e(6140, AURA_EVENT.FactExtracted, {
    call_id: HERO_CALL, key: 'location', label: 'Location',
    value: '1420 Alder St, Apt 3B', confidence: 0.97, critical: true,
  }),
  e(6200, AURA_EVENT.FactExtracted, {
    call_id: HERO_CALL, key: 'consciousness', label: 'Consciousness',
    value: 'Unresponsive', confidence: 0.91, critical: true,
  }),

  /* 5. Medical priority appears — amber. */
  e(6280, AURA_EVENT.ToolInvoked, {
    call_id: HERO_CALL, tool_call_id: 'tc-classify-1', tool: 'classify_incident',
    label: 'Classify incident', stage: 'classify',
  }),
  e(6620, AURA_EVENT.IncidentClassified, {
    call_id: HERO_CALL,
    incident_id: INCIDENT_ID,
    category: 'medical',
    priority: 'high',
    reason: 'Adult collapse · unresponsive · breathing present',
  }),
  e(6680, AURA_EVENT.ToolResult, {
    call_id: HERO_CALL, tool_call_id: 'tc-classify-1', tool: 'classify_incident',
    status: 'ok', summary: 'Medical · urgent',
  }),
  e(6760, AURA_EVENT.ProtocolActivated, {
    call_id: HERO_CALL,
    protocol_id: 'med-unresponsive',
    name: 'Unresponsive Adult',
    why: 'Collapse with unresponsiveness',
    steps: [
      { step_id: 'airway', label: 'Check airway' },
      { step_id: 'breathing', label: 'Confirm breathing' },
      { step_id: 'position', label: 'Recovery position' },
      { step_id: 'monitor', label: 'Monitor until EMS' },
    ],
  }),
  e(6840, AURA_EVENT.ProtocolStep, {
    call_id: HERO_CALL, protocol_id: 'med-unresponsive', step_id: 'airway',
    status: 'active', why: 'Unresponsive patient — airway comes first',
  }),
  e(6980, AURA_EVENT.FactExtracted, {
    call_id: HERO_CALL, key: 'patient_age', label: 'Patient age',
    value: '68', confidence: 0.9,
  }),
  e(7100, AURA_EVENT.FactExtracted, {
    call_id: HERO_CALL, key: 'breathing', label: 'Breathing',
    value: 'Present · shallow', confidence: 0.7, critical: true,
  }),

  // The background fire call escalates — the stack reorders under the hero.
  e(7250, AURA_EVENT.IncidentReclassified, {
    call_id: CALL_B, incident_id: 'INC-2288', category: 'fire',
    priority: 'high', previous_priority: 'low',
    reason: 'Smoke confirmed by second caller',
  }),

  ...speech(7300, 8150, 'aura', 0.7),
  e(7340, AURA_EVENT.TranscriptPartial, { call_id: HERO_CALL, turn_id: 't4', speaker: 'aura', text: 'Roll him onto his side.' }),
  e(8050, AURA_EVENT.TranscriptFinal, {
    call_id: HERO_CALL, turn_id: 't4', speaker: 'aura',
    text: "Roll him onto his side and keep his chin lifted. Tell me the moment anything changes.",
  }),
  e(8100, AURA_EVENT.ProtocolStep, {
    call_id: HERO_CALL, protocol_id: 'med-unresponsive', step_id: 'airway',
    status: 'done', why: 'Airway cleared by caller',
  }),
  e(8160, AURA_EVENT.ProtocolStep, {
    call_id: HERO_CALL, protocol_id: 'med-unresponsive', step_id: 'position',
    status: 'active', why: 'Recovery position while breathing persists',
  }),

  /* 6. "He stopped breathing." */
  ...speech(8600, 9250, 'caller', 1),
  e(8620, AURA_EVENT.TranscriptPartial, { call_id: HERO_CALL, turn_id: 't5', speaker: 'caller', text: 'Wait—' }),
  e(9050, AURA_EVENT.TranscriptFinal, { call_id: HERO_CALL, turn_id: 't5', speaker: 'caller', text: 'He stopped breathing!' }),

  /* 7. AURA's response is cut off; one red flash; priority becomes critical. */
  e(9080, AURA_EVENT.AudioInterrupted, { call_id: HERO_CALL, reason: 'caller_override' }),
  e(9140, AURA_EVENT.IncidentReclassified, {
    call_id: HERO_CALL,
    incident_id: INCIDENT_ID,
    category: 'medical',
    priority: 'critical',
    previous_priority: 'high',
    reason: 'Respiratory arrest reported by caller',
  }),
  e(9220, AURA_EVENT.FactExtracted, {
    call_id: HERO_CALL, key: 'breathing', label: 'Breathing',
    value: 'ABSENT · respiratory arrest', confidence: 0.98, critical: true,
  }),

  /* 8. Cardiac protocol expands, EMS illuminates, the best route draws itself. */
  e(9360, AURA_EVENT.ProtocolActivated, {
    call_id: HERO_CALL,
    protocol_id: 'cardiac-arrest',
    name: 'Cardiac Arrest — CPR',
    why: 'Breathing absent in an unresponsive adult',
    steps: [
      { step_id: 'confirm_arrest', label: 'Confirm arrest' },
      { step_id: 'flat_surface', label: 'Flat on back' },
      { step_id: 'compressions', label: 'Compressions 100–120/min' },
      { step_id: 'aed', label: 'AED if available' },
      { step_id: 'ems_handoff', label: 'EMS handoff' },
    ],
  }),
  e(9420, AURA_EVENT.ProtocolStep, {
    call_id: HERO_CALL, protocol_id: 'cardiac-arrest', step_id: 'confirm_arrest',
    status: 'done', why: 'Caller reports no breathing',
  }),
  e(9500, AURA_EVENT.ProtocolStep, {
    call_id: HERO_CALL, protocol_id: 'cardiac-arrest', step_id: 'flat_surface',
    status: 'active', why: 'Compressions require a firm flat surface',
  }),

  ...speech(9560, 10600, 'aura', 0.95),
  e(9600, AURA_EVENT.TranscriptPartial, { call_id: HERO_CALL, turn_id: 't6', speaker: 'aura', text: 'Flat on his back, now.' }),
  e(10500, AURA_EVENT.TranscriptFinal, {
    call_id: HERO_CALL, turn_id: 't6', speaker: 'aura',
    text: "Flat on his back, now. Heel of your hand on the centre of his chest — push hard and fast. I'll count with you.",
  }),
  e(10620, AURA_EVENT.ProtocolStep, {
    call_id: HERO_CALL, protocol_id: 'cardiac-arrest', step_id: 'flat_surface',
    status: 'done', why: 'Patient repositioned',
  }),
  e(10680, AURA_EVENT.ProtocolStep, {
    call_id: HERO_CALL, protocol_id: 'cardiac-arrest', step_id: 'compressions',
    status: 'active', why: 'Coaching compressions at 110/min',
  }),

  e(9700, AURA_EVENT.ToolInvoked, {
    call_id: HERO_CALL, tool_call_id: 'tc-ems-1', tool: 'prepare_ems',
    label: 'Stage nearest EMS', stage: 'prepare_ems',
  }),
  e(9900, AURA_EVENT.RespondersAvailable, {
    incident_id: INCIDENT_ID,
    units: [
      {
        unit_id: UNIT_ID, kind: 'ems', label: 'Medic 12',
        coords: { x: EMS_POST.x, z: EMS_POST.z }, eta_s: 250, distance_m: DEMO_ROUTE_M,
      },
      {
        unit_id: 'MEDIC-04', kind: 'ems', label: 'Medic 04',
        coords: { x: -40, z: 20 }, eta_s: 520, distance_m: 1980,
      },
      {
        unit_id: 'ENGINE-7', kind: 'fire', label: 'Engine 7',
        coords: { x: 40, z: 40 }, eta_s: 470, distance_m: 1740,
      },
    ],
  }),
  e(10250, AURA_EVENT.RouteProposed, {
    incident_id: INCIDENT_ID,
    route_id: ROUTE_ID,
    unit_id: UNIT_ID,
    path: DEMO_ROUTE,
    eta_s: 250,
    distance_m: DEMO_ROUTE_M,
  }),
  e(10400, AURA_EVENT.ToolResult, {
    call_id: HERO_CALL, tool_call_id: 'tc-ems-1', tool: 'prepare_ems',
    status: 'ok', summary: 'Medic 12 staged · ETA 4:10',
  }),

  /* 9. The human-approval gate slides into the centre. */
  e(10900, AURA_EVENT.ToolInvoked, {
    call_id: HERO_CALL, tool_call_id: 'tc-approve-1', tool: 'request_approval',
    label: 'Request dispatch approval', stage: 'human_approval',
  }),
  e(11050, AURA_EVENT.ApprovalRequested, {
    incident_id: INCIDENT_ID,
    approval_id: APPROVAL_ID,
    summary: 'Dispatch Medic 12 to 1420 Alder St, Apt 3B — cardiac arrest, CPR in progress',
    route_id: ROUTE_ID,
    unit_id: UNIT_ID,
    expires_in_s: 30,
  }),
];

/* ------------------------------------------------------------------ */
/* Segment 2 — only after a real operator approval                     */
/* ------------------------------------------------------------------ */

function dispatchTicks(startAt: number, durationMs: number): ScriptedEvent[] {
  const out: ScriptedEvent[] = [];
  const steps = 48;
  for (let i = 1; i <= steps; i++) {
    out.push(
      e(startAt + (durationMs * i) / steps, AURA_EVENT.DispatchProgress, {
        incident_id: INCIDENT_ID,
        unit_id: UNIT_ID,
        progress: Number((i / steps).toFixed(4)),
      }),
    );
  }
  return out;
}

const DISPATCH_MS = 13000;

const POST_APPROVED: ScriptedEvent[] = [
  /* 10. Approval sends a green signal through the route; the unit starts moving. */
  e(120, AURA_EVENT.ToolResult, {
    call_id: HERO_CALL, tool_call_id: 'tc-approve-1', tool: 'request_approval',
    status: 'ok', summary: 'Approved — Medic 12 dispatched',
  }),
  e(320, AURA_EVENT.DispatchStarted, {
    incident_id: INCIDENT_ID, unit_id: UNIT_ID, route_id: ROUTE_ID,
  }),
  ...dispatchTicks(600, DISPATCH_MS),
  e(600 + DISPATCH_MS + 200, AURA_EVENT.DispatchArrived, {
    incident_id: INCIDENT_ID, unit_id: UNIT_ID,
  }),
  e(600 + DISPATCH_MS + 400, AURA_EVENT.ProtocolStep, {
    call_id: HERO_CALL, protocol_id: 'cardiac-arrest', step_id: 'compressions',
    status: 'done', why: 'EMS on scene, taking over compressions',
  }),
  e(600 + DISPATCH_MS + 480, AURA_EVENT.ProtocolStep, {
    call_id: HERO_CALL, protocol_id: 'cardiac-arrest', step_id: 'ems_handoff',
    status: 'active', why: 'Medic 12 at patient side',
  }),
  e(600 + DISPATCH_MS + 1600, AURA_EVENT.CallEnded, {
    call_id: HERO_CALL, reason: 'EMS on scene',
  }),
];

const POST_REJECTED: ScriptedEvent[] = [
  e(120, AURA_EVENT.ToolResult, {
    call_id: HERO_CALL, tool_call_id: 'tc-approve-1', tool: 'request_approval',
    status: 'error', summary: 'Rejected by operator — no unit dispatched',
  }),
  e(300, AURA_EVENT.ProtocolStep, {
    call_id: HERO_CALL, protocol_id: 'cardiac-arrest', step_id: 'ems_handoff',
    status: 'blocked', why: 'Dispatch rejected — awaiting operator instruction',
  }),
];

/* ------------------------------------------------------------------ */
/* Compiled script                                                     */
/* ------------------------------------------------------------------ */

function compile(segments: ScriptedEvent[][]): { at: number; event: AuraEvent }[][] {
  let seq = 1;
  const base = Date.parse('2026-09-19T21:14:00.000Z');
  return segments.map((segment) => {
    const sorted = [...segment].sort((a, b) => a.at - b.at);
    return sorted.map((s) => {
      const sequence = seq++;
      return {
        at: s.at,
        event: {
          event_id: `mock-${sequence}`,
          session_id: SESSION_ID,
          type: s.type,
          timestamp: new Date(base + s.at).toISOString(),
          sequence,
          payload: s.payload,
        } satisfies AuraEvent,
      };
    });
  });
}

const [PRE_COMPILED, POST_APPROVED_COMPILED, POST_REJECTED_COMPILED] = compile([
  PRE,
  POST_APPROVED,
  POST_REJECTED,
]);

/** Everything up to and including `approval.requested`. */
export const SCRIPT_PRE = PRE_COMPILED;
/** Emitted only after a granted approval; `at` is relative to the decision. */
export const SCRIPT_APPROVED = POST_APPROVED_COMPILED;
/** Emitted only after a rejection. */
export const SCRIPT_REJECTED = POST_REJECTED_COMPILED;

/** Flat list, for tests and for replaying the whole thing without a gate. */
export const MOCK_EVENTS: AuraEvent[] = [
  ...SCRIPT_PRE.map((s) => s.event),
  ...SCRIPT_APPROVED.map((s) => s.event),
];

export const PRE_DURATION_MS = SCRIPT_PRE.length
  ? SCRIPT_PRE[SCRIPT_PRE.length - 1].at
  : 0;
export const APPROVED_DURATION_MS = SCRIPT_APPROVED.length
  ? SCRIPT_APPROVED[SCRIPT_APPROVED.length - 1].at
  : 0;

/** Named beats, for the demo scrubber. `at` is within segment 1. */
export const DEMO_BEATS: { at: number; label: string }[] = [
  { at: 0, label: 'Idle city' },
  { at: 2600, label: 'Call arrives' },
  { at: 3000, label: 'Caller speaking' },
  { at: 6050, label: 'Address verified' },
  { at: 6620, label: 'Medical · urgent' },
  { at: 9050, label: '“He stopped breathing”' },
  { at: 9140, label: 'Critical' },
  { at: 9360, label: 'Cardiac protocol' },
  { at: 10250, label: 'Route proposed' },
  { at: 11050, label: 'Approval gate' },
];

export { DEMO_ROUTE, DEMO_ROUTE_M, UNIT_ID as DEMO_UNIT_ID, ROUTE_ID as DEMO_ROUTE_ID };
