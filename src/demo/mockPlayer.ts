'use client';

/**
 * Drives the mock script on a virtual clock.
 *
 * The player only ever calls `useAuraStore.applyEvent`, exactly like the WebSocket
 * client. It knows nothing about components.
 *
 * The gate is the important part: playback stops dead at `approval.requested` and
 * does not resume until a real operator decision lands in the store. There is no
 * timed path from "approval requested" to "unit moving".
 */

import { useAuraStore } from '@/state/auraStore';
import {
  SCRIPT_APPROVED,
  SCRIPT_PRE,
  SCRIPT_REJECTED,
  PRE_DURATION_MS,
  APPROVED_DURATION_MS,
} from '@/demo/mockEvents';

export type PlayerPhase = 'idle' | 'playing' | 'paused' | 'gated' | 'done';
export type PlayerSegment = 'pre' | 'approved' | 'rejected';

export interface PlayerState {
  phase: PlayerPhase;
  segment: PlayerSegment;
  /** Virtual clock within the current segment, ms. */
  clockMs: number;
  /** Duration of the current segment, ms. */
  durationMs: number;
  emitted: number;
  total: number;
  speed: number;
}

export interface MockPlayer {
  play(): void;
  pause(): void;
  toggle(): void;
  reset(): void;
  setSpeed(speed: number): void;
  /** Jump to a point in segment 1, applying everything up to it at once. */
  seek(ms: number): void;
  getState(): PlayerState;
  subscribe(listener: (state: PlayerState) => void): () => void;
  destroy(): void;
}

const TICK_MS = 25;

export function createMockPlayer(): MockPlayer {
  const store = useAuraStore;

  let phase: PlayerPhase = 'idle';
  let segment: PlayerSegment = 'pre';
  let clockMs = 0;
  let emitted = 0;
  let speed = 1;
  let cursor = 0;
  let timer: number | null = null;
  let lastTick = 0;
  const listeners = new Set<(s: PlayerState) => void>();

  function script() {
    return segment === 'pre'
      ? SCRIPT_PRE
      : segment === 'approved'
        ? SCRIPT_APPROVED
        : SCRIPT_REJECTED;
  }

  function duration() {
    return segment === 'pre'
      ? PRE_DURATION_MS
      : segment === 'approved'
        ? APPROVED_DURATION_MS
        : 500;
  }

  function snapshot(): PlayerState {
    return {
      phase,
      segment,
      clockMs,
      durationMs: duration(),
      emitted,
      total: script().length,
      speed,
    };
  }

  function notify() {
    const s = snapshot();
    for (const l of listeners) l(s);
  }

  /**
   * Live events carry the wall clock, not the authoring clock, so the call timer and
   * anything else derived from `timestamp` behaves like a real feed.
   */
  function emit(at: number, event: (typeof SCRIPT_PRE)[number]['event']) {
    store.getState().applyEvent({
      ...event,
      timestamp: new Date(Date.now() - (clockMs - at)).toISOString(),
    });
  }

  function drainUpTo(ms: number) {
    const list = script();
    while (cursor < list.length && list[cursor].at <= ms) {
      emit(list[cursor].at, list[cursor].event);
      cursor++;
      emitted++;
    }
  }

  function enterSegment(next: PlayerSegment) {
    segment = next;
    cursor = 0;
    emitted = 0;
    clockMs = 0;
  }

  function stopTimer() {
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  }

  function tick() {
    const now = performance.now();
    const dt = Math.min(250, now - lastTick) * speed;
    lastTick = now;
    clockMs += dt;

    drainUpTo(clockMs);

    const list = script();
    if (cursor >= list.length) {
      if (segment === 'pre') {
        const approval = store.getState().approval;
        if (!approval || approval.state === 'pending') {
          // Hold at the gate. Nothing advances without a human.
          phase = 'gated';
          stopTimer();
          notify();
          return;
        }
        enterSegment(approval.state === 'granted' ? 'approved' : 'rejected');
        notify();
        return;
      }
      phase = 'done';
      stopTimer();
      notify();
      return;
    }
    notify();
  }

  function startTimer() {
    stopTimer();
    lastTick = performance.now();
    timer = window.setInterval(tick, TICK_MS);
  }

  // When the operator decides while we are gated, continue into the right segment.
  const unsub = store.subscribe((s, prev) => {
    if (phase !== 'gated') return;
    const state = s.approval?.state;
    if (state === prev.approval?.state) return;
    if (state === 'granted') {
      enterSegment('approved');
      phase = 'playing';
      startTimer();
      notify();
    } else if (state === 'rejected') {
      enterSegment('rejected');
      phase = 'playing';
      startTimer();
      notify();
    }
  });

  return {
    play() {
      if (phase === 'playing' || phase === 'gated') return;
      if (phase === 'done') return;
      phase = 'playing';
      startTimer();
      notify();
    },
    pause() {
      if (phase !== 'playing') return;
      phase = 'paused';
      stopTimer();
      notify();
    },
    toggle() {
      if (phase === 'playing') this.pause();
      else this.play();
    },
    reset() {
      stopTimer();
      store.getState().reset();
      phase = 'idle';
      enterSegment('pre');
      notify();
    },
    setSpeed(next) {
      speed = Math.max(0.25, Math.min(4, next));
      notify();
    },
    seek(ms) {
      // Rebuild from the start so the store's sequence guarantees hold.
      stopTimer();
      store.getState().reset();
      enterSegment('pre');
      clockMs = Math.max(0, Math.min(PRE_DURATION_MS, ms));
      drainUpTo(clockMs);
      const gateReached = cursor >= SCRIPT_PRE.length;
      phase = gateReached ? 'gated' : 'paused';
      notify();
    },
    getState: snapshot,
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot());
      return () => listeners.delete(listener);
    },
    destroy() {
      stopTimer();
      listeners.clear();
      unsub();
    },
  };
}
