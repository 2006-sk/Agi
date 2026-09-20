import { useNow } from "../hooks/useNow.ts";
import { transport } from "../lib/client.ts";
import { clock } from "../lib/format.ts";
import { selectFocus, useEchoStore } from "../store/useEchoStore.ts";
import { Chip, Dot, Kbd } from "./ui.tsx";

const SPONSORS = [
  { name: "Gradium", role: "STT / TTS" },
  { name: "Pipecat", role: "voice transport" },
  { name: "SambaNova", role: "reasoning" },
  { name: "General Compute", role: "inference" },
];

export function TopBar() {
  const now = useNow(1000);
  const connection = useEchoStore((s) => s.connection);
  const degraded = useEchoStore((s) => s.degraded);
  const meta = useEchoStore((s) => selectFocus(s)?.analysis?.meta ?? null);
  const focusId = useEchoStore((s) => s.focusId);
  const toggleConsole = useEchoStore((s) => s.setUi);
  const consoleOpen = useEchoStore((s) => s.ui.consoleOpen);

  const source = meta?.source ?? null;
  const sourceColor = source === "model" ? "#22d3ee" : source === "mock" ? "#a78bfa" : source === "fallback" ? "#fbbf24" : "#64748b";
  const connColor = connection === "open" ? "#34d399" : connection === "connecting" ? "#fbbf24" : "#ef4444";

  return (
    <div className="h-full flex items-center justify-between px-4 border-b hairline bg-black/55 backdrop-blur-md pointer-events-auto">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="relative w-6 h-6">
            <span className="absolute inset-0 rounded-full border border-echo/60 animate-ping opacity-40" />
            <span className="absolute inset-[6px] rounded-full bg-echo shadow-[0_0_14px_#22d3ee]" />
          </div>
          <div className="leading-none">
            <div className="font-display font-semibold tracking-[0.32em] text-[15px]">ECHO</div>
            <div className="label mt-1">command center / overflow intake</div>
          </div>
        </div>
        <Chip color="#fbbf24" dim title="Hackathon simulation. No real dispatch.">
          SIMULATION
        </Chip>
        <Chip color="#a5b4fc" dim>
          HUMAN-SUPERVISED
        </Chip>
      </div>

      <div className="hidden xl:flex items-center gap-5">
        {SPONSORS.map((s) => (
          <div key={s.name} className="flex items-center gap-2">
            <span className="text-[11px] tracking-[0.12em] text-white/75 uppercase">{s.name}</span>
            <span className="label !text-white/30">{s.role}</span>
          </div>
        ))}
      </div>

      <div className="flex items-center gap-4">
        {degraded && (
          <Chip color="#fbbf24" title={degraded.detail ?? ""}>
            <Dot color="#fbbf24" pulse size={6} /> DEGRADED: {degraded.failed_dependency} / {degraded.fallback_mode}
          </Chip>
        )}
        {meta && (
          <Chip color={sourceColor} title={`validation ${meta.validation}, ${meta.attempts} attempt(s)`}>
            {source === "model" ? meta.model : source === "mock" ? "mock model" : source === "fallback" ? "deterministic fallback" : "no model"}
            {meta.model_latency_ms !== null && <span className="text-white/45">{Math.round(meta.model_latency_ms)}ms</span>}
          </Chip>
        )}
        <Chip color={transport.kind === "mock" ? "#a78bfa" : "#22d3ee"} dim title={transport.label}>
          {transport.kind === "mock" ? "mock event stream" : "gateway"}
        </Chip>
        {focusId && (
          <span className="mono text-[11px] text-white/55">
            <span className="text-white/30">session</span> {focusId}
          </span>
        )}
        <span className="flex items-center gap-1.5 mono text-[11px] text-white/60">
          <Dot color={connColor} pulse={connection !== "open"} size={7} />
          {connection === "open" ? "LIVE" : connection.toUpperCase()}
        </span>
        <span className="mono text-[13px] text-white/85 tabular-nums">{clock(new Date(now))}</span>
        <button type="button" className="btn !py-1 !px-2 flex items-center gap-2" onClick={() => toggleConsole({ consoleOpen: !consoleOpen })}>
          console <Kbd>`</Kbd>
        </button>
      </div>
    </div>
  );
}
