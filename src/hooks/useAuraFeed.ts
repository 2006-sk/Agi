'use client';

/**
 * The single switch between the mock script and the live gateway.
 *
 * Milestone 2 is this file and nothing else: set NEXT_PUBLIC_AURA_WS_URL and the
 * mock player is never constructed. Every visual component downstream is unchanged
 * because both sources land in `applyEvent`.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import { SESSION_ID } from '@/demo/mockEvents';
import { createMockPlayer, type MockPlayer, type PlayerState } from '@/demo/mockPlayer';
import { useAuraSocket } from '@/hooks/useAuraSocket';
import { useReducedMotionSync } from '@/hooks/useReducedMotion';
import { useAuraStore } from '@/state/auraStore';

/** Written out literally so Next can inline it at build time. */
const GATEWAY_URL = process.env.NEXT_PUBLIC_AURA_WS_URL;

/**
 * The player ticks ~40x/sec. Clock-only updates are coalesced to this interval so
 * the deck does not re-render at transport frequency; anything that changes the
 * transport's *meaning* — phase, segment, speed — still lands immediately.
 */
const CLOCK_FLUSH_MS = 80;

type Transport = { player: MockPlayer; state: PlayerState };

export interface AuraFeed {
  mode: 'mock' | 'live';
  player: MockPlayer | null;
  playerState: PlayerState | null;
  socketError: string | null;
}

export function useAuraFeed(): AuraFeed {
  useReducedMotionSync();

  const live = Boolean(GATEWAY_URL);
  const setConnection = useAuraStore((s) => s.setConnection);

  const playerRef = useRef<MockPlayer | null>(null);
  const [transport, setTransport] = useState<Transport | null>(null);

  // A hook, so it is always called; its effect no-ops unless enabled.
  const { lastError } = useAuraSocket({
    baseUrl: GATEWAY_URL,
    sessionId: SESSION_ID,
    enabled: live,
  });

  useEffect(() => {
    if (live) return;

    // Strict mode mounts twice — never leave a second player running.
    playerRef.current?.destroy();
    const p = createMockPlayer();
    playerRef.current = p;

    // Replay from a clean store so the second mount is identical to the first
    // rather than half-deduplicated against it.
    p.reset();
    setConnection('mock');

    let lastFlushAt = 0;
    let timer = 0;
    let queued: PlayerState | null = null;
    let lastKey = '';

    const flush = (s: PlayerState) => {
      lastFlushAt = performance.now();
      queued = null;
      if (timer) {
        window.clearTimeout(timer);
        timer = 0;
      }
      setTransport({ player: p, state: s });
    };

    // `subscribe` calls back synchronously, which is what publishes the player.
    const unsubscribe = p.subscribe((s) => {
      const key = `${s.phase}|${s.segment}|${s.speed}|${s.total}`;
      if (key !== lastKey) {
        lastKey = key;
        flush(s);
        return;
      }
      const now = performance.now();
      const waited = now - lastFlushAt;
      if (waited >= CLOCK_FLUSH_MS) {
        flush(s);
        return;
      }
      queued = s;
      if (!timer) {
        timer = window.setTimeout(() => {
          timer = 0;
          const pending = queued;
          if (pending) flush(pending);
        }, CLOCK_FLUSH_MS - waited);
      }
    });

    p.play();

    return () => {
      if (timer) window.clearTimeout(timer);
      unsubscribe();
      p.destroy();
      if (playerRef.current === p) playerRef.current = null;
    };
  }, [live, setConnection]);

  return useMemo<AuraFeed>(
    () => ({
      mode: live ? 'live' : 'mock',
      player: transport?.player ?? null,
      playerState: transport?.state ?? null,
      socketError: lastError,
    }),
    [live, transport, lastError],
  );
}
