import { create } from "zustand";
import {
  PRIORITY_RANK,
  type AnalysisMeta,
  type ApprovalRequestedPayload,
  type ApprovalResolvedPayload,
  type CallStartedPayload,
  type DispatchProposedPayload,
  type EventType,
  type IncidentState,
  type Speaker,
  type SystemDegradedPayload,
  type TypedEvent,
} from "../contracts/index.ts";
import type { ConnectionStatus } from "../lib/transport.ts";
import { clearLevels, pushLevel } from "./audioLevels.ts";

export interface TranscriptItem {
  id: string;
  speaker: Speaker;
  text: string;
  confidence: number;
  interrupted: boolean;
  analysisConfidence: number | null;
  at: number;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: "running" | "done" | "failed";
  summary: string | null;
  durationMs: number | null;
  at: number;
}

export interface ProtocolChange {
  id: string;
  protocolId: string;
  from: string | null;
  to: string;
  reason: string;
  escalation: boolean;
  at: number;
}

export interface AnalysisInfo {
  utteranceId: string;
  confidence: number;
  explanation: string;
  nextResponse: string;
  meta: AnalysisMeta;
  degraded: boolean;
  at: number;
}

export interface AgentView {
  active: boolean;
  text: string | null;
  utteranceId: string | null;
  startedAt: number;
  estimatedMs: number;
}

export interface SessionView {
  id: string;
  kind: "focus" | "ambient";
  caller: CallStartedPayload | null;
  startedAt: number | null;
  state: IncidentState | null;
  transcript: TranscriptItem[];
  partial: { text: string; speaker: Speaker; utteranceId: string; confidence: number } | null;
  agent: AgentView;
  tools: ToolCall[];
  protocolChanges: ProtocolChange[];
  analysis: AnalysisInfo | null;
  analyzing: boolean;
  dispatch: DispatchProposedPayload | null;
  dispatchProposedAt: number | null;
  approval: { payload: ApprovalRequestedPayload; requestedAt: number; resolved: ApprovalResolvedPayload | null; resolvedAt: number | null } | null;
  degraded: SystemDegradedPayload | null;
  escalatedAt: number | null;
  dispatchedAt: number | null;
  lastSequence: number;
  eventCount: number;
}

export type CueBody =
  | { kind: "call_started"; sessionId: string; ambient: boolean }
  | { kind: "caller_speech_start"; sessionId: string; utteranceId: string; text: string }
  | { kind: "speak"; sessionId: string; speaker: Speaker; text: string; utteranceId: string; estimatedMs: number }
  | { kind: "interrupt"; sessionId: string; utteranceId: string }
  | { kind: "located"; sessionId: string; latitude: number; longitude: number }
  | { kind: "escalation"; sessionId: string }
  | { kind: "protocol_step"; sessionId: string; escalation: boolean }
  | { kind: "tool_done"; sessionId: string; failed: boolean }
  | { kind: "dispatch_proposed"; sessionId: string }
  | { kind: "approval_requested"; sessionId: string }
  | { kind: "approved"; sessionId: string }
  | { kind: "rejected"; sessionId: string }
  | { kind: "dispatched"; sessionId: string }
  | { kind: "degraded"; active: boolean }
  | { kind: "reset" };

export type Cue = CueBody & { id: number };

export interface TickerItem {
  id: string;
  type: EventType;
  sessionId: string;
  at: number;
}

export interface Settings {
  ttsAura: boolean;
  ttsCaller: boolean;
  sfx: boolean;
  reviewer: string;
  mode: "auto" | "manual";
  pace: number;
  follow: boolean;
}

export interface UiState {
  consoleOpen: boolean;
  demoStarted: boolean;
  demoSessionId: string | null;
  starting: boolean;
  error: string | null;
}

export interface AuraStore {
  sessions: Record<string, SessionView>;
  order: string[];
  focusId: string | null;
  connection: ConnectionStatus;
  cues: Cue[];
  cueSeq: number;
  ticker: TickerItem[];
  degraded: SystemDegradedPayload | null;
  settings: Settings;
  ui: UiState;
  applyEvents(events: TypedEvent[]): void;
  setConnection(status: ConnectionStatus): void;
  focus(id: string | null): void;
  resetAll(): void;
  updateSettings(patch: Partial<Settings>): void;
  setUi(patch: Partial<UiState>): void;
}

function emptySession(id: string): SessionView {
  return {
    id,
    kind: "focus",
    caller: null,
    startedAt: null,
    state: null,
    transcript: [],
    partial: null,
    agent: { active: false, text: null, utteranceId: null, startedAt: 0, estimatedMs: 0 },
    tools: [],
    protocolChanges: [],
    analysis: null,
    analyzing: false,
    dispatch: null,
    dispatchProposedAt: null,
    approval: null,
    degraded: null,
    escalatedAt: null,
    dispatchedAt: null,
    lastSequence: 0,
    eventCount: 0,
  };
}

const DEFAULT_SETTINGS: Settings = {
  ttsAura: true,
  ttsCaller: true,
  sfx: true,
  reviewer: "dispatcher_1",
  mode: "auto",
  pace: 1,
  follow: true,
};

const DEFAULT_UI: UiState = { consoleOpen: false, demoStarted: false, demoSessionId: null, starting: false, error: null };

const cap = <T>(items: T[], max: number): T[] => (items.length > max ? items.slice(items.length - max) : items);

export const useAuraStore = create<AuraStore>((set) => ({
  sessions: {},
  order: [],
  focusId: null,
  connection: "connecting",
  cues: [],
  cueSeq: 0,
  ticker: [],
  degraded: null,
  settings: DEFAULT_SETTINGS,
  ui: DEFAULT_UI,

  applyEvents: (events) =>
    set((prev) => {
      const now = Date.now();
      let sessions = prev.sessions;
      let order = prev.order;
      let focusId = prev.focusId;
      let ticker = prev.ticker;
      let degraded = prev.degraded;
      let cueSeq = prev.cueSeq;
      const cues: Cue[] = [...prev.cues];
      let didReset = false;
      const push = (cue: CueBody) => {
        cueSeq += 1;
        cues.push({ ...cue, id: cueSeq });
      };

      for (const ev of events) {
        if (ev.type === "system.reset") {
          sessions = {};
          order = [];
          focusId = null;
          ticker = [];
          degraded = null;
          didReset = true;
          clearLevels();
          push({ kind: "reset" });
          continue;
        }
        if (ev.type === "audio.level") {
          pushLevel(ev.session_id, ev.payload.speaker, ev.payload.level);
          continue;
        }

        const id = ev.session_id;
        const existing = sessions[id];
        if (existing && ev.sequence <= existing.lastSequence) continue; // replayed
        const s: SessionView = existing ? { ...existing } : emptySession(id);
        if (!existing) order = [...order, id];
        s.lastSequence = ev.sequence;
        s.eventCount += 1;

        switch (ev.type) {
          case "call.started": {
            s.caller = ev.payload;
            s.kind = ev.payload.kind;
            s.startedAt = Date.parse(ev.timestamp) || now;
            if (ev.payload.kind === "focus" && (focusId === null || sessions[focusId]?.kind === "ambient")) focusId = id;
            push({ kind: "call_started", sessionId: id, ambient: ev.payload.kind === "ambient" });
            break;
          }
          case "transcript.partial": {
            const first = !s.partial || s.partial.utteranceId !== ev.payload.utterance_id;
            s.partial = {
              text: ev.payload.text,
              speaker: ev.payload.speaker,
              utteranceId: ev.payload.utterance_id,
              confidence: ev.payload.confidence,
            };
            if (first) push({ kind: "caller_speech_start", sessionId: id, utteranceId: ev.payload.utterance_id, text: ev.payload.text });
            break;
          }
          case "transcript.final": {
            if (s.partial?.utteranceId === ev.payload.utterance_id) s.partial = null;
            if (!s.transcript.some((t) => t.id === ev.payload.utterance_id)) {
              s.transcript = cap(
                [
                  ...s.transcript,
                  {
                    id: ev.payload.utterance_id,
                    speaker: ev.payload.speaker,
                    text: ev.payload.text,
                    confidence: ev.payload.confidence,
                    interrupted: false,
                    analysisConfidence: null,
                    at: now,
                  },
                ],
                200,
              );
            }
            if (ev.payload.speaker === "caller") {
              push({ kind: "speak", sessionId: id, speaker: "caller", text: ev.payload.text, utteranceId: ev.payload.utterance_id, estimatedMs: 0 });
            }
            break;
          }
          case "agent.speaking": {
            if (ev.payload.active) {
              s.agent = {
                active: true,
                text: ev.payload.text,
                utteranceId: ev.payload.utterance_id,
                startedAt: now,
                estimatedMs: ev.payload.estimated_duration_ms ?? 0,
              };
              if (!s.transcript.some((t) => t.id === ev.payload.utterance_id)) {
                s.transcript = cap(
                  [
                    ...s.transcript,
                    {
                      id: ev.payload.utterance_id,
                      speaker: "agent",
                      text: ev.payload.text,
                      confidence: 1,
                      interrupted: false,
                      analysisConfidence: null,
                      at: now,
                    },
                  ],
                  200,
                );
              }
              push({
                kind: "speak",
                sessionId: id,
                speaker: "agent",
                text: ev.payload.text,
                utteranceId: ev.payload.utterance_id,
                estimatedMs: ev.payload.estimated_duration_ms ?? 0,
              });
            } else if (s.agent.utteranceId === ev.payload.utterance_id) {
              s.agent = { ...s.agent, active: false };
            }
            break;
          }
          case "agent.interrupted": {
            s.transcript = s.transcript.map((t) => (t.id === ev.payload.utterance_id ? { ...t, interrupted: true } : t));
            if (s.agent.utteranceId === ev.payload.utterance_id) s.agent = { ...s.agent, active: false };
            push({ kind: "interrupt", sessionId: id, utteranceId: ev.payload.utterance_id });
            break;
          }
          case "incident.updated": {
            const before = s.state;
            const after = ev.payload;
            s.state = after;
            if (
              after.location.verified &&
              after.location.latitude !== null &&
              after.location.longitude !== null &&
              (!before || !before.location.verified)
            ) {
              push({ kind: "located", sessionId: id, latitude: after.location.latitude, longitude: after.location.longitude });
            }
            if (before && after.priority === "critical" && PRIORITY_RANK[before.priority] < PRIORITY_RANK.critical) {
              s.escalatedAt = now;
              push({ kind: "escalation", sessionId: id });
            }
            if (after.status === "dispatched" && before?.status !== "dispatched") {
              s.dispatchedAt = now;
              push({ kind: "dispatched", sessionId: id });
            }
            break;
          }
          case "protocol.changed": {
            s.protocolChanges = cap(
              [
                ...s.protocolChanges,
                {
                  id: ev.event_id,
                  protocolId: ev.payload.protocol_id,
                  from: ev.payload.previous_step,
                  to: ev.payload.current_step,
                  reason: ev.payload.reason,
                  escalation: ev.payload.escalation,
                  at: now,
                },
              ],
              50,
            );
            push({ kind: "protocol_step", sessionId: id, escalation: ev.payload.escalation });
            break;
          }
          case "tool.started": {
            s.tools = cap(
              [...s.tools, { id: ev.event_id, name: ev.payload.tool, args: ev.payload.arguments, status: "running", summary: null, durationMs: null, at: now }],
              100,
            );
            break;
          }
          case "tool.completed": {
            const failed = ev.payload.result_summary.startsWith("failed");
            let matched = false;
            s.tools = s.tools.map((t) => {
              if (!matched && t.status === "running" && t.name === ev.payload.tool) {
                matched = true;
                return { ...t, status: failed ? "failed" : "done", summary: ev.payload.result_summary, durationMs: ev.payload.duration_ms };
              }
              return t;
            });
            if (!matched) {
              s.tools = cap(
                [
                  ...s.tools,
                  {
                    id: ev.event_id,
                    name: ev.payload.tool,
                    args: {},
                    status: failed ? "failed" : "done",
                    summary: ev.payload.result_summary,
                    durationMs: ev.payload.duration_ms,
                    at: now,
                  },
                ],
                100,
              );
            }
            push({ kind: "tool_done", sessionId: id, failed });
            break;
          }
          case "dispatch.proposed": {
            s.dispatch = ev.payload;
            s.dispatchProposedAt = now;
            push({ kind: "dispatch_proposed", sessionId: id });
            break;
          }
          case "approval.requested": {
            s.approval = { payload: ev.payload, requestedAt: now, resolved: null, resolvedAt: null };
            push({ kind: "approval_requested", sessionId: id });
            break;
          }
          case "approval.resolved": {
            if (s.approval) s.approval = { ...s.approval, resolved: ev.payload, resolvedAt: now };
            push({ kind: ev.payload.approved ? "approved" : "rejected", sessionId: id });
            break;
          }
          case "system.degraded": {
            s.degraded = ev.payload.active ? ev.payload : null;
            if (ev.payload.active) degraded = ev.payload;
            else if (degraded && degraded.failed_dependency === ev.payload.failed_dependency) degraded = null;
            push({ kind: "degraded", active: ev.payload.active });
            break;
          }
          case "analysis.started": {
            s.analyzing = true;
            break;
          }
          case "analysis.completed": {
            s.analyzing = false;
            s.analysis = {
              utteranceId: ev.payload.utterance_id,
              confidence: ev.payload.confidence,
              explanation: ev.payload.explanation,
              nextResponse: ev.payload.next_response,
              meta: ev.payload.meta,
              degraded: ev.payload.degraded,
              at: now,
            };
            s.transcript = s.transcript.map((t) => (t.id === ev.payload.utterance_id ? { ...t, analysisConfidence: ev.payload.confidence } : t));
            break;
          }
          default:
            break;
        }

        sessions = { ...sessions, [id]: s };
        ticker = cap([...ticker, { id: ev.event_id, type: ev.type, sessionId: id, at: now }], 40);
      }

      // Only real (non-ambient) calls take focus automatically; ambient ones are clickable.
      if (focusId === null || !sessions[focusId]) {
        focusId = order.find((id) => sessions[id]?.kind === "focus") ?? null;
      }

      return {
        sessions,
        order,
        focusId,
        ticker,
        degraded,
        cues: cap(cues, 80),
        cueSeq,
        ...(didReset ? { ui: { ...prev.ui, demoStarted: false, demoSessionId: null, starting: false } } : {}),
      };
    }),

  setConnection: (connection) => set({ connection }),
  focus: (focusId) => set({ focusId }),
  resetAll: () =>
    set((prev) => {
      clearLevels();
      return {
        sessions: {},
        order: [],
        focusId: null,
        ticker: [],
        degraded: null,
        cues: [...prev.cues, { id: prev.cueSeq + 1, kind: "reset" }],
        cueSeq: prev.cueSeq + 1,
        ui: { ...prev.ui, demoStarted: false, demoSessionId: null, starting: false },
      };
    }),
  updateSettings: (patch) => set((prev) => ({ settings: { ...prev.settings, ...patch } })),
  setUi: (patch) => set((prev) => ({ ui: { ...prev.ui, ...patch } })),
}));

export const selectFocus = (state: AuraStore): SessionView | null => (state.focusId ? (state.sessions[state.focusId] ?? null) : null);
export const selectFocusState = (state: AuraStore): IncidentState | null => selectFocus(state)?.state ?? null;
export const selectSessionList = (state: AuraStore): SessionView[] => state.order.map((id) => state.sessions[id]).filter((s): s is SessionView => Boolean(s));
