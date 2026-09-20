import type { TypedEvent } from "../contracts/index.ts";

export type ConnectionStatus = "connecting" | "open" | "closed";

export interface DemoOptions {
  scenario?: string;
  mode: "auto" | "manual";
  pace: number;
  ambient: boolean;
}

export interface ApprovalBody {
  action_id?: string;
  approved: boolean;
  reviewer?: string;
  note?: string;
}

export interface CreateCallBody {
  caller_label?: string;
  language?: string;
  channel?: string;
}

/**
 * Everything the command center needs from a backend. Two implementations:
 *
 * - `MockTransport` (default): the deterministic event stream the master plan
 *   tells the frontend to build against; runs entirely in the browser.
 * - `GatewayTransport`: the team gateway over the master-plan endpoints
 *   (`POST /api/calls`, `POST /api/calls/{id}/demo`, `WS /ws/calls/{id}`,
 *   `POST /api/calls/{id}/utterance`, `POST /api/calls/{id}/approval`).
 *
 * Select with `?transport=gateway` (or `VITE_TRANSPORT=gateway`).
 */
export interface Transport {
  readonly kind: "mock" | "gateway";
  readonly label: string;
  readonly capabilities: { advance: boolean; reset: boolean; ambient: boolean; ack: boolean };
  connect(onEvents: (events: TypedEvent[]) => void, onStatus: (status: ConnectionStatus) => void): () => void;
  createCall(body?: CreateCallBody): Promise<{ session_id: string }>;
  startDemo(sessionId: string, options: DemoOptions): Promise<void>;
  advance(sessionId: string): Promise<void>;
  utterance(sessionId: string, text: string): Promise<void>;
  approval(sessionId: string, body: ApprovalBody): Promise<void>;
  agentDone(sessionId: string, utteranceId: string): Promise<void>;
  reset(): Promise<void>;
}

export function transportModeFromEnvironment(): "mock" | "gateway" {
  const param = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("transport") : null;
  const env = (import.meta.env.VITE_TRANSPORT as string | undefined) ?? "mock";
  return (param ?? env) === "gateway" ? "gateway" : "mock";
}

export function gatewayBaseUrl(): string {
  const param = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("gateway") : null;
  return (param ?? (import.meta.env.VITE_GATEWAY_URL as string | undefined) ?? "").replace(/\/$/, "");
}
