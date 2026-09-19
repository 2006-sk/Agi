// High-frequency audio levels live OUTSIDE React/Zustand. `audio.level` can arrive 20–50×/s; pushing that through
// React state would re-render the HUD constantly. Read these in requestAnimationFrame / useFrame loops.
import type { Speaker } from "@/lib/contracts";

type Levels = { caller: number; agent: number; at: number };

const levels = new Map<string, Levels>();
const SILENCE_AFTER_MS = 260;

export const audioBus = {
  push(sessionId: string, speaker: Speaker, level: number) {
    const l = levels.get(sessionId) ?? { caller: 0, agent: 0, at: 0 };
    l[speaker] = Math.max(0, Math.min(1, level));
    l.at = performance.now();
    levels.set(sessionId, l);
  },
  /** Current level 0..1. Falls to 0 if the stream went quiet, so visuals never freeze "loud". */
  read(sessionId: string | null, speaker: Speaker): number {
    if (!sessionId) return 0;
    const l = levels.get(sessionId);
    if (!l || performance.now() - l.at > SILENCE_AFTER_MS) return 0;
    return l[speaker];
  },
  /** Loudest of both speakers — handy for the city beacon. */
  readAny(sessionId: string | null): number {
    return Math.max(audioBus.read(sessionId, "caller"), audioBus.read(sessionId, "agent"));
  },
  clear() {
    levels.clear();
  },
};
