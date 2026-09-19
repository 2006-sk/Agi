"use client";

// Single source of truth for the HUD and the city. Visual components only ever read from here —
// they never know whether events came from the mock player or the live gateway WebSocket.
import { create } from "zustand";
import {
  field,
  normalizeCategory,
  normalizePriority,
  parseIncident,
  parseRoute,
  parseUnits,
  stageOf,
  type AuraEvent,
  type Category,
  type IncidentState,
  type PipelineStage,
  type Priority,
  type ResponderUnit,
  type RoutePlan,
  type Speaker,
} from "@/lib/contracts";

const { str, num, obj } = field;

export type TranscriptLine = {
  id: string;
  speaker: Speaker;
  text: string;
  final: boolean;
  confidence: number | null;
  at: number; // client receipt time, ms epoch
  interrupted: boolean; // an AURA line the caller cut off (barge-in)
};

export type ToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: "running" | "done";
  result: string | null;
  startedAt: number;
  completedAt: number | null;
};

export type ProtocolChange = { previous: string | null; current: string; reason: string | null; at: number };

export type Dispatch = {
  services: string[];
  units: ResponderUnit[];
  route: RoutePlan | null;
  reason: string | null;
  at: number;
};

export type Approval = {
  status: "idle" | "requested" | "approved" | "rejected";
  action: string | null;
  risk: string | null;
  timeoutS: number | null;
  requestedAt: number | null;
  resolvedAt: number | null;
  reviewer: string | null;
};

export type CallState = {
  sessionId: string;
  callerLabel: string;
  language: string;
  channel: string;
  /** Scenario background call: shown in the stack and on the map, never the active call. */
  ambient: boolean;
  handledBy: string | null; // e.g. "Human dispatcher" for ambient calls
  status: "active" | "ended";
  startedAt: number;
  category: Category;
  priority: Priority;
  priorityChangedAt: number;
  incident: IncidentState | null;
  transcript: TranscriptLine[];
  agentSpeaking: boolean;
  lastInterruption: { text: string | null; reason: string | null; at: number } | null;
  protocolHistory: ProtocolChange[];
  tools: ToolCall[];
  dispatch: Dispatch | null;
  approval: Approval;
};

export type Connection = "idle" | "mock" | "connecting" | "live" | "reconnecting" | "offline";

export type Escalation = { sessionId: string; from: Priority; to: Priority; at: number };

type AuraState = {
  calls: Record<string, CallState>;
  activeSessionId: string | null;
  connection: Connection;
  degraded: { dependency: string | null; fallback: string | null; at: number } | null;
  /** Set once each time a call is re-classified as critical — drives the single red shockwave. */
  escalation: Escalation | null;
  /** Last time each sponsor-backed stage produced an event (ms epoch). */
  pipeline: Record<PipelineStage, number>;
  /** "high" = full bloom/particles, "low" = reduced effects (perf fallback or reduced motion). */
  quality: "high" | "low";
  apply: (ev: AuraEvent) => void;
  setActive: (sessionId: string) => void;
  setConnection: (c: Connection) => void;
  setQuality: (q: "high" | "low") => void;
  reset: () => void;
};

const idleApproval: Approval = {
  status: "idle",
  action: null,
  risk: null,
  timeoutS: null,
  requestedAt: null,
  resolvedAt: null,
  reviewer: null,
};

const newCall = (sessionId: string, now: number): CallState => ({
  sessionId,
  callerLabel: "Caller",
  language: "en",
  channel: "Overflow line",
  ambient: false,
  handledBy: null,
  status: "active",
  startedAt: now,
  category: "unknown",
  priority: "pending",
  priorityChangedAt: now,
  incident: null,
  transcript: [],
  agentSpeaking: false,
  lastInterruption: null,
  protocolHistory: [],
  tools: [],
  dispatch: null,
  approval: idleApproval,
});

const speakerOf = (v: unknown): Speaker => {
  const s = String(v ?? "").toLowerCase();
  return ["agent", "aura", "assistant", "bot", "ai"].includes(s) ? "agent" : "caller";
};

const MAX_LINES = 80;

/** Replace the speaker's open (non-final) line, or append a new one. */
const upsertOpenLine = (lines: TranscriptLine[], line: TranscriptLine): TranscriptLine[] => {
  const i = lines.findLastIndex((l) => l.speaker === line.speaker && !l.final);
  if (i === -1) return [...lines, line].slice(-MAX_LINES);
  const next = lines.slice();
  next[i] = { ...line, id: lines[i].id, at: lines[i].at };
  return next;
};

const closeOpenLine = (
  lines: TranscriptLine[],
  speaker: Speaker,
  patch: Partial<TranscriptLine> = {},
): TranscriptLine[] => {
  const i = lines.findLastIndex((l) => l.speaker === speaker && !l.final);
  if (i === -1) return lines;
  const next = lines.slice();
  next[i] = { ...lines[i], ...patch, final: true };
  return next;
};

const reduceCall = (call: CallState, ev: AuraEvent, now: number): CallState => {
  const p = obj(ev.payload);
  switch (ev.type) {
    case "call.started":
      return {
        ...call,
        callerLabel: str(p.caller_label) ?? str(p.caller) ?? call.callerLabel,
        language: str(p.language) ?? call.language,
        channel: str(p.channel) ?? call.channel,
        ambient: p.ambient === true,
        handledBy: str(p.handled_by),
        // ambient scenario calls were already in progress when the console opened
        startedAt: now - (num(p.elapsed_seconds) ?? 0) * 1000,
        status: "active",
      };

    case "call.ended":
      return { ...call, status: "ended", agentSpeaking: false };

    case "transcript.partial": {
      const text = str(p.text);
      if (!text) return call;
      const speaker = speakerOf(p.speaker);
      return {
        ...call,
        transcript: upsertOpenLine(call.transcript, {
          id: ev.event_id,
          speaker,
          text,
          final: false,
          confidence: num(p.confidence),
          at: now,
          interrupted: false,
        }),
      };
    }

    case "transcript.final": {
      const text = str(p.text);
      if (!text) return call;
      const speaker = speakerOf(p.speaker);
      const hasOpen = call.transcript.some((l) => l.speaker === speaker && !l.final);
      if (hasOpen) {
        return { ...call, transcript: closeOpenLine(call.transcript, speaker, { text, confidence: num(p.confidence) }) };
      }
      // The voice service may send a final for a line we already closed via agent.speaking{active:false}.
      const last = call.transcript.findLast((l) => l.speaker === speaker);
      if (last && last.text === text) return call;
      return {
        ...call,
        transcript: [
          ...call.transcript,
          { id: ev.event_id, speaker, text, final: true, confidence: num(p.confidence), at: now, interrupted: false },
        ].slice(-MAX_LINES),
      };
    }

    case "agent.speaking": {
      const active = p.active !== false;
      const text = str(p.text);
      if (active) {
        return {
          ...call,
          agentSpeaking: true,
          transcript: text
            ? upsertOpenLine(call.transcript, {
                id: ev.event_id,
                speaker: "agent",
                text,
                final: false,
                confidence: null,
                at: now,
                interrupted: false,
              })
            : call.transcript,
        };
      }
      return { ...call, agentSpeaking: false, transcript: closeOpenLine(call.transcript, "agent") };
    }

    case "agent.interrupted": {
      const text = str(p.interrupted_text) ?? str(p.text);
      return {
        ...call,
        agentSpeaking: false,
        lastInterruption: { text, reason: str(p.reason), at: now },
        transcript: closeOpenLine(call.transcript, "agent", { interrupted: true, ...(text ? { text } : {}) }),
      };
    }

    case "incident.updated": {
      const incident = parseIncident(ev.payload, call.sessionId);
      const changed = incident.priority !== call.priority;
      const prevProto = call.incident?.protocol ?? null;
      const nextProto = incident.protocol;
      return {
        ...call,
        incident,
        category: incident.category === "unknown" ? call.category : incident.category,
        priority: incident.priority,
        priorityChangedAt: changed ? now : call.priorityChangedAt,
        // If the backend never sends protocol.changed, still keep a history from incident snapshots.
        protocolHistory:
          nextProto && (!prevProto || prevProto.id !== nextProto.id || prevProto.step !== nextProto.step)
            ? pushProtocol(call.protocolHistory, {
                previous: prevProto ? `${prevProto.id}/${prevProto.step}` : null,
                current: `${nextProto.id}/${nextProto.step}`,
                reason: null,
                at: now,
              })
            : call.protocolHistory,
      };
    }

    case "protocol.changed": {
      const current = str(p.current_step) ?? str(p.current);
      if (!current) return call;
      const protoId = str(p.protocol_id);
      const full = protoId && !current.includes("/") ? `${protoId}/${current}` : current;
      return {
        ...call,
        protocolHistory: pushProtocol(call.protocolHistory, {
          previous: str(p.previous_step) ?? str(p.previous),
          current: full,
          reason: str(p.reason),
          at: now,
        }),
      };
    }

    case "tool.started": {
      const name = str(p.tool_name) ?? str(p.name) ?? str(p.tool) ?? "tool";
      const id = str(p.tool_call_id) ?? ev.event_id;
      const args = obj(p.safe_arguments ?? p.arguments ?? p.args);
      return {
        ...call,
        tools: [...call.tools, { id, name, args, status: "running" as const, result: null, startedAt: now, completedAt: null }].slice(-24),
      };
    }

    case "tool.completed": {
      const name = str(p.tool_name) ?? str(p.name) ?? str(p.tool) ?? "tool";
      const id = str(p.tool_call_id);
      const result = str(p.result_summary) ?? str(p.result) ?? str(p.summary);
      const i = call.tools.findLastIndex((t) => t.status === "running" && (id ? t.id === id : t.name === name));
      if (i === -1) {
        return {
          ...call,
          tools: [...call.tools, { id: id ?? ev.event_id, name, args: {}, status: "done" as const, result, startedAt: now, completedAt: now }].slice(-24),
        };
      }
      const tools = call.tools.slice();
      tools[i] = { ...tools[i], status: "done", result, completedAt: now };
      return { ...call, tools };
    }

    case "dispatch.proposed":
      return {
        ...call,
        dispatch: {
          services: field.arr(p.services),
          units: parseUnits(p.units),
          route: parseRoute(p.route),
          reason: str(p.reason),
          at: now,
        },
      };

    case "approval.requested":
      return {
        ...call,
        approval: {
          status: "requested",
          action: str(p.action),
          risk: str(p.risk),
          timeoutS: num(p.timeout_seconds) ?? num(p.timeout),
          requestedAt: now,
          resolvedAt: null,
          reviewer: null,
        },
      };

    case "approval.resolved":
      return {
        ...call,
        approval: {
          ...call.approval,
          status: p.approved === true ? "approved" : "rejected",
          resolvedAt: now,
          reviewer: str(p.reviewer),
        },
      };

    default:
      return call; // unknown events are tolerated, never fatal
  }
};

const pushProtocol = (history: ProtocolChange[], change: ProtocolChange): ProtocolChange[] => {
  const last = history[history.length - 1];
  if (last && last.current === change.current) {
    // protocol.changed usually follows the incident snapshot: keep one entry, but adopt its reason.
    if (change.reason && !last.reason) return [...history.slice(0, -1), { ...last, reason: change.reason, previous: change.previous ?? last.previous }];
    return history;
  }
  return [...history, change].slice(-12);
};

const initial = {
  calls: {} as Record<string, CallState>,
  activeSessionId: null as string | null,
  connection: "idle" as Connection,
  degraded: null as AuraState["degraded"],
  escalation: null as Escalation | null,
  pipeline: { gradium: 0, pipecat: 0, sambanova: 0, gateway: 0 } as Record<PipelineStage, number>,
};

export const useAura = create<AuraState>((set) => ({
  ...initial,
  quality: "high",

  apply: (ev) =>
    set((state) => {
      const now = Date.now();
      const stage = stageOf(ev.type);
      const pipeline = stage ? { ...state.pipeline, [stage]: now } : state.pipeline;

      if (ev.type === "system.degraded") {
        const p = obj(ev.payload);
        const recovered = p.recovered === true;
        return {
          pipeline,
          degraded: recovered
            ? null
            : {
                dependency: str(p.failed_dependency) ?? str(p.dependency),
                fallback: str(p.fallback_mode) ?? str(p.fallback),
                at: now,
              },
        };
      }

      const existing = state.calls[ev.session_id];
      const before = existing ?? newCall(ev.session_id, now);
      const after = reduceCall(before, ev, now);
      if (after === before && existing) return { pipeline };

      const escalated = after.priority === "critical" && before.priority !== "critical" && !after.ambient;
      const activeSessionId = state.activeSessionId ?? (after.ambient ? null : after.sessionId);

      return {
        pipeline,
        calls: { ...state.calls, [ev.session_id]: after },
        activeSessionId,
        escalation: escalated
          ? { sessionId: after.sessionId, from: before.priority, to: after.priority, at: now }
          : state.escalation,
      };
    }),

  setActive: (sessionId) => set((s) => (s.calls[sessionId] ? { activeSessionId: sessionId } : {})),
  setConnection: (connection) => set({ connection }),
  setQuality: (quality) => set({ quality }),
  reset: () => set({ ...initial, pipeline: { ...initial.pipeline } }),
}));

// re-export for convenience
export { normalizeCategory, normalizePriority };
