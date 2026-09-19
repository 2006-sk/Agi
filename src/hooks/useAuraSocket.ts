'use client';

/**
 * Native WebSocket client for the normalized AURA event stream.
 *
 * Connects only to Shresth's gateway — never to Gradium, Pipecat, SambaNova or any
 * other upstream service. Every frame goes through `applyEvent`, so the visual layer
 * is identical whether events come from here or from the mock player.
 *
 * Milestone 2 is exactly this: point `NEXT_PUBLIC_AURA_WS_URL` at the gateway and the
 * mock source stops being used. No visual component changes.
 */

import { useEffect, useRef, useState } from 'react';

import { useAuraStore, type OperatorCommand } from '@/state/auraStore';
import type { AuraEvent } from '@/types/events';

export type SocketOptions = {
  /** Gateway base, e.g. `ws://localhost:8000`. When absent the hook does nothing. */
  baseUrl?: string;
  sessionId: string;
  enabled: boolean;
};

const RECONNECT_MS = [500, 1000, 2000, 4000, 8000];
/** How long to hold a sequence gap before giving up on the missing event. */
const GAP_TIMEOUT_MS = 1200;

export function buildSocketUrl(baseUrl: string, sessionId: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  return `${trimmed}/ws/calls/${encodeURIComponent(sessionId)}`;
}

/** Parse one frame into an AuraEvent, or null if it is not one. */
export function parseFrame(data: unknown): AuraEvent | null {
  if (typeof data !== 'string') return null;
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.event_id !== 'string' || typeof o.type !== 'string') return null;
  return {
    event_id: o.event_id,
    session_id: typeof o.session_id === 'string' ? o.session_id : '',
    type: o.type,
    timestamp: typeof o.timestamp === 'string' ? o.timestamp : new Date().toISOString(),
    sequence: typeof o.sequence === 'number' ? o.sequence : Number.NaN,
    payload:
      typeof o.payload === 'object' && o.payload !== null
        ? (o.payload as Record<string, unknown>)
        : {},
  };
}

export function useAuraSocket({ baseUrl, sessionId, enabled }: SocketOptions) {
  const setConnection = useAuraStore((s) => s.setConnection);
  const setCommandSink = useAuraStore((s) => s.setCommandSink);
  const [lastError, setLastError] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const attemptRef = useRef(0);
  const closedRef = useRef(false);

  useEffect(() => {
    if (!enabled || !baseUrl) return;

    closedRef.current = false;
    let reconnectTimer: number | null = null;

    const url = buildSocketUrl(baseUrl, sessionId);

    // A lost frame must not stall the visuals: release held gaps periodically.
    const gapTimer = window.setInterval(() => {
      useAuraStore.getState().flushGaps();
    }, GAP_TIMEOUT_MS);

    function connect() {
      if (closedRef.current) return;
      setConnection('connecting');
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (err) {
        setLastError(err instanceof Error ? err.message : 'WebSocket unavailable');
        setConnection('error');
        schedule();
        return;
      }
      socketRef.current = ws;

      ws.onopen = () => {
        attemptRef.current = 0;
        setLastError(null);
        setConnection('live');
      };

      ws.onmessage = (ev) => {
        const parsed = parseFrame(ev.data);
        if (!parsed) return;
        useAuraStore.getState().applyEvent(parsed);
      };

      ws.onerror = () => {
        setLastError('Gateway connection error');
        setConnection('error');
      };

      ws.onclose = () => {
        socketRef.current = null;
        if (closedRef.current) return;
        setConnection('error');
        schedule();
      };
    }

    function schedule() {
      if (closedRef.current) return;
      const delay = RECONNECT_MS[Math.min(attemptRef.current, RECONNECT_MS.length - 1)];
      attemptRef.current += 1;
      reconnectTimer = window.setTimeout(connect, delay);
    }

    // Operator decisions travel back up the same socket.
    setCommandSink((cmd: OperatorCommand) => {
      const ws = socketRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ type: 'operator.decision', payload: cmd }));
    });

    connect();

    return () => {
      closedRef.current = true;
      window.clearInterval(gapTimer);
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      setCommandSink(null);
      socketRef.current?.close();
      socketRef.current = null;
      setConnection('offline');
    };
  }, [baseUrl, sessionId, enabled, setConnection, setCommandSink]);

  return { lastError };
}
