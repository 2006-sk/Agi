import { useEffect } from "react";
import { useCues } from "../hooks/useCues.ts";
import { useAuraStore } from "../store/useAuraStore.ts";

let context: AudioContext | null = null;

function ensureContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!context) {
    try {
      context = new AudioContext();
    } catch {
      return null;
    }
  }
  if (context.state === "suspended") void context.resume();
  return context;
}

interface ToneOptions {
  frequency: number;
  duration: number;
  type?: OscillatorType;
  gain?: number;
  sweepTo?: number;
  delay?: number;
  lowpass?: number;
}

function tone(options: ToneOptions): void {
  const ctx = ensureContext();
  if (!ctx) return;
  const start = ctx.currentTime + (options.delay ?? 0);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = options.type ?? "sine";
  osc.frequency.setValueAtTime(options.frequency, start);
  if (options.sweepTo) osc.frequency.exponentialRampToValueAtTime(options.sweepTo, start + options.duration);
  const peak = options.gain ?? 0.05;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + options.duration);
  let node: AudioNode = osc;
  if (options.lowpass) {
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = options.lowpass;
    osc.connect(filter);
    node = filter;
  }
  node.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(start + options.duration + 0.02);
}

export const sfx = {
  blip: () => tone({ frequency: 880, sweepTo: 1320, duration: 0.09, gain: 0.035 }),
  ping: (soft = false) => tone({ frequency: soft ? 330 : 440, duration: 0.25, gain: soft ? 0.02 : 0.035, type: "triangle" }),
  whoosh: () => tone({ frequency: 180, sweepTo: 720, duration: 0.45, gain: 0.03, type: "sawtooth", lowpass: 900 }),
  alarm: () => {
    for (let i = 0; i < 3; i += 1) {
      tone({ frequency: 660, duration: 0.14, gain: 0.07, type: "square", lowpass: 1800, delay: i * 0.22 });
      tone({ frequency: 880, duration: 0.14, gain: 0.07, type: "square", lowpass: 1800, delay: i * 0.22 + 0.11 });
    }
  },
  chime: () => {
    [523, 659, 784].forEach((f, i) => tone({ frequency: f, duration: 0.35, gain: 0.045, delay: i * 0.09 }));
  },
  confirm: () => {
    tone({ frequency: 784, duration: 0.18, gain: 0.05 });
    tone({ frequency: 1046, duration: 0.3, gain: 0.05, delay: 0.14 });
  },
  reject: () => {
    tone({ frequency: 330, duration: 0.25, gain: 0.05, type: "triangle" });
    tone({ frequency: 220, duration: 0.35, gain: 0.05, type: "triangle", delay: 0.18 });
  },
};

/** Synthesized UI sounds (no audio assets); unlocked on the first pointer interaction. */
export function useSfx(): void {
  useEffect(() => {
    const unlock = () => ensureContext();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  useCues((cue) => {
    if (!useAuraStore.getState().settings.sfx) return;
    switch (cue.kind) {
      case "call_started":
        sfx.ping(cue.ambient);
        break;
      case "located":
        sfx.whoosh();
        break;
      case "tool_done":
        sfx.blip();
        break;
      case "escalation":
        sfx.alarm();
        break;
      case "approval_requested":
        sfx.chime();
        break;
      case "approved":
      case "dispatched":
        sfx.confirm();
        break;
      case "rejected":
        sfx.reject();
        break;
      default:
        break;
    }
  });
}
