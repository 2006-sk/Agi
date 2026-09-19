"use client";

// Session controller. The frontend talks ONLY to Shresth's gateway (never to Gradium / Pipecat / SambaNova directly).
// If the gateway is not configured or not reachable, the deterministic local scenario plays instead —
// through the exact same `ingest` path, so the visuals cannot tell the difference.
import { mockPlayer } from "@/demo/mockPlayer";
import { useAura } from "@/state/auraStore";
import { ingest, resetIngest } from "@/state/ingest";

type Config = { gateway: string | null; from: number; speed: number };

export const readConfig = (): Config => {
  const q = typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search);
  const forcedMock = q.get("mock") === "1";
  const gateway = forcedMock ? null : (q.get("gateway") ?? process.env.NEXT_PUBLIC_AURA_GATEWAY ?? null);
  return {
    gateway: gateway ? gateway.replace(/\/+$/, "") : null,
    from: Number(q.get("t") ?? 0) || 0,
    speed: Number(q.get("speed") ?? 1) || 1,
  };
};

let socket: WebSocket | null = null;
let liveSessionId: string | null = null;
let closedByUs = false;
let retries = 0;
const MAX_RETRIES = 4;

const wsUrl = (gateway: string, id: string) => `${gateway.replace(/^http/, "ws")}/ws/calls/${id}`;

const startMock = (cfg: Config, degradedBecause?: string) => {
  const store = useAura.getState();
  store.setConnection("mock");
  mockPlayer.start(ingest, { from: cfg.from, speed: cfg.speed });
  if (degradedBecause) {
    ingest({
      event_id: `local_degraded_${Date.now()}`,
      session_id: "system",
      type: "system.degraded",
      timestamp: new Date().toISOString(),
      sequence: 1,
      payload: { failed_dependency: degradedBecause, fallback_mode: "Local scenario" },
    });
  }
};

const connect = (gateway: string, id: string, cfg: Config) => {
  const store = useAura.getState();
  socket = new WebSocket(wsUrl(gateway, id));
  socket.onopen = () => {
    retries = 0;
    store.setConnection("live");
  };
  socket.onmessage = (msg) => {
    try {
      const data: unknown = JSON.parse(String(msg.data));
      if (Array.isArray(data)) data.forEach(ingest);
      else ingest(data);
    } catch {
      /* non-JSON frames are ignored */
    }
  };
  socket.onclose = () => {
    if (closedByUs) return;
    if (retries < MAX_RETRIES) {
      retries += 1;
      store.setConnection("reconnecting");
      setTimeout(() => !closedByUs && connect(gateway, id, cfg), 400 * 2 ** retries);
    } else {
      store.setConnection("offline");
    }
  };
};

export const stopSession = () => {
  closedByUs = true;
  socket?.close();
  socket = null;
  liveSessionId = null;
  mockPlayer.stop();
};

/** Start (or restart) the demo call. */
export const startSession = async (): Promise<void> => {
  stopSession();
  resetIngest();
  const store = useAura.getState();
  store.reset();
  closedByUs = false;
  retries = 0;
  const cfg = readConfig();

  if (!cfg.gateway) return startMock(cfg);

  store.setConnection("connecting");
  try {
    const res = await fetch(`${cfg.gateway}/api/calls`, { method: "POST", signal: AbortSignal.timeout(3500) });
    if (!res.ok) throw new Error(`POST /api/calls → ${res.status}`);
    const body = (await res.json()) as { session_id?: string; id?: string };
    const id = body.session_id ?? body.id;
    if (!id) throw new Error("gateway did not return a session_id");
    liveSessionId = id;
    connect(cfg.gateway, id, cfg);
    // deterministic scenario on the backend; a live voice call would skip this
    if (new URLSearchParams(window.location.search).get("voice") !== "1") {
      await fetch(`${cfg.gateway}/api/calls/${id}/demo`, { method: "POST", signal: AbortSignal.timeout(3500) });
    }
  } catch {
    closedByUs = true;
    socket?.close();
    socket = null;
    liveSessionId = null;
    startMock(cfg, "Gateway");
  }
};

/** The human's decision. In live mode the gateway answers with approval.resolved; nothing is assumed locally. */
export const sendApproval = async (approved: boolean): Promise<void> => {
  const cfg = readConfig();
  if (liveSessionId && cfg.gateway) {
    try {
      const res = await fetch(`${cfg.gateway}/api/calls/${liveSessionId}/approval`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approved, reviewer: "Supervisor console" }),
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      useAura.getState().setConnection("offline");
    }
    return;
  }
  mockPlayer.resolveApproval(approved);
};
