import { useEffect, useRef } from "react";
import { readLevel } from "../store/audioLevels.ts";
import { selectFocus, useAuraStore } from "../store/useAuraStore.ts";
import { Dot } from "./ui.tsx";

const BARS = 30;

function noise(i: number, t: number): number {
  return 0.55 + 0.45 * Math.sin(i * 1.7 + t * 0.011) * Math.sin(i * 0.6 - t * 0.007);
}

export function AudioDeck() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const status = useAuraStore((s) => {
    const f = selectFocus(s);
    if (!f) return "standby";
    if (f.agent.active) return "aura";
    if (f.partial) return "caller";
    if (f.analyzing) return "reasoning";
    return f.state ? "listening" : "standby";
  });
  const callerLabel = useAuraStore((s) => selectFocus(s)?.caller?.caller_label ?? "caller");

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const ctx = el.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    const smooth = { caller: new Float32Array(BARS), agent: new Float32Array(BARS) };
    const dpr = Math.min(2, window.devicePixelRatio || 1);

    const draw = () => {
      const width = el.clientWidth;
      const height = el.clientHeight;
      if (el.width !== width * dpr || el.height !== height * dpr) {
        el.width = width * dpr;
        el.height = height * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const st = useAuraStore.getState();
      const focusId = st.focusId;
      const f = focusId ? st.sessions[focusId] : null;
      const now = performance.now();
      let caller = readLevel(focusId, "caller");
      let agent = readLevel(focusId, "agent");
      if (f?.agent.active && agent < 0.08) agent = 0.35 + 0.25 * Math.sin(now / 85) * Math.sin(now / 37);
      if (f?.partial && caller < 0.08) caller = 0.3 + 0.2 * Math.sin(now / 70);

      const half = width / 2;
      const gap = 3;
      const bw = (half - 24) / BARS - gap;
      const mid = height / 2;
      const render = (levels: Float32Array, level: number, color: string, leftSide: boolean) => {
        for (let i = 0; i < BARS; i += 1) {
          const shape = Math.sin((i / (BARS - 1)) * Math.PI) ** 0.6;
          const target = level * shape * noise(i, now) + 0.02;
          levels[i] = levels[i]! + (target - levels[i]!) * 0.28;
          const h = Math.max(2, levels[i]! * (height - 12));
          const x = leftSide ? half - 12 - (i + 1) * (bw + gap) : half + 12 + i * (bw + gap);
          ctx.fillStyle = color;
          ctx.globalAlpha = 0.35 + levels[i]! * 0.65;
          ctx.shadowColor = color;
          ctx.shadowBlur = 6 + levels[i]! * 10;
          ctx.beginPath();
          ctx.roundRect(x, mid - h / 2, bw, h, 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        ctx.shadowBlur = 0;
      };
      render(smooth.caller, caller, "#f5f5f4", true);
      render(smooth.agent, agent, "#22d3ee", false);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  const statusLabel =
    status === "aura" ? "ECHO SPEAKING" : status === "caller" ? "CALLER SPEAKING" : status === "reasoning" ? "REASONING" : status === "listening" ? "LISTENING" : "STANDBY";
  const statusColor = status === "aura" ? "#22d3ee" : status === "caller" ? "#f5f5f4" : status === "reasoning" ? "#a78bfa" : "#64748b";

  return (
    <div className="glass pointer-events-auto w-[640px] h-[124px] relative overflow-hidden corner-marks">
      <div className="absolute left-3 top-2 flex items-center gap-2">
        <Dot color="#f5f5f4" pulse={status === "caller"} size={6} />
        <span className="label !text-white/60">{callerLabel}</span>
        <span className="label !text-white/25">Pipecat transport</span>
      </div>
      <div className="absolute right-3 top-2 flex items-center gap-2">
        <span className="label !text-white/25">Gradium TTS</span>
        <span className="label !text-aura">ECHO</span>
        <Dot color="#22d3ee" pulse={status === "aura"} size={6} />
      </div>
      <canvas ref={canvas} className="absolute inset-x-0 top-6 bottom-6 w-full h-[calc(100%-48px)]" />
      <div className="absolute inset-x-0 bottom-1.5 flex justify-center">
        <span className="mono text-[10px] tracking-[0.3em] transition-colors" style={{ color: statusColor }}>
          {statusLabel}
        </span>
      </div>
    </div>
  );
}
