import type { Speaker } from "../contracts/index.ts";

interface LevelSample {
  level: number;
  at: number;
}

const samples = new Map<string, Record<Speaker, LevelSample>>();

/** Audio levels arrive ~8x/s per speaker; keep them out of React state. */
export function pushLevel(sessionId: string, speaker: Speaker, level: number, at = performance.now()): void {
  let entry = samples.get(sessionId);
  if (!entry) {
    entry = { caller: { level: 0, at: 0 }, agent: { level: 0, at: 0 } };
    samples.set(sessionId, entry);
  }
  entry[speaker] = { level, at };
}

/** Level decayed towards zero ~450 ms after the last sample. */
export function readLevel(sessionId: string | null, speaker: Speaker, now = performance.now()): number {
  if (!sessionId) return 0;
  const entry = samples.get(sessionId);
  if (!entry) return 0;
  const sample = entry[speaker];
  const age = now - sample.at;
  if (age > 450) return 0;
  return sample.level * (1 - age / 450);
}

export function clearLevels(): void {
  samples.clear();
}
