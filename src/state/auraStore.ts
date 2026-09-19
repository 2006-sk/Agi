/**
 * AURA UI state.
 *
 * `applyEvent` is the ONLY way domain state changes. The mock player and the live
 * WebSocket both feed this one function, which is what makes swapping the mock
 * source for `/ws/calls/{session_id}` a zero-change operation for the visuals.
 *
 * Ingestion guarantees:
 *  - duplicate `event_id` -> ignored
 *  - `sequence` older than the last applied -> ignored (animations never rewind)
 *  - `sequence` ahead of the next expected -> buffered until the gap fills, or
 *    released by `flushGaps()` so a lost event cannot stall the demo
 *  - unknown `type` -> counted and ignored, never thrown
 *
 * Approval invariant (store-level, not component-level):
 *  `dispatch` may only reach 'approved' / 'enroute' / 'arrived' after an
 *  `approval.granted`. A route may be drawn at 'proposed'; a unit may only MOVE
 *  from 'approved' onward.
 */

import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';

import {
  AURA_EVENT,
  asBool,
  asCategory,
  asNumber,
  asPriority,
  asResponderKind,
  asSpeaker,
  asString,
  asToolStage,
  asVec2,
  asVec2Array,
  priorityRank,
  unit as clamp01,
  type AuraEvent,
  type IncidentCategory,
  type Priority,
  type ResponderKind,
  type Speaker,
  type ToolStage,
  type ToolStatus,
  type ProtocolStepStatus,
  type Vec2,
} from '@/types/events';
import { TOOL_STAGES } from '@/types/events';

/* ------------------------------------------------------------------ */
/* Shapes                                                              */
/* ------------------------------------------------------------------ */

export type Phase =
  | 'idle'
  | 'incoming'
  | 'assessing'
  | 'critical'
  | 'awaiting_approval'
  | 'dispatched'
  | 'resolved';

/** The one fact that gates responder movement. */
export type DispatchState =
  | 'none'
  | 'proposed'
  | 'approved'
  | 'rejected'
  | 'enroute'
  | 'arrived';

export type Quality = 'high' | 'medium' | 'low';

export type Connection = 'offline' | 'mock' | 'connecting' | 'live' | 'error';

export type StageState = 'idle' | 'active' | 'done' | 'error' | 'blocked';

export interface CallEntry {
  id: string;
  number: string;
  locationHint: string;
  coords: Vec2 | null;
  startedAtMs: number;
  category: IncidentCategory;
  priority: Priority;
  status: 'live' | 'ended';
  /** Latest audio level, 0..1. The active caller's orb pulses to this. */
  level: number;
  speaker: Speaker;
  /** Rolling window of recent levels, oldest first. */
  waveform: number[];
  endedReason?: string;
}

export interface TranscriptLine {
  id: string;
  speaker: Speaker;
  text: string;
  final: boolean;
  seq: number;
}

export interface FactEntry {
  key: string;
  label: string;
  value: string;
  confidence: number;
  critical: boolean;
  /** 'missing' renders hollow and dark; 'confirmed' animates in as a chip. */
  state: 'missing' | 'confirmed';
  seq: number;
}

export interface LocationEntry {
  address: string;
  confidence: number;
  coords: Vec2;
  verified: boolean;
}

export interface IncidentEntry {
  id: string;
  callId: string;
  category: IncidentCategory;
  priority: Priority;
  previousPriority: Priority | null;
  reason: string;
}

export interface ProtocolStepEntry {
  id: string;
  label: string;
  status: ProtocolStepStatus;
  why: string;
}

export interface ProtocolEntry {
  id: string;
  name: string;
  /** Why the protocol or its current step changed. */
  why: string;
  steps: ProtocolStepEntry[];
}

export interface ToolEntry {
  id: string;
  tool: string;
  label: string;
  stage: ToolStage | null;
  status: ToolStatus;
  summary: string;
  seq: number;
}

export interface UnitEntry {
  id: string;
  kind: ResponderKind;
  label: string;
  coords: Vec2;
  etaS: number;
  distanceM: number;
  /** True for the unit on the proposed route. */
  selected: boolean;
}

export interface RouteEntry {
  id: string;
  unitId: string;
  path: Vec2[];
  etaS: number;
  distanceM: number;
}

export interface ApprovalEntry {
  id: string;
  summary: string;
  routeId: string;
  unitId: string;
  expiresInS: number;
  state: 'pending' | 'granted' | 'rejected';
  by: string;
  reason: string;
}

/** One-shot animation triggers. Components watch the counter, not a boolean. */
export interface Signals {
  /** Priority escalated to critical — short, strong red shockwave. */
  critical: number;
  /** AURA's audio response was cut off. */
  interrupt: number;
  /** Approval gate slid into view. */
  approvalOpen: number;
  /** Green go-signal travels the route. */
  approved: number;
  rejected: number;
  /** Address verified — city pin locks into place. */
  locationLocked: number;
  /** A new call arrived. */
  callArrived: number;
}

export interface IngestStats {
  applied: number;
  duplicates: number;
  stale: number;
  buffered: number;
  unknown: number;
  lastType: string;
}

export type OperatorCommand =
  | { kind: 'approval'; approval_id: string; decision: 'granted' | 'rejected'; reason?: string };

export interface AuraState {
  sessionId: string | null;
  phase: Phase;

  calls: Record<string, CallEntry>;
  callIds: string[];
  activeCallId: string | null;

  transcript: TranscriptLine[];
  facts: Record<string, FactEntry>;
  factKeys: string[];

  location: LocationEntry | null;
  incident: IncidentEntry | null;
  protocol: ProtocolEntry | null;

  tools: ToolEntry[];
  stages: Record<ToolStage, StageState>;

  units: UnitEntry[];
  route: RouteEntry | null;
  dispatch: DispatchState;
  dispatchProgress: number;
  approval: ApprovalEntry | null;

  /** Where the camera should fly. `nonce` changes even when the target repeats. */
  camera: { target: Vec2 | null; nonce: number };
  signals: Signals;
  stats: IngestStats;

  connection: Connection;
  reducedMotion: boolean;
  quality: Quality;
  /** True once the renderer has been downgraded for performance. */
  degraded: boolean;

  /* actions */
  applyEvent: (evt: AuraEvent) => void;
  applyEvents: (evts: AuraEvent[]) => void;
  /** Release the oldest buffered event when a gap will clearly never fill. */
  flushGaps: () => void;
  reset: () => void;
  resolveApproval: (decision: 'granted' | 'rejected', by?: string, reason?: string) => void;
  setCommandSink: (sink: ((cmd: OperatorCommand) => void) | null) => void;
  setConnection: (c: Connection) => void;
  setReducedMotion: (v: boolean) => void;
  setQuality: (q: Quality) => void;
  setDegraded: (v: boolean) => void;
  focusCall: (callId: string) => void;
}

/* ------------------------------------------------------------------ */
/* Non-reactive ingest bookkeeping                                     */
/* ------------------------------------------------------------------ */

const WAVEFORM_WINDOW = 72;
const TRANSCRIPT_WINDOW = 120;
const TOOL_WINDOW = 40;

const ingest = {
  seen: new Set<string>(),
  buffer: new Map<number, AuraEvent>(),
  lastSequence: null as number | null,
};

let commandSink: ((cmd: OperatorCommand) => void) | null = null;

function resetIngest() {
  ingest.seen.clear();
  ingest.buffer.clear();
  ingest.lastSequence = null;
}

function emptyStages(): Record<ToolStage, StageState> {
  return TOOL_STAGES.reduce(
    (acc, s) => {
      acc[s] = 'idle';
      return acc;
    },
    {} as Record<ToolStage, StageState>,
  );
}

function initialState() {
  return {
    sessionId: null as string | null,
    phase: 'idle' as Phase,
    calls: {} as Record<string, CallEntry>,
    callIds: [] as string[],
    activeCallId: null as string | null,
    transcript: [] as TranscriptLine[],
    facts: {} as Record<string, FactEntry>,
    factKeys: [] as string[],
    location: null as LocationEntry | null,
    incident: null as IncidentEntry | null,
    protocol: null as ProtocolEntry | null,
    tools: [] as ToolEntry[],
    stages: emptyStages(),
    units: [] as UnitEntry[],
    route: null as RouteEntry | null,
    dispatch: 'none' as DispatchState,
    dispatchProgress: 0,
    approval: null as ApprovalEntry | null,
    camera: { target: null as Vec2 | null, nonce: 0 },
    signals: {
      critical: 0,
      interrupt: 0,
      approvalOpen: 0,
      approved: 0,
      rejected: 0,
      locationLocked: 0,
      callArrived: 0,
    } as Signals,
    stats: {
      applied: 0,
      duplicates: 0,
      stale: 0,
      buffered: 0,
      unknown: 0,
      lastType: '',
    } as IngestStats,
  };
}

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

export const useAuraStore = create<AuraState>()((set, get) => ({
  ...initialState(),

  connection: 'offline',
  reducedMotion: false,
  quality: 'high',
  degraded: false,

  setCommandSink: (sink) => {
    commandSink = sink;
  },
  setConnection: (connection) => set({ connection }),
  setReducedMotion: (reducedMotion) => set({ reducedMotion }),
  setQuality: (quality) => set({ quality }),
  setDegraded: (degraded) => set({ degraded }),

  focusCall: (callId) =>
    set((s) => {
      const call = s.calls[callId];
      if (!call) return s;
      return {
        activeCallId: callId,
        camera: call.coords
          ? { target: call.coords, nonce: s.camera.nonce + 1 }
          : s.camera,
      };
    }),

  reset: () => {
    resetIngest();
    set({ ...initialState() });
  },

  applyEvents: (evts) => {
    for (const e of evts) get().applyEvent(e);
  },

  flushGaps: () => {
    if (ingest.buffer.size === 0) return;
    const next = Math.min(...ingest.buffer.keys());
    const evt = ingest.buffer.get(next);
    if (!evt) return;
    ingest.buffer.delete(next);
    ingest.lastSequence = next;
    set((s) => reduce(s, evt));
    drain(set);
  },

  applyEvent: (evt) => {
    if (!evt || typeof evt !== 'object') return;
    const id = asString((evt as AuraEvent).event_id);
    const type = asString((evt as AuraEvent).type);
    if (!id || !type) return;

    if (ingest.seen.has(id)) {
      set((s) => ({ stats: { ...s.stats, duplicates: s.stats.duplicates + 1 } }));
      return;
    }
    ingest.seen.add(id);

    const seq = (evt as AuraEvent).sequence;
    if (typeof seq !== 'number' || !Number.isFinite(seq)) {
      // No usable ordering key — apply immediately rather than dropping data.
      set((s) => reduce(s, evt));
      return;
    }

    if (ingest.lastSequence === null) ingest.lastSequence = seq - 1;

    if (seq <= ingest.lastSequence) {
      set((s) => ({ stats: { ...s.stats, stale: s.stats.stale + 1 } }));
      return;
    }

    if (seq > ingest.lastSequence + 1) {
      ingest.buffer.set(seq, evt);
      set((s) => ({ stats: { ...s.stats, buffered: s.stats.buffered + 1 } }));
      return;
    }

    ingest.lastSequence = seq;
    set((s) => reduce(s, evt));
    drain(set);
  },

  resolveApproval: (decision, by = 'operator', reason = '') => {
    const s = get();
    const approval = s.approval;
    if (!approval || approval.state !== 'pending') return;

    const seq = (ingest.lastSequence ?? 0) + 1;
    const type =
      decision === 'granted' ? AURA_EVENT.ApprovalGranted : AURA_EVENT.ApprovalRejected;

    // Route the operator's decision through the same pipeline as backend events so
    // there is exactly one code path that can change `dispatch`.
    get().applyEvent({
      event_id: `local:${type}:${approval.id}:${seq}`,
      session_id: s.sessionId ?? 'local',
      type,
      timestamp: new Date().toISOString(),
      sequence: seq,
      payload: {
        incident_id: s.incident?.id ?? '',
        approval_id: approval.id,
        by,
        reason,
      },
    });

    commandSink?.({ kind: 'approval', approval_id: approval.id, decision, reason });
  },
}));

type Setter = (fn: (s: AuraState) => Partial<AuraState>) => void;

function drain(set: Setter) {
  while (ingest.lastSequence !== null && ingest.buffer.has(ingest.lastSequence + 1)) {
    const next = ingest.lastSequence + 1;
    const evt = ingest.buffer.get(next)!;
    ingest.buffer.delete(next);
    ingest.lastSequence = next;
    set((s) => reduce(s, evt));
  }
}

/* ------------------------------------------------------------------ */
/* Reducer                                                             */
/* ------------------------------------------------------------------ */

function parseTs(ts: unknown): number {
  const n = typeof ts === 'string' ? Date.parse(ts) : NaN;
  return Number.isFinite(n) ? n : Date.now();
}

function reduce(s: AuraState, evt: AuraEvent): Partial<AuraState> {
  const p = (evt.payload ?? {}) as Record<string, unknown>;
  const seq = typeof evt.sequence === 'number' ? evt.sequence : 0;
  const applied = { applied: s.stats.applied + 1, lastType: evt.type };

  switch (evt.type) {
    /* ---------------- session ---------------- */
    case AURA_EVENT.SessionStarted: {
      // A new session restarts sequence numbering, so the ingest baseline resets
      // with it. Keep this event's own id so an immediate redelivery is still a
      // duplicate rather than being re-applied.
      resetIngest();
      ingest.seen.add(evt.event_id);
      ingest.lastSequence = seq;
      return {
        ...initialState(),
        sessionId: asString(p.session_id, evt.session_id),
        stats: { ...s.stats, ...applied, lastType: evt.type },
      };
    }

    /* ---------------- calls ---------------- */
    case AURA_EVENT.CallIncoming: {
      const id = asString(p.call_id);
      if (!id) return { stats: { ...s.stats, ...applied } };
      const coords = asVec2(p.coords);
      const call: CallEntry = {
        id,
        number: asString(p.caller_number, 'UNKNOWN'),
        locationHint: asString(p.location_hint),
        coords,
        startedAtMs: parseTs(evt.timestamp),
        category: 'unknown',
        priority: 'unknown',
        status: 'live',
        level: 0,
        speaker: 'caller',
        waveform: [],
      };
      return {
        calls: { ...s.calls, [id]: call },
        callIds: s.callIds.includes(id) ? s.callIds : [...s.callIds, id],
        activeCallId: s.activeCallId ?? id,
        phase: s.phase === 'idle' ? 'incoming' : s.phase,
        camera: coords ? { target: coords, nonce: s.camera.nonce + 1 } : s.camera,
        signals: { ...s.signals, callArrived: s.signals.callArrived + 1 },
        stats: { ...s.stats, ...applied },
      };
    }

    case AURA_EVENT.CallEnded: {
      const id = asString(p.call_id);
      const call = s.calls[id];
      if (!call) return { stats: { ...s.stats, ...applied } };
      return {
        calls: {
          ...s.calls,
          [id]: { ...call, status: 'ended', level: 0, endedReason: asString(p.reason) },
        },
        phase: s.dispatch === 'enroute' || s.dispatch === 'arrived' ? s.phase : 'resolved',
        stats: { ...s.stats, ...applied },
      };
    }

    /* ---------------- audio ---------------- */
    case AURA_EVENT.AudioLevel: {
      const id = asString(p.call_id);
      const call = s.calls[id];
      if (!call) return { stats: { ...s.stats, ...applied } };
      const level = clamp01(asNumber(p.level));
      const waveform = call.waveform.length >= WAVEFORM_WINDOW
        ? [...call.waveform.slice(call.waveform.length - WAVEFORM_WINDOW + 1), level]
        : [...call.waveform, level];
      return {
        calls: {
          ...s.calls,
          [id]: { ...call, level, speaker: asSpeaker(p.speaker), waveform },
        },
        stats: { ...s.stats, ...applied },
      };
    }

    case AURA_EVENT.AudioInterrupted: {
      const id = asString(p.call_id);
      const call = s.calls[id];
      return {
        calls: call ? { ...s.calls, [id]: { ...call, level: 0 } } : s.calls,
        signals: { ...s.signals, interrupt: s.signals.interrupt + 1 },
        stats: { ...s.stats, ...applied },
      };
    }

    /* ---------------- transcript ---------------- */
    case AURA_EVENT.TranscriptPartial:
    case AURA_EVENT.TranscriptFinal: {
      const turnId = asString(p.turn_id);
      if (!turnId) return { stats: { ...s.stats, ...applied } };
      const line: TranscriptLine = {
        id: turnId,
        speaker: asSpeaker(p.speaker),
        text: asString(p.text),
        final: evt.type === AURA_EVENT.TranscriptFinal,
        seq,
      };
      const idx = s.transcript.findIndex((l) => l.id === turnId);
      let transcript: TranscriptLine[];
      if (idx >= 0) {
        transcript = [...s.transcript];
        transcript[idx] = line;
      } else {
        transcript = [...s.transcript, line];
        if (transcript.length > TRANSCRIPT_WINDOW) {
          transcript = transcript.slice(transcript.length - TRANSCRIPT_WINDOW);
        }
      }
      return { transcript, stats: { ...s.stats, ...applied } };
    }

    /* ---------------- facts ---------------- */
    case AURA_EVENT.FactExtracted: {
      const key = asString(p.key);
      if (!key) return { stats: { ...s.stats, ...applied } };
      const fact: FactEntry = {
        key,
        label: asString(p.label, key),
        value: asString(p.value),
        confidence: clamp01(asNumber(p.confidence, 1)),
        critical: asBool(p.critical),
        state: 'confirmed',
        seq,
      };
      return {
        facts: { ...s.facts, [key]: fact },
        factKeys: s.factKeys.includes(key) ? s.factKeys : [...s.factKeys, key],
        stats: { ...s.stats, ...applied },
      };
    }

    case AURA_EVENT.FactMissing: {
      const key = asString(p.key);
      if (!key || s.facts[key]?.state === 'confirmed') {
        return { stats: { ...s.stats, ...applied } };
      }
      const fact: FactEntry = {
        key,
        label: asString(p.label, key),
        value: '',
        confidence: 0,
        critical: asBool(p.critical),
        state: 'missing',
        seq,
      };
      return {
        facts: { ...s.facts, [key]: fact },
        factKeys: s.factKeys.includes(key) ? s.factKeys : [...s.factKeys, key],
        stats: { ...s.stats, ...applied },
      };
    }

    /* ---------------- location ---------------- */
    case AURA_EVENT.LocationCandidate:
    case AURA_EVENT.LocationVerified: {
      const coords = asVec2(p.coords);
      if (!coords) return { stats: { ...s.stats, ...applied } };
      const verified = evt.type === AURA_EVENT.LocationVerified;
      const callId = asString(p.call_id);
      const call = s.calls[callId];
      return {
        location: {
          address: asString(p.address),
          confidence: clamp01(asNumber(p.confidence)),
          coords,
          verified,
        },
        calls: call ? { ...s.calls, [callId]: { ...call, coords } } : s.calls,
        camera: { target: coords, nonce: s.camera.nonce + 1 },
        signals: verified
          ? { ...s.signals, locationLocked: s.signals.locationLocked + 1 }
          : s.signals,
        stats: { ...s.stats, ...applied },
      };
    }

    /* ---------------- incident ---------------- */
    case AURA_EVENT.IncidentClassified:
    case AURA_EVENT.IncidentReclassified: {
      const callId = asString(p.call_id);
      const category = asCategory(p.category);
      const priority = asPriority(p.priority);
      const previous =
        evt.type === AURA_EVENT.IncidentReclassified
          ? asPriority(p.previous_priority)
          : (s.incident?.priority ?? null);
      const becameCritical = priority === 'critical' && s.incident?.priority !== 'critical';
      const call = s.calls[callId];

      // Background calls colour their own card but never take over the active
      // incident panel. Only the focused call owns `incident`.
      const ownsIncident = callId === s.activeCallId || s.activeCallId === null;
      if (!ownsIncident) {
        return {
          calls: call ? { ...s.calls, [callId]: { ...call, category, priority } } : s.calls,
          stats: { ...s.stats, ...applied },
        };
      }

      return {
        incident: {
          id: asString(p.incident_id, s.incident?.id ?? 'incident'),
          callId,
          category,
          priority,
          previousPriority: previous,
          reason: asString(p.reason, s.incident?.reason ?? ''),
        },
        calls: call ? { ...s.calls, [callId]: { ...call, category, priority } } : s.calls,
        phase: becameCritical
          ? 'critical'
          : s.phase === 'incoming' || s.phase === 'idle'
            ? 'assessing'
            : s.phase,
        signals: becameCritical
          ? { ...s.signals, critical: s.signals.critical + 1 }
          : s.signals,
        stats: { ...s.stats, ...applied },
      };
    }

    /* ---------------- protocol ---------------- */
    case AURA_EVENT.ProtocolActivated: {
      const rawSteps = Array.isArray(p.steps) ? p.steps : [];
      const steps: ProtocolStepEntry[] = rawSteps.flatMap((raw) => {
        if (typeof raw !== 'object' || raw === null) return [];
        const o = raw as Record<string, unknown>;
        const id = asString(o.step_id);
        if (!id) return [];
        return [{ id, label: asString(o.label, id), status: 'idle' as ProtocolStepStatus, why: '' }];
      });
      return {
        protocol: {
          id: asString(p.protocol_id, 'protocol'),
          name: asString(p.name, 'Protocol'),
          why: asString(p.why),
          steps,
        },
        stats: { ...s.stats, ...applied },
      };
    }

    case AURA_EVENT.ProtocolStep: {
      if (!s.protocol) return { stats: { ...s.stats, ...applied } };
      const stepId = asString(p.step_id);
      const status = asString(p.status, 'active') as ProtocolStepStatus;
      const why = asString(p.why);
      const steps = s.protocol.steps.map((step) =>
        step.id === stepId ? { ...step, status, why: why || step.why } : step,
      );
      return {
        protocol: { ...s.protocol, steps, why: why || s.protocol.why },
        stats: { ...s.stats, ...applied },
      };
    }

    /* ---------------- tools ---------------- */
    case AURA_EVENT.ToolInvoked: {
      const id = asString(p.tool_call_id);
      if (!id) return { stats: { ...s.stats, ...applied } };
      const stage = asToolStage(p.stage);
      const entry: ToolEntry = {
        id,
        tool: asString(p.tool, 'tool'),
        label: asString(p.label, asString(p.tool, 'tool')),
        stage,
        status: 'pending',
        summary: '',
        seq,
      };
      const tools = [...s.tools, entry].slice(-TOOL_WINDOW);
      return {
        tools,
        stages: stage ? { ...s.stages, [stage]: 'active' } : s.stages,
        stats: { ...s.stats, ...applied },
      };
    }

    case AURA_EVENT.ToolResult: {
      const id = asString(p.tool_call_id);
      const idx = s.tools.findIndex((t) => t.id === id);
      if (idx < 0) return { stats: { ...s.stats, ...applied } };
      const status: ToolStatus = p.status === 'error' ? 'error' : 'ok';
      const tools = [...s.tools];
      const existing = tools[idx];
      tools[idx] = { ...existing, status, summary: asString(p.summary) };
      const stage = existing.stage;
      return {
        tools,
        stages: stage
          ? { ...s.stages, [stage]: status === 'error' ? 'error' : 'done' }
          : s.stages,
        stats: { ...s.stats, ...applied },
      };
    }

    /* ---------------- responders ---------------- */
    case AURA_EVENT.RespondersAvailable: {
      const raw = Array.isArray(p.units) ? p.units : [];
      const units: UnitEntry[] = raw.flatMap((item) => {
        if (typeof item !== 'object' || item === null) return [];
        const o = item as Record<string, unknown>;
        const coords = asVec2(o.coords);
        const id = asString(o.unit_id);
        if (!id || !coords) return [];
        return [
          {
            id,
            kind: asResponderKind(o.kind),
            label: asString(o.label, id),
            coords,
            etaS: asNumber(o.eta_s),
            distanceM: asNumber(o.distance_m),
            selected: s.route?.unitId === id,
          },
        ];
      });
      return { units, stats: { ...s.stats, ...applied } };
    }

    case AURA_EVENT.RouteProposed: {
      const path = asVec2Array(p.path);
      const unitId = asString(p.unit_id);
      if (path.length < 2) return { stats: { ...s.stats, ...applied } };
      return {
        route: {
          id: asString(p.route_id, 'route'),
          unitId,
          path,
          etaS: asNumber(p.eta_s),
          distanceM: asNumber(p.distance_m),
        },
        units: s.units.map((u) => ({ ...u, selected: u.id === unitId })),
        // A proposal draws the line. It does NOT move anything.
        dispatch: s.dispatch === 'none' ? 'proposed' : s.dispatch,
        stats: { ...s.stats, ...applied },
      };
    }

    /* ---------------- approval ---------------- */
    case AURA_EVENT.ApprovalRequested: {
      const id = asString(p.approval_id);
      if (!id) return { stats: { ...s.stats, ...applied } };
      return {
        approval: {
          id,
          summary: asString(p.summary),
          routeId: asString(p.route_id),
          unitId: asString(p.unit_id),
          expiresInS: asNumber(p.expires_in_s, 0),
          state: 'pending',
          by: '',
          reason: '',
        },
        phase: 'awaiting_approval',
        stages: { ...s.stages, human_approval: 'active' },
        signals: { ...s.signals, approvalOpen: s.signals.approvalOpen + 1 },
        stats: { ...s.stats, ...applied },
      };
    }

    case AURA_EVENT.ApprovalGranted: {
      if (!s.approval || s.approval.state !== 'pending') {
        return { stats: { ...s.stats, ...applied } };
      }
      return {
        approval: { ...s.approval, state: 'granted', by: asString(p.by, 'operator') },
        dispatch: 'approved',
        stages: { ...s.stages, human_approval: 'done' },
        signals: { ...s.signals, approved: s.signals.approved + 1 },
        stats: { ...s.stats, ...applied },
      };
    }

    case AURA_EVENT.ApprovalRejected: {
      if (!s.approval || s.approval.state !== 'pending') {
        return { stats: { ...s.stats, ...applied } };
      }
      return {
        approval: {
          ...s.approval,
          state: 'rejected',
          by: asString(p.by, 'operator'),
          reason: asString(p.reason),
        },
        dispatch: 'rejected',
        stages: { ...s.stages, human_approval: 'blocked' },
        signals: { ...s.signals, rejected: s.signals.rejected + 1 },
        stats: { ...s.stats, ...applied },
      };
    }

    /* ---------------- dispatch ---------------- */
    case AURA_EVENT.DispatchStarted: {
      // Hard gate: nothing moves without a granted approval, whatever the backend says.
      if (s.approval?.state !== 'granted') {
        return { stats: { ...s.stats, ...applied, unknown: s.stats.unknown } };
      }
      return {
        dispatch: 'enroute',
        dispatchProgress: 0,
        phase: 'dispatched',
        stats: { ...s.stats, ...applied },
      };
    }

    case AURA_EVENT.DispatchProgress: {
      if (s.dispatch !== 'enroute' && s.dispatch !== 'approved') {
        return { stats: { ...s.stats, ...applied } };
      }
      const next = clamp01(asNumber(p.progress));
      return {
        dispatch: 'enroute',
        // Monotonic: progress never rewinds.
        dispatchProgress: Math.max(s.dispatchProgress, next),
        stats: { ...s.stats, ...applied },
      };
    }

    case AURA_EVENT.DispatchArrived: {
      if (s.dispatch !== 'enroute' && s.dispatch !== 'approved') {
        return { stats: { ...s.stats, ...applied } };
      }
      return {
        dispatch: 'arrived',
        dispatchProgress: 1,
        stats: { ...s.stats, ...applied },
      };
    }

    /* ---------------- unknown ---------------- */
    default:
      return {
        stats: { ...s.stats, unknown: s.stats.unknown + 1, lastType: evt.type },
      };
  }
}

/* ------------------------------------------------------------------ */
/* Selectors                                                           */
/* ------------------------------------------------------------------ */

/**
 * Call ids ordered for the left stack: highest priority first, then oldest first.
 * Ended calls sink to the bottom. Stable so reordering animates rather than jumps.
 */
export function useOrderedCallIds(): string[] {
  return useAuraStore(
    useShallow((s) => {
      const ids = [...s.callIds];
      ids.sort((a, b) => {
        const ca = s.calls[a];
        const cb = s.calls[b];
        if (!ca || !cb) return 0;
        if (ca.status !== cb.status) return ca.status === 'ended' ? 1 : -1;
        const rank = priorityRank(cb.priority) - priorityRank(ca.priority);
        if (rank !== 0) return rank;
        return ca.startedAtMs - cb.startedAtMs;
      });
      return ids;
    }),
  );
}

export function useActiveCall(): CallEntry | null {
  return useAuraStore((s) => (s.activeCallId ? s.calls[s.activeCallId] ?? null : null));
}

export function useConfirmedFacts(): FactEntry[] {
  return useAuraStore(
    useShallow((s) => s.factKeys.map((k) => s.facts[k]).filter(Boolean)),
  );
}

/** True when a responder is allowed to be shown moving. The single source of truth. */
export function useResponderMayMove(): boolean {
  return useAuraStore(
    (s) => s.dispatch === 'approved' || s.dispatch === 'enroute' || s.dispatch === 'arrived',
  );
}

/** True when the proposed route should be drawn (proposal is not dispatch). */
export function useRouteVisible(): boolean {
  return useAuraStore((s) => s.route !== null && s.dispatch !== 'rejected');
}

export function getIngestDebug() {
  return {
    lastSequence: ingest.lastSequence,
    buffered: ingest.buffer.size,
    seen: ingest.seen.size,
  };
}
