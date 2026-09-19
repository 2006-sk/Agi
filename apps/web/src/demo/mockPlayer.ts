"use client";

// Plays a Script against a sink using one clock. Produces real AuraEvent envelopes (ids, per-session sequences,
// ISO timestamps) plus synthetic `audio.level` frames while someone is speaking.
import type { AuraEvent } from "@/lib/contracts";
import { approvalOutcome, medicalScenario, PRIMARY_SESSION, type Script } from "./mockEvents";

type Sink = (ev: AuraEvent) => void;

const TICK_MS = 40; // 25 Hz audio frames

let sink: Sink | null = null;
let timer: ReturnType<typeof setInterval> | null = null;
let script: Script = { events: [], audio: [] };
let cursor = 0;
let startedAt = 0; // performance.now() at scenario t=0
let rate = 1;
let counter = 0;
let awaitingApproval = false;
const sequences = new Map<string, number>();

const emit = (session: string, type: string, payload: Record<string, unknown>) => {
  const sequence = (sequences.get(session) ?? 0) + 1;
  sequences.set(session, sequence);
  sink?.({
    event_id: `mock_${++counter}`,
    session_id: session,
    type,
    timestamp: new Date().toISOString(),
    sequence,
    payload,
  });
};

const voice = (t: number, intensity: number): number => {
  // syllable-ish envelope: two beating sines plus a little grit; deterministic, no Math.random
  const syllable = Math.abs(Math.sin(t * 9.1) * Math.sin(t * 2.3 + 1.1));
  const grit = 0.5 + 0.5 * Math.sin(t * 37.0);
  return Math.min(1, intensity * (0.18 + 0.7 * syllable + 0.12 * grit));
};

const tick = () => {
  const t = ((performance.now() - startedAt) / 1000) * rate;
  while (cursor < script.events.length && script.events[cursor].at <= t) {
    const e = script.events[cursor++];
    if (e.type === "approval.requested") awaitingApproval = true;
    emit(e.session, e.type, e.payload);
  }
  for (const w of script.audio) {
    if (t >= w.from && t <= w.to) emit(w.session, "audio.level", { speaker: w.speaker, level: voice(t, w.intensity) });
  }
  const lastAudio = script.audio.reduce((m, w) => Math.max(m, w.to), 0);
  if (cursor >= script.events.length && t > lastAudio && timer) {
    clearInterval(timer);
    timer = null;
  }
};

const play = (next: Script, fromSeconds = 0) => {
  if (timer) clearInterval(timer);
  script = next;
  cursor = 0;
  startedAt = performance.now() - (fromSeconds * 1000) / rate;
  tick(); // anything at or before `fromSeconds` lands immediately (handy for jumping to a state while developing)
  timer = setInterval(tick, TICK_MS);
};

export const mockPlayer = {
  /** `from` skips ahead (seconds); `speed` scales the clock. Both are dev conveniences: `?t=33&speed=2`. */
  start(onEvent: Sink, opts: { from?: number; speed?: number } = {}) {
    mockPlayer.stop();
    sink = onEvent;
    rate = opts.speed && opts.speed > 0 ? opts.speed : 1;
    counter = 0;
    sequences.clear();
    awaitingApproval = false;
    play(medicalScenario(), opts.from ?? 0);
  },
  /** The human answered the gate. Nothing downstream of approval ever plays without this call. */
  resolveApproval(approved: boolean) {
    if (!sink || !awaitingApproval) return;
    awaitingApproval = false;
    play(approvalOutcome(approved));
  },
  stop() {
    if (timer) clearInterval(timer);
    timer = null;
    sink = null;
    awaitingApproval = false;
  },
  get primarySession() {
    return PRIMARY_SESSION;
  },
};
