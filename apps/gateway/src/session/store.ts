import { randomUUID } from "node:crypto";
import type {
  EchoEvent,
  IncidentState,
  UnsequencedEvent,
} from "@echo/contracts";

export interface PendingApproval {
  approval_id: string;
  /** The tool that runs on approval, verbatim from the intelligence proposal. */
  tool: { name: string; arguments: Record<string, unknown> };
  summary: string;
  unit_id: string;
  route_id: string;
  requested_at: string;
  resolved: boolean;
}

export interface Session {
  session_id: string;
  created_at: string;
  caller_label: string;
  caller_number: string;
  language: string;
  channel: string;
  status: "active" | "ended";
  /** Authoritative incident state; round-tripped into every analyze call. */
  state: IncidentState | null;
  /** Concatenated per-turn explanations, fed back as `conversation_summary`. */
  summaryParts: string[];
  log: EchoEvent[];
  sequence: number;
  approvals: Map<string, PendingApproval>;
  /** Monotonic turn counter. A turn is stale once `latestTurn` moves past it. */
  turnCounter: number;
  latestTurn: string | null;
  /** Consecutive turns the intelligence service answered from its fallback path. */
  fallbackStreak: number;
  degraded: boolean;
  agentSpeaking: boolean;
  /** Cleared on reset so a re-run of the demo cannot animate a stale dispatch. */
  dispatchTimer: NodeJS.Timeout | null;
  /** A scripted run waiting to be stepped, for presenter-driven demos. */
  demo: { script: { text: string; note: string }[]; cursor: number } | null;
}

/** The frontend's call/incident ids are derived from the session id, not invented. */
export function callIdFor(sessionId: string): string {
  return `call-${sessionId}`;
}

export function incidentIdFor(sessionId: string): string {
  return `INC-${sessionId}`;
}

export interface CreateSessionInput {
  session_id?: string;
  caller_label?: string;
  caller_number?: string;
  language?: string;
  channel?: string;
}

/**
 * In-memory session registry.
 *
 * Deliberately not a database: a hackathon demo must survive a laptop, not a
 * datacentre. The append-only `log` is what makes reconnects and replay work, and
 * it is the only thing a persistence layer would ever need to write.
 */
export class SessionStore {
  private readonly sessions = new Map<string, Session>();

  constructor(private readonly now: () => Date = () => new Date()) {}

  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  get(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  list(): Session[] {
    return [...this.sessions.values()];
  }

  create(input: CreateSessionInput = {}): Session {
    const sessionId = input.session_id?.trim() || `call_${randomUUID().slice(0, 8)}`;
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;

    const session: Session = {
      session_id: sessionId,
      created_at: this.now().toISOString(),
      caller_label: input.caller_label ?? "caller",
      caller_number: input.caller_number ?? "+1 (415) 555-0163",
      language: input.language ?? "en",
      channel: input.channel ?? "voice",
      status: "active",
      state: null,
      summaryParts: [],
      log: [],
      sequence: 0,
      approvals: new Map(),
      turnCounter: 0,
      latestTurn: null,
      fallbackStreak: 0,
      degraded: false,
      agentSpeaking: false,
      dispatchTimer: null,
      demo: null,
    };
    this.sessions.set(sessionId, session);
    return session;
  }

  /**
   * Wipe a session back to its opening state, keeping the id.
   *
   * The frontend connects to a fixed session id, so the demo is re-run against
   * the same socket over and over. Everything derived from the previous run —
   * event log, sequence, approvals, in-flight dispatch animation — has to go, or
   * the second run replays the first one's ghosts.
   */
  reset(sessionId: string): Session {
    const previous = this.sessions.get(sessionId);
    if (previous?.dispatchTimer) clearInterval(previous.dispatchTimer);
    this.sessions.delete(sessionId);
    return this.create({
      session_id: sessionId,
      caller_label: previous?.caller_label,
      caller_number: previous?.caller_number,
      language: previous?.language,
      channel: previous?.channel,
    });
  }

  /** Stamp a producer's event with this session's next sequence and store it. */
  append(session: Session, event: UnsequencedEvent): EchoEvent {
    session.sequence += 1;
    const sealed: EchoEvent = {
      event_id: event.event_id || `evt_${randomUUID()}`,
      session_id: session.session_id,
      type: event.type,
      timestamp: event.timestamp || this.now().toISOString(),
      sequence: session.sequence,
      payload: event.payload ?? {},
    };
    session.log.push(sealed);
    return sealed;
  }

  /** Open a new turn, superseding whatever was in flight. */
  beginTurn(session: Session): string {
    session.turnCounter += 1;
    const turnId = `turn_${session.turnCounter}`;
    session.latestTurn = turnId;
    return turnId;
  }

  /** A turn is stale the moment a newer one opens; its reply must be discarded. */
  isCurrentTurn(session: Session, turnId: string): boolean {
    return session.latestTurn === turnId;
  }
}
