"use client";

// The call made visible. Levels come from `audioBus` inside ONE shared requestAnimationFrame loop —
// never React state, never a per-frame constant (the demo panel runs at 360 Hz, so every rate below is
// expressed per second and multiplied by delta time).
//
// Reading of the form:
//   upper half, cyan   = the caller's voice
//   lower half, violet = AURA's channel — speech when it talks, a measured scan when it is reasoning
//   flat centre line   = silence. The bus decays to 0, so the form rests instead of idling.
import { useEffect, useRef } from "react";
import { cx } from "@/components/ui";
import { damp } from "@/lib/motion";
import { palette } from "@/lib/palette";
import { audioBus } from "@/state/audioBus";
import type { AgentMode } from "@/state/selectors";

/* ------------------------------------------------------------------ *
 * One rAF loop for every orb on screen.
 * ------------------------------------------------------------------ */
type Tick = (dt: number) => void;

const ticks = new Set<Tick>();
let frame = 0;
let prevT = 0;

const loop = (t: number) => {
  frame = requestAnimationFrame(loop);
  const dt = prevT === 0 ? 0 : Math.min(0.1, (t - prevT) / 1000);
  prevT = t;
  if (dt <= 0) return;
  for (const fn of ticks) fn(dt);
};

const onTick = (fn: Tick): (() => void) => {
  ticks.add(fn);
  if (frame === 0) {
    prevT = 0;
    frame = requestAnimationFrame(loop);
  }
  return () => {
    ticks.delete(fn);
    if (ticks.size === 0 && frame !== 0) {
      cancelAnimationFrame(frame);
      frame = 0;
      prevT = 0;
    }
  };
};

/* ------------------------------------------------------------------ */

const PITCH = 3; // css px between samples
const BAR = 2; // css px bar width
const SPEED = 42; // css px per second the trace scrolls
const STEP = PITCH / SPEED; // seconds between samples
const SCAN_PERIOD = 1.9; // seconds for one "AURA is thinking" sweep
const FLOOR = 0.02; // below this there is nothing to draw

export type VoiceOrbProps = {
  sessionId: string;
  /** What AURA is doing — speech and reasoning read differently. */
  mode: AgentMode;
  /** True only for the call whose audio is actually streaming. Everything else rests. */
  live: boolean;
  /** prefers-reduced-motion or quality "low": a level bar instead of a scrolling trace. */
  calm: boolean;
  height?: number;
  className?: string;
};

export default function VoiceOrb({ sessionId, mode, live, calm, height = 28, className }: VoiceOrbProps) {
  const hostRef = useRef<HTMLSpanElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const callerBarRef = useRef<HTMLSpanElement | null>(null);
  const agentBarRef = useRef<HTMLSpanElement | null>(null);

  // the loop reads the current mode without re-subscribing
  const modeRef = useRef<AgentMode>(mode);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  // ---- scrolling trace -------------------------------------------------
  useEffect(() => {
    if (!live || calm) return;
    const host = hostRef.current;
    const canvas = canvasRef.current;
    if (!host || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = 0;
    let h = 0;
    let cols = 0;
    let callerBuf = new Float32Array(0);
    let agentBuf = new Float32Array(0);
    let head = 0;
    let acc = 0;
    let peakC = 0;
    let peakA = 0;
    let phase = 0;

    const resize = () => {
      const rect = host.getBoundingClientRect();
      w = Math.max(1, Math.round(rect.width));
      h = Math.max(1, Math.round(rect.height));
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const next = Math.ceil(w / PITCH) + 2;
      if (next !== cols) {
        // history is cheap to rebuild; a resize is rare and re-allocating keeps the indexing honest
        cols = next;
        callerBuf = new Float32Array(cols);
        agentBuf = new Float32Array(cols);
        head = 0;
      }
    };

    const draw = () => {
      if (cols === 0) return;
      const mid = h / 2;
      const half = Math.max(2, h / 2 - 1.5);
      ctx.clearRect(0, 0, w, h);

      // the resting line: silence has to look like silence
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = palette.ink3;
      ctx.fillRect(0, mid - 0.5, w, 1);

      // caller — upward, cyan
      ctx.fillStyle = palette.listen;
      for (let i = 0; i < cols; i++) {
        const x = w - (i + 1) * PITCH;
        if (x + BAR < 0) break;
        const v = callerBuf[(head - i + cols) % cols];
        if (v < FLOOR) continue;
        const bh = Math.max(1, Math.min(half, v * half));
        ctx.globalAlpha = 0.3 + 0.7 * Math.min(1, v * 1.5);
        ctx.fillRect(x, mid - 1 - bh, BAR, bh);
      }

      // AURA — downward, violet
      ctx.fillStyle = palette.reason;
      if (modeRef.current === "reasoning") {
        // thinking, not speaking: a measured scan across AURA's channel, never an audio shape
        const p = (phase % SCAN_PERIOD) / SCAN_PERIOD;
        const headX = -40 + p * (w + 80);
        for (let x = 1; x < w; x += 6) {
          const k = Math.max(0, 1 - Math.abs(x - headX) / 38);
          const kk = k * k;
          ctx.globalAlpha = 0.16 + 0.74 * kk;
          ctx.fillRect(x, mid + 1, 1, 1 + kk * half * 0.6);
        }
      } else {
        for (let i = 0; i < cols; i++) {
          const x = w - (i + 1) * PITCH;
          if (x + BAR < 0) break;
          const v = agentBuf[(head - i + cols) % cols];
          if (v < FLOOR) continue;
          const bh = Math.max(1, Math.min(half, v * half));
          ctx.globalAlpha = 0.3 + 0.7 * Math.min(1, v * 1.5);
          ctx.fillRect(x, mid + 1, BAR, bh);
        }
      }

      ctx.globalAlpha = 1;
    };

    const tick = (dt: number) => {
      if (cols === 0) return;
      peakC = Math.max(peakC, audioBus.read(sessionId, "caller"));
      peakA = Math.max(peakA, audioBus.read(sessionId, "agent"));
      acc += dt;
      let pushes = 0;
      while (acc >= STEP && pushes < 64) {
        acc -= STEP;
        pushes += 1;
        head = (head + 1) % cols;
        callerBuf[head] = peakC;
        agentBuf[head] = peakA;
        // re-read rather than zero, so a sustained voice stays continuous across a multi-sample frame
        peakC = audioBus.read(sessionId, "caller");
        peakA = audioBus.read(sessionId, "agent");
      }
      if (pushes >= 64) acc = 0;
      phase += dt;
      draw();
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    const stop = onTick(tick);
    return () => {
      ro.disconnect();
      stop();
    };
  }, [live, calm, sessionId]);

  // ---- reduced motion / low quality: a level bar, no scroll ------------
  useEffect(() => {
    if (!live || !calm) return;
    const callerBar = callerBarRef.current;
    const agentBar = agentBarRef.current;
    if (!callerBar || !agentBar) return;

    let cv = 0;
    let av = 0;
    return onTick((dt) => {
      const k = damp(18, dt);
      const reasoning = modeRef.current === "reasoning";
      cv += (audioBus.read(sessionId, "caller") - cv) * k;
      av += ((reasoning ? 1 : audioBus.read(sessionId, "agent")) - av) * k;
      callerBar.style.transform = `scaleX(${cv.toFixed(3)})`;
      agentBar.style.transform = `scaleX(${av.toFixed(3)})`;
      agentBar.style.opacity = reasoning ? "0.4" : "1";
    });
  }, [live, calm, sessionId]);

  return (
    <span ref={hostRef} aria-hidden className={cx("relative block w-full", className)} style={{ height }}>
      {!live ? (
        <span className="absolute top-1/2 right-0 left-0 block h-px -translate-y-1/2 bg-rule" />
      ) : calm ? (
        <span className="absolute top-1/2 right-0 left-0 flex -translate-y-1/2 flex-col gap-1">
          <span className="relative block h-[2px] w-full bg-rule">
            <span
              ref={callerBarRef}
              className="absolute inset-0 block origin-left"
              style={{ background: "var(--color-listen)", transform: "scaleX(0)" }}
            />
          </span>
          <span className="relative block h-[2px] w-full bg-rule">
            <span
              ref={agentBarRef}
              className="absolute inset-0 block origin-left"
              style={{ background: "var(--color-reason)", transform: "scaleX(0)" }}
            />
          </span>
        </span>
      ) : (
        <canvas ref={canvasRef} className="block h-full w-full" />
      )}
    </span>
  );
}
