"use client";

import { useMemo } from "react";
import { priorityRank } from "@/lib/palette";
import { useAura, type CallState } from "./auraStore";

export const useActiveCall = (): CallState | null =>
  useAura((s) => (s.activeSessionId ? (s.calls[s.activeSessionId] ?? null) : null));

/** Calls ordered for the stack: highest priority first, then oldest first. */
export const useSortedCalls = (): CallState[] => {
  const calls = useAura((s) => s.calls);
  return useMemo(
    () =>
      Object.values(calls).sort(
        (a, b) => priorityRank[a.priority] - priorityRank[b.priority] || a.startedAt - b.startedAt,
      ),
    [calls],
  );
};

// ---------- action rail ----------
export type RailStageId = "locate" | "classify" | "verify" | "prepare" | "approval";
export type RailStageStatus = "idle" | "active" | "done" | "rejected";

export const RAIL_ORDER: RailStageId[] = ["locate", "classify", "verify", "prepare", "approval"];

export const stageOfTool = (toolName: string): RailStageId => {
  const n = toolName.toLowerCase();
  if (/(locat|geocod|address|map)/.test(n)) return "locate";
  if (/(classif|triage|categor|priorit)/.test(n)) return "classify";
  if (/(verif|confirm|fact|validate|protocol)/.test(n)) return "verify";
  return "prepare"; // units, routing, dispatch preparation
};

export const railLabels = (call: CallState | null): Record<RailStageId, string> => {
  const service = call?.dispatch?.services[0] ?? call?.incident?.recommended_services[0] ?? "EMS";
  return {
    locate: "Locate",
    classify: "Classify",
    verify: "Verify",
    prepare: `Prepare ${service}`,
    approval: "Human approval",
  };
};

export const railStatus = (call: CallState | null): Record<RailStageId, RailStageStatus> => {
  const out: Record<RailStageId, RailStageStatus> = {
    locate: "idle",
    classify: "idle",
    verify: "idle",
    prepare: "idle",
    approval: "idle",
  };
  if (!call) return out;
  const running = new Set(call.tools.filter((t) => t.status === "running").map((t) => stageOfTool(t.name)));
  const finished = new Set(call.tools.filter((t) => t.status === "done").map((t) => stageOfTool(t.name)));
  const inc = call.incident;

  if (inc?.location.verified) out.locate = "done";
  else if (running.has("locate") || inc?.location.raw) out.locate = "active";

  if (inc && inc.category !== "unknown" && inc.priority !== "pending") out.classify = "done";
  else if (running.has("classify")) out.classify = "active";

  if (running.has("verify")) out.verify = "active";
  else if (finished.has("verify") || (out.classify === "done" && inc && inc.missing_fields.length === 0)) out.verify = "done";

  if (call.dispatch) out.prepare = "done";
  else if (running.has("prepare")) out.prepare = "active";

  if (call.approval.status === "requested") out.approval = "active";
  else if (call.approval.status === "approved") out.approval = "done";
  else if (call.approval.status === "rejected") out.approval = "rejected";

  return out;
};

// ---------- scene ----------
export type ScenePhase = "idle" | "intake" | "located" | "critical" | "awaiting_approval" | "dispatched" | "rejected";

export const scenePhase = (call: CallState | null): ScenePhase => {
  if (!call) return "idle";
  if (call.approval.status === "approved") return "dispatched";
  if (call.approval.status === "rejected") return "rejected";
  if (call.approval.status === "requested") return "awaiting_approval";
  if (call.priority === "critical") return "critical";
  if (call.incident?.location.verified) return "located";
  return "intake";
};

/** What AURA is doing right now — drives cyan (listening) vs violet (reasoning) accents. */
export type AgentMode = "idle" | "listening" | "speaking" | "reasoning";
export const agentMode = (call: CallState | null): AgentMode => {
  if (!call || call.status === "ended") return "idle";
  if (call.tools.some((t) => t.status === "running")) return "reasoning";
  if (call.agentSpeaking) return "speaking";
  return "listening";
};

// ---------- formatting ----------
export const humanize = (s: string): string => {
  const t = s.replace(/[_-]+/g, " ").trim().toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

export const clock = (ms: number): string => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

export const elapsed = (fromMs: number, nowMs: number): string => {
  const s = Math.max(0, Math.floor((nowMs - fromMs) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export const etaLabel = (seconds: number | null): string | null =>
  seconds === null ? null : `${Math.max(1, Math.round(seconds / 60))} MIN`;
