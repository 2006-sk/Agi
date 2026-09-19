"use client";

// Owns the session lifecycle and the operator's keyboard shortcuts.
//   Enter / D  start or restart the demo call      A  approve      R  reject
import { useEffect } from "react";
import { sendApproval, startSession, stopSession } from "@/lib/auraClient";
import { useAura } from "@/state/auraStore";

export const useAuraSocket = (opts: { autoStart?: boolean } = {}) => {
  const { autoStart = false } = opts;

  useEffect(() => {
    if (autoStart || new URLSearchParams(window.location.search).has("t")) void startSession();
    return () => stopSession();
  }, [autoStart]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const state = useAura.getState();
      const call = state.activeSessionId ? state.calls[state.activeSessionId] : null;
      const gateOpen = call?.approval.status === "requested";
      const k = e.key.toLowerCase();
      if (k === "d" || (k === "enter" && !gateOpen && target?.tagName !== "BUTTON")) void startSession();
      else if (k === "a" && gateOpen) void sendApproval(true);
      else if (k === "r" && gateOpen) void sendApproval(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
};
