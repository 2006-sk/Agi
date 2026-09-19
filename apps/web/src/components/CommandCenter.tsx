"use client";

// The console shell. The city is full-bleed; the HUD is etched over it on edge scrims (DESIGN.md §5).
// The overlay root ignores the pointer so the city stays orbitable — controls opt back in with pointer-events-auto.
import dynamic from "next/dynamic";
import type { CSSProperties } from "react";
import ToolRail from "@/components/actions/ToolRail";
import ApprovalGate from "@/components/approval/ApprovalGate";
import CallStack from "@/components/calls/CallStack";
import PerfGuard from "@/components/hud/PerfGuard";
import Shockwave from "@/components/hud/Shockwave";
import StartPrompt from "@/components/hud/StartPrompt";
import TopBar from "@/components/hud/TopBar";
import IncidentPanel from "@/components/incident/IncidentPanel";
import { useAuraSocket } from "@/hooks/useAuraSocket";
import { cssVar, priorityColor } from "@/lib/palette";
import { agentMode, useActiveCall } from "@/state/selectors";

const AuraCity = dynamic(() => import("@/components/city/AuraCity"), { ssr: false });

export default function CommandCenter() {
  useAuraSocket();
  const call = useActiveCall();

  // --state is the one semantic colour the active call currently earns: priority once known,
  // otherwise what AURA is doing (cyan listening / violet reasoning).
  const mode = agentMode(call);
  const state =
    call && call.approval.status === "approved"
      ? "var(--color-approved)"
      : call && call.priority !== "pending"
        ? cssVar(priorityColor[call.priority])
        : mode === "reasoning"
          ? "var(--color-reason)"
          : "var(--color-listen)";

  return (
    <main className="fixed inset-0 overflow-hidden bg-void" style={{ "--state": state } as CSSProperties}>
      {/* `isolate` is load-bearing: the city's drei <Html> unit label carries an inline z-index
          (zIndexRange 8–24). Without its own stacking context that index escapes the canvas and can
          paint over the HUD columns and over the approval gate (z-20) — and the transcript, the
          priority tag and the gate must never be covered. Isolated, it stays inside the city. */}
      <div className="absolute inset-0 isolate">
        <AuraCity />
      </div>

      {/* edge scrims: legibility without boxes */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute inset-y-0 left-0 w-[calc(var(--col-left)+14vw)] bg-gradient-to-r from-void via-void/80 to-transparent" />
        <div className="absolute inset-y-0 right-0 w-[calc(var(--col-right)+14vw)] bg-gradient-to-l from-void via-void/85 to-transparent" />
        <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-void to-transparent" />
        <div className="absolute inset-x-0 bottom-0 h-[calc(var(--rail-bottom)+10vh)] bg-gradient-to-t from-void via-void/85 to-transparent" />
      </div>

      <div className="pointer-events-none absolute inset-0 grid grid-cols-[var(--col-left)_1fr_var(--col-right)] grid-rows-[var(--bar-top)_1fr_var(--rail-bottom)]">
        <div className="col-span-3">
          <TopBar />
        </div>

        <aside aria-label="Live calls" className="min-h-0 pt-4 pb-2 pl-6">
          <CallStack />
        </aside>

        <section aria-label="City" className="relative min-h-0">
          <StartPrompt />
          <ApprovalGate />
        </section>

        <aside aria-label="Incident intelligence" className="min-h-0 pt-4 pr-6 pb-2">
          <IncidentPanel />
        </aside>

        <footer aria-label="Action rail" className="col-span-3 min-h-0 px-6">
          <ToolRail />
        </footer>
      </div>

      <Shockwave />
      {/* Headless. Honours ?quality=low and prefers-reduced-motion up front, then watches real frame
          time and drops the console to low quality once, permanently. Without it nothing ever sets
          quality, so every region's reduced-motion path stays dark. */}
      <PerfGuard />
    </main>
  );
}
