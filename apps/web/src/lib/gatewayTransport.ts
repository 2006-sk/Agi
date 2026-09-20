import { parseEvent, type TypedEvent } from "../contracts/index.ts";
import type { ApprovalBody, ConnectionStatus, CreateCallBody, DemoOptions, Transport } from "./transport.ts";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * The team gateway (Shresth) over the master-plan endpoints. Events arrive on
 * `WS /ws/calls/{id}` per call; the additive routes (`/demo/advance`,
 * `/agent/done`, `/api/demo/reset`) are best-effort and ignored when absent.
 */
export class GatewayTransport implements Transport {
  readonly kind = "gateway" as const;
  readonly label: string;
  readonly capabilities = { advance: true, reset: true, ambient: false, ack: true };

  private onEvents: ((events: TypedEvent[]) => void) | null = null;
  private onStatus: ((status: ConnectionStatus) => void) | null = null;
  private sockets = new Map<string, WebSocket>();
  private attachTimer: ReturnType<typeof setInterval> | null = null;
  private queue: TypedEvent[] = [];
  private scheduled = false;
  private closed = false;

  constructor(private readonly baseUrl: string) {
    this.label = baseUrl || "gateway (same origin)";
  }

  connect(onEvents: (events: TypedEvent[]) => void, onStatus: (status: ConnectionStatus) => void): () => void {
    this.onEvents = onEvents;
    this.onStatus = onStatus;
    this.closed = false;
    setTimeout(() => onStatus("open"), 0);

    // Attach to whatever is already live, and keep watching for new calls.
    // An inbound phone call creates a session with nobody touching the UI; if
    // the console only subscribed to calls it created itself, the dashboard
    // would sit blank while someone was talking to the agent.
    void this.attachToLiveCalls();
    this.attachTimer = setInterval(() => void this.attachToLiveCalls(), 3000);

    return () => {
      this.closed = true;
      if (this.attachTimer) clearInterval(this.attachTimer);
      this.attachTimer = null;
      for (const socket of this.sockets.values()) socket.close();
      this.sockets.clear();
    };
  }

  /** Subscribe to every live call we are not already watching. */
  private async attachToLiveCalls(): Promise<void> {
    if (this.closed) return;
    try {
      const { sessions } = await this.request<{ sessions: { session_id: string }[] }>("GET", "/api/calls");
      for (const s of sessions) this.subscribe(s.session_id);
    } catch {
      // The gateway may not be up yet; the next tick tries again.
    }
  }

  async createCall(body: CreateCallBody = {}): Promise<{ session_id: string }> {
    const created = await this.request<{ session_id: string }>("POST", "/api/calls", body);
    this.subscribe(created.session_id);
    return created;
  }

  async startDemo(sessionId: string, options: DemoOptions): Promise<void> {
    await this.request("POST", `/api/calls/${sessionId}/demo`, options);
  }

  async advance(sessionId: string): Promise<void> {
    await this.request("POST", `/api/calls/${sessionId}/demo/advance`).catch(ignore404);
  }

  async utterance(sessionId: string, text: string): Promise<void> {
    // `source` tells the gateway nobody upstream published this line: it must
    // put the caller's words on the wire itself and speak the reply. Without
    // it the gateway assumes a voice producer already did both, and a typed
    // utterance lands silently.
    await this.request("POST", `/api/calls/${sessionId}/utterance`, { text, source: "operator" });
  }

  async approval(sessionId: string, body: ApprovalBody): Promise<void> {
    await this.request("POST", `/api/calls/${sessionId}/approval`, body);
  }

  async agentDone(sessionId: string, utteranceId: string): Promise<void> {
    await this.request("POST", `/api/calls/${sessionId}/agent/done`, { utterance_id: utteranceId }).catch(ignore404);
  }

  async reset(): Promise<void> {
    await this.request("POST", "/api/demo/reset").catch(ignore404);
    for (const socket of this.sockets.values()) socket.close();
    this.sockets.clear();
  }

  private subscribe(sessionId: string, since = 0): void {
    if (this.sockets.has(sessionId) || this.closed) return;
    const proto = this.baseUrl ? this.baseUrl.replace(/^http/, "ws") : `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}`;
    const socket = new WebSocket(`${proto}/ws/calls/${sessionId}?since=${since}`);
    let lastSequence = since;
    this.sockets.set(sessionId, socket);
    this.onStatus?.("connecting");
    socket.onopen = () => this.onStatus?.("open");
    socket.onmessage = (message) => {
      let raw: unknown;
      try {
        raw = JSON.parse(String(message.data));
      } catch {
        return;
      }
      const parsed = parseEvent(raw);
      if (!parsed.ok) {
        console.warn("[echo] dropped event:", parsed.error);
        return;
      }
      lastSequence = Math.max(lastSequence, parsed.event.sequence);
      this.queue.push(parsed.event);
      if (!this.scheduled) {
        this.scheduled = true;
        setTimeout(() => this.flush(), 0);
      }
    };
    socket.onclose = () => {
      this.sockets.delete(sessionId);
      if (this.closed) return;
      this.onStatus?.("closed");
      setTimeout(() => this.subscribe(sessionId, lastSequence), 1500);
    };
    socket.onerror = () => socket.close();
  }

  private flush(): void {
    this.scheduled = false;
    if (this.queue.length === 0) return;
    const batch = this.queue;
    this.queue = [];
    this.onEvents?.(batch);
  }

  private async request<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    const json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    if (!response.ok) throw new ApiError(response.status, String(json.error ?? "request_failed"), String(json.message ?? response.statusText));
    return json as T;
  }
}

function ignore404(error: unknown): void {
  if (error instanceof ApiError && error.status === 404) return;
  throw error;
}
