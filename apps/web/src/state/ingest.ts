"use client";

// Every event — mock or live — enters the app through `ingest`.
//  • duplicates are dropped by event_id
//  • events are applied in `sequence` order per session, so the UI never moves backward
//  • unknown / malformed events are ignored, never fatal
//  • audio.level bypasses React state entirely (see audioBus)
import { field, type AuraEvent } from "@/lib/contracts";
import { audioBus } from "./audioBus";
import { useAura } from "./auraStore";

const REORDER_WINDOW_MS = 70;
const MAX_SEEN = 4000;

const seen = new Set<string>();
const lastApplied = new Map<string, number>();
const pending = new Map<string, AuraEvent[]>();
const timers = new Map<string, ReturnType<typeof setTimeout>>();

const isEvent = (v: unknown): v is AuraEvent => {
  const o = v as AuraEvent | null;
  return (
    !!o &&
    typeof o === "object" &&
    typeof o.event_id === "string" &&
    typeof o.session_id === "string" &&
    typeof o.type === "string" &&
    typeof o.sequence === "number"
  );
};

const flush = (sessionId: string) => {
  timers.delete(sessionId);
  const queue = (pending.get(sessionId) ?? []).sort((a, b) => a.sequence - b.sequence);
  pending.delete(sessionId);
  for (const ev of queue) applyInOrder(ev);
};

const applyInOrder = (ev: AuraEvent) => {
  const last = lastApplied.get(ev.session_id) ?? -Infinity;
  if (ev.sequence <= last) return; // stale: applying it would move the UI backward
  lastApplied.set(ev.session_id, ev.sequence);
  useAura.getState().apply(ev);
};

export const ingest = (raw: unknown): void => {
  if (!isEvent(raw)) return;
  const ev = raw;

  if (ev.type === "audio.level") {
    // ephemeral: no dedupe, no ordering, no React
    const p = field.obj(ev.payload);
    const level = field.num(p.level) ?? field.num(p.normalized_level) ?? 0;
    const speaker = ["agent", "aura", "assistant"].includes(String(p.speaker).toLowerCase()) ? "agent" : "caller";
    audioBus.push(ev.session_id, speaker, level);
    return;
  }

  if (seen.has(ev.event_id)) return;
  seen.add(ev.event_id);
  if (seen.size > MAX_SEEN) seen.delete(seen.values().next().value as string);

  const last = lastApplied.get(ev.session_id);
  const queue = pending.get(ev.session_id);
  const inOrder = last === undefined || ev.sequence === last + 1;

  if (inOrder && !queue?.length) {
    applyInOrder(ev); // fast path: zero added latency
    return;
  }

  // A gap: hold briefly so a late lower-sequence event can still slot in ahead.
  pending.set(ev.session_id, [...(queue ?? []), ev]);
  if (!timers.has(ev.session_id)) timers.set(ev.session_id, setTimeout(() => flush(ev.session_id), REORDER_WINDOW_MS));
};

export const resetIngest = (): void => {
  timers.forEach((t) => clearTimeout(t));
  timers.clear();
  pending.clear();
  lastApplied.clear();
  seen.clear();
  audioBus.clear();
};
