/**
 * In-browser mock of the gateway + voice pipeline + intelligence service.
 *
 * Produces exactly the envelopes the real backend will stream, so the UI is
 * built once against the contract. Everything is deterministic: the scripted
 * call, the protocol engine, the simulated tools and the approval gate.
 */
import {
  IncidentState,
  PAYLOAD_SCHEMAS,
  createInitialState,
  parseEvent,
  type ApprovalRequestedPayload,
  type DispatchProposedPayload,
  type EventType,
  type PayloadOf,
  type ProposedTool,
  type Speaker,
  type TypedEvent,
} from "../contracts/index.ts";
import type { ApprovalBody, ConnectionStatus, CreateCallBody, DemoOptions, Transport } from "../lib/transport.ts";
import { analyzeUtterance, cadId, fnv1a, specialistId } from "./engine.ts";
import { AMBIENT_INCIDENTS, DEFAULT_SCENARIO_ID, SCENARIOS, fillTemplate, type Scenario, type ScenarioCaller, type ScenarioTurn } from "./scenario.ts";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)));

function chunkWords(text: string): string[] {
  return text.trim().split(/\s+/).filter(Boolean);
}

function estimateSpeechMs(text: string, wordsPerMinute = 160): number {
  const words = chunkWords(text).length;
  const pauses = (text.match(/[,.;:?!]/g) ?? []).length;
  return Math.round(words * (60_000 / wordsPerMinute) + pauses * 180 + 450);
}

function fakeAudioLevel(tick: number, seed = 0): number {
  const a = Math.sin(tick * 0.9 + seed) * 0.5 + 0.5;
  const b = Math.sin(tick * 2.3 + seed * 1.7) * 0.5 + 0.5;
  return Math.min(1, Math.max(0.05, Number((0.25 + 0.55 * (a * 0.6 + b * 0.4)).toFixed(3))));
}

class CancelledError extends Error {}

interface AgentLine {
  utterance_id: string;
  text: string;
  started_at: number;
  estimated_ms: number;
  interrupted: boolean;
  completed: boolean;
  done: Promise<void>;
  resolve: () => void;
  timer: ReturnType<typeof setTimeout> | null;
  levelTimer: ReturnType<typeof setInterval> | null;
}

interface MockSession {
  id: string;
  kind: "focus" | "ambient";
  caller: ScenarioCaller;
  started: boolean;
  state: IncidentState;
  sequence: number;
  agent: AgentLine | null;
  pending: { action_id: string; payload: ApprovalRequestedPayload } | null;
  demo: { scenario: Scenario; mode: "auto" | "manual"; pace: number } | null;
  run: DemoRun | null;
  utteranceCounter: number;
  turnLock: Promise<unknown>;
}

export class MockTransport implements Transport {
  readonly kind = "mock" as const;
  readonly label = "built-in mock stream";
  readonly capabilities = { advance: true, reset: true, ambient: true, ack: true };

  private readonly sessions = new Map<string, MockSession>();
  private counter = 0;
  private onEvents: ((events: TypedEvent[]) => void) | null = null;
  private queue: TypedEvent[] = [];
  private scheduled = false;

  connect(onEvents: (events: TypedEvent[]) => void, onStatus: (status: ConnectionStatus) => void): () => void {
    this.onEvents = onEvents;
    onStatus("connecting");
    setTimeout(() => onStatus("open"), 120);
    return () => {
      this.onEvents = null;
    };
  }

  // ------------------------------------------------------------------ REST-equivalents

  async createCall(body: CreateCallBody = {}): Promise<{ session_id: string }> {
    const session = this.create({ caller: { label: body.caller_label, language: body.language, channel: body.channel } });
    return { session_id: session.id };
  }

  async startDemo(sessionId: string, options: DemoOptions): Promise<void> {
    const session = this.require(sessionId);
    if (session.run && !session.run.finished) throw new Error("a demo is already running for this call");
    const scenario = SCENARIOS[options.scenario ?? DEFAULT_SCENARIO_ID];
    if (!scenario) throw new Error(`unknown scenario ${options.scenario}`);
    session.demo = { scenario, mode: options.mode, pace: options.pace > 0 ? options.pace : 1 };
    session.run = new DemoRun(this, session, scenario, options);
    session.run.start();
  }

  async advance(sessionId: string): Promise<void> {
    this.require(sessionId).run?.advance();
  }

  async utterance(sessionId: string, text: string): Promise<void> {
    const session = this.require(sessionId);
    await this.handleUtterance(session, text, { confidence: 1 });
  }

  async approval(sessionId: string, body: ApprovalBody): Promise<void> {
    await this.resolveApproval(this.require(sessionId), body);
  }

  async agentDone(sessionId: string, utteranceId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    const agent = session?.agent;
    if (session && agent && !agent.completed && agent.utterance_id === utteranceId) this.completeAgent(session, agent);
  }

  async reset(): Promise<void> {
    for (const session of this.sessions.values()) {
      session.run?.stop();
      if (session.agent) this.completeAgent(session, session.agent, true);
    }
    this.sessions.clear();
    this.counter = 0;
    this.emitGlobal("system.reset", { reason: "demo_reset" });
  }

  // ------------------------------------------------------------------ sessions & bus

  create(options: { session_id?: string; caller?: Partial<ScenarioCaller>; kind?: "focus" | "ambient"; state?: Partial<IncidentState> }): MockSession {
    let id = options.session_id;
    if (!id) {
      do {
        this.counter += 1;
        id = `call_${String(this.counter).padStart(3, "0")}`;
      } while (this.sessions.has(id));
    }
    const now = new Date();
    const session: MockSession = {
      id,
      kind: options.kind ?? "focus",
      caller: {
        label: options.caller?.label ?? `Caller ${String(1000 + (fnv1a(id) % 9000))}`,
        language: options.caller?.language ?? "en-US",
        channel: options.caller?.channel ?? "overflow",
      },
      started: false,
      state: createInitialState(id, now),
      sequence: 0,
      agent: null,
      pending: null,
      demo: null,
      run: null,
      utteranceCounter: 0,
      turnLock: Promise.resolve(),
    };
    if (options.state) session.state = IncidentState.parse({ ...session.state, ...options.state, session_id: id, updated_at: now.toISOString() });
    this.sessions.set(id, session);
    return session;
  }

  has(id: string): boolean {
    return this.sessions.has(id);
  }

  private require(id: string): MockSession {
    const session = this.sessions.get(id);
    if (!session) throw new Error(`call ${id} not found`);
    return session;
  }

  nextUtteranceId(session: MockSession, speaker: Speaker): string {
    session.utteranceCounter += 1;
    return `utt_${speaker === "agent" ? "a" : "c"}_${String(session.utteranceCounter).padStart(3, "0")}`;
  }

  emit<T extends EventType>(session: MockSession, type: T, payload: PayloadOf<T>): void {
    const validated = PAYLOAD_SCHEMAS[type].parse(payload) as Record<string, unknown>;
    session.sequence += 1;
    this.dispatch({
      event_id: `evt_${fnv1a(`${session.id}:${session.sequence}:${type}`).toString(16)}${session.sequence}`,
      session_id: session.id,
      type,
      timestamp: new Date().toISOString(),
      sequence: session.sequence,
      payload: validated,
    });
  }

  private emitGlobal<T extends EventType>(type: T, payload: PayloadOf<T>): void {
    this.dispatch({
      event_id: `evt_global_${Date.now()}`,
      session_id: "*",
      type,
      timestamp: new Date().toISOString(),
      sequence: 0,
      payload: PAYLOAD_SCHEMAS[type].parse(payload) as Record<string, unknown>,
    });
  }

  private dispatch(raw: Record<string, unknown>): void {
    const parsed = parseEvent(raw);
    if (!parsed.ok) throw new Error(`mock produced an invalid event: ${parsed.error}`);
    this.queue.push(parsed.event);
    if (!this.scheduled) {
      this.scheduled = true;
      setTimeout(() => {
        this.scheduled = false;
        const batch = this.queue;
        this.queue = [];
        this.onEvents?.(batch);
      }, 0);
    }
  }

  // ------------------------------------------------------------------ conversation

  ensureStarted(session: MockSession): void {
    if (session.started) return;
    session.started = true;
    this.emit(session, "call.started", {
      caller_label: session.caller.label,
      language: session.caller.language,
      channel: session.caller.channel,
      kind: session.kind,
      started_at: new Date().toISOString(),
    });
    this.emit(session, "incident.updated", session.state);
  }

  pace(session: MockSession): number {
    return session.demo?.pace ?? 1;
  }

  lines(session: MockSession) {
    return (session.demo?.scenario ?? SCENARIOS[DEFAULT_SCENARIO_ID]!).lines;
  }

  speak(session: MockSession, text: string): AgentLine {
    this.ensureStarted(session);
    if (session.agent && !session.agent.completed) this.interruptAgent(session, "superseded");
    const utterance_id = this.nextUtteranceId(session, "agent");
    const pace = this.pace(session);
    const estimated_ms = Math.max(250, Math.round(estimateSpeechMs(text) / pace));
    let resolve: () => void = () => undefined;
    const done = new Promise<void>((r) => {
      resolve = r;
    });
    const agent: AgentLine = { utterance_id, text, started_at: Date.now(), estimated_ms, interrupted: false, completed: false, done, resolve, timer: null, levelTimer: null };
    session.agent = agent;
    this.emit(session, "agent.speaking", { text, active: true, utterance_id, estimated_duration_ms: estimated_ms });
    let tick = 0;
    agent.levelTimer = setInterval(() => {
      tick += 1;
      this.emit(session, "audio.level", { level: fakeAudioLevel(tick, 3), speaker: "agent" });
    }, 120);
    agent.timer = setTimeout(() => this.completeAgent(session, agent), Math.round(estimated_ms * 1.5 + 800 / pace));
    return agent;
  }

  interruptAgent(session: MockSession, reason: string): boolean {
    const agent = session.agent;
    if (!agent || agent.completed) return false;
    agent.interrupted = true;
    this.emit(session, "agent.interrupted", { interrupted_text: agent.text, reason, utterance_id: agent.utterance_id });
    this.completeAgent(session, agent);
    return true;
  }

  private completeAgent(session: MockSession, agent: AgentLine, silent = false): void {
    if (agent.completed) return;
    agent.completed = true;
    if (agent.timer) clearTimeout(agent.timer);
    if (agent.levelTimer) clearInterval(agent.levelTimer);
    if (!silent) this.emit(session, "agent.speaking", { text: agent.text, active: false, utterance_id: agent.utterance_id });
    if (session.agent === agent) session.agent = null;
    agent.resolve();
  }

  handleUtterance(session: MockSession, text: string, options: { utterance_id?: string; confidence?: number; final_emitted?: boolean }): Promise<AgentLine | null> {
    const run = session.turnLock.then(() => this.runTurn(session, text, options));
    session.turnLock = run.catch(() => undefined);
    return run;
  }

  private async runTurn(session: MockSession, text: string, options: { utterance_id?: string; confidence?: number; final_emitted?: boolean }): Promise<AgentLine | null> {
    this.ensureStarted(session);
    const utterance_id = options.utterance_id ?? this.nextUtteranceId(session, "caller");
    if (session.agent && !session.agent.completed) this.interruptAgent(session, "caller_barge_in");
    if (!options.final_emitted) this.emit(session, "transcript.final", { text, speaker: "caller", confidence: options.confidence ?? 0.9, utterance_id });

    this.emit(session, "analysis.started", { utterance_id, text });
    const started = performance.now();
    // simulated model latency so the reasoning state is visible
    await sleep(380 + (fnv1a(`${session.id}:${utterance_id}`) % 420));
    const result = analyzeUtterance(session.state, text, new Date());
    session.state = result.state;

    let dispatch: DispatchProposedPayload | null = null;
    for (const event of result.events) {
      this.emit(session, event.type, event.payload as never);
      if (event.type === "dispatch.proposed") dispatch = event.payload as DispatchProposedPayload;
    }
    const latency = Math.round(performance.now() - started);
    this.emit(session, "analysis.completed", {
      utterance_id,
      confidence: result.confidence,
      explanation: result.explanation,
      next_response: result.next_response,
      protocol_transition: result.protocol_transition,
      proposed_tools: result.proposed_tools,
      meta: {
        model: "mock-stream",
        model_latency_ms: latency,
        source: "mock",
        validation: "ok",
        attempts: 1,
        triggers_matched: result.triggers,
        rejected: [],
        total_latency_ms: latency + 2,
      },
      degraded: false,
    });
    if (dispatch) this.requestApproval(session, dispatch, result.proposed_tools);
    return result.next_response ? this.speak(session, result.next_response) : null;
  }

  private requestApproval(session: MockSession, dispatch: DispatchProposedPayload, proposed: ProposedTool[]): void {
    const primary = dispatch.units[0];
    const summary = [
      `Dispatch ${dispatch.services.join(" + ")}`,
      primary ? `${primary.unit_id} (${primary.type})` : null,
      dispatch.route ? `ETA ${dispatch.route.eta_minutes} min` : null,
      session.state.location.normalized ? `to ${session.state.location.normalized}` : null,
    ]
      .filter(Boolean)
      .join(" - ");
    const payload: ApprovalRequestedPayload = {
      action_id: dispatch.action_id,
      action: "dispatch",
      summary,
      risk: session.state.priority === "critical" ? "critical" : session.state.priority === "high" ? "high" : "medium",
      timeout_s: 120,
      services: dispatch.services,
      units: dispatch.units,
      route: dispatch.route,
      reason: dispatch.reason,
      proposed_tools: proposed.filter((t) => t.human_required),
      requested_at: new Date().toISOString(),
    };
    session.pending = { action_id: dispatch.action_id, payload };
    this.emit(session, "approval.requested", payload);
  }

  private async resolveApproval(session: MockSession, body: ApprovalBody): Promise<void> {
    const pending = session.pending;
    if (!pending) throw new Error("nothing is awaiting approval for this call");
    if (body.action_id && body.action_id !== pending.action_id) throw new Error(`the pending action is ${pending.action_id}`);
    const reviewer = body.reviewer?.trim() || "dispatcher";
    session.pending = null;
    this.emit(session, "approval.resolved", { action_id: pending.action_id, approved: body.approved, reviewer, resolved_at: new Date().toISOString(), ...(body.note ? { note: body.note } : {}) });
    const lines = this.lines(session);

    if (!body.approved) {
      this.speak(session, lines.dispatch_rejected);
      return;
    }

    // the only path to a CAD record: explicit approval, tool by tool
    const executed: string[] = [];
    for (const tool of pending.payload.proposed_tools) {
      this.emit(session, "tool.started", { tool: tool.name, arguments: tool.arguments });
      await sleep(140);
      if (tool.name === "create_cad_draft") {
        const cad = cadId(session.id);
        const incidentType = session.state.assessment.breathing === "no" ? "MEDICAL - CARDIAC/RESPIRATORY ARREST, P1" : `${session.state.category.toUpperCase()} - ${session.state.assessment.chief_complaint ?? "unspecified"}`;
        this.emit(session, "tool.completed", {
          tool: tool.name,
          result_summary: `CAD draft ${cad} created (${incidentType})`,
          result: { cad_id: cad, incident_type: incidentType, units_assigned: session.state.response_plan?.units.slice(0, 1).map((u) => u.unit_id) ?? [], reviewer },
          duration_ms: 0.4,
        });
        if (session.state.response_plan) session.state.response_plan = { ...session.state.response_plan, cad_id: cad };
        session.state.status = "dispatched";
        session.state.human_required = false;
        session.state.summary = `Dispatch approved by ${reviewer}: ${incidentType}, ${session.state.response_plan?.units[0]?.unit_id ?? "units pending"} (${cad})`;
      } else if (tool.name === "request_specialist") {
        const type = String(tool.arguments.type ?? "specialist");
        const id = specialistId(session.id, type);
        this.emit(session, "tool.completed", { tool: tool.name, result_summary: `Specialist request ${id} queued (${type})`, result: { request_id: id, type, reviewer }, duration_ms: 0.3 });
        const fact = `specialist requested: ${type}`;
        if (!session.state.facts.includes(fact)) session.state.facts.push(fact);
      } else {
        this.emit(session, "tool.completed", { tool: tool.name, result_summary: `failed: unknown tool ${tool.name}`, result: null, duration_ms: 0 });
        continue;
      }
      executed.push(tool.name);
    }
    session.state.updated_at = new Date().toISOString();
    this.emit(session, "incident.updated", session.state);

    const plan = session.state.response_plan;
    const confirmed = this.speak(
      session,
      fillTemplate(lines.dispatch_confirmed, {
        unit_id: plan?.route?.unit_id ?? plan?.units[0]?.unit_id ?? "the closest unit",
        eta_minutes: plan?.route?.eta_minutes ?? plan?.units[0]?.eta_minutes ?? "a few",
        location_normalized: session.state.location.normalized ?? "your location",
      }),
    );
    if (executed.includes("request_specialist")) {
      void confirmed.done.then(() => {
        if (!confirmed.interrupted && session.agent === null) this.speak(session, lines.specialist_cpr);
      });
    }
  }
}

/** Plays the scripted call: ambient incidents, greeting, caller turns with STT partials, barge-in. */
class DemoRun {
  finished = false;
  private cancelled = false;
  private gate: (() => void) | null = null;
  private queuedAdvances = 0;
  private cancelResolve: () => void = () => undefined;
  private readonly cancelPromise = new Promise<void>((resolve) => {
    this.cancelResolve = resolve;
  });

  constructor(
    private readonly transport: MockTransport,
    private readonly session: MockSession,
    private readonly scenario: Scenario,
    private readonly options: DemoOptions,
  ) {}

  start(): void {
    void this.run().catch((error: unknown) => {
      if (!(error instanceof CancelledError)) console.error("[aura mock] demo run failed", error);
      this.finished = true;
    });
  }

  advance(): void {
    if (this.gate) {
      const gate = this.gate;
      this.gate = null;
      gate();
      return;
    }
    this.queuedAdvances += 1;
  }

  stop(): void {
    this.cancelled = true;
    this.cancelResolve();
    this.gate?.();
    this.gate = null;
    this.finished = true;
  }

  private async run(): Promise<void> {
    const { session, scenario, options, transport } = this;
    if (options.ambient) {
      for (const fixture of AMBIENT_INCIDENTS) {
        if (transport.has(fixture.session_id)) continue;
        const ambient = transport.create({ session_id: fixture.session_id, caller: fixture.caller, kind: "ambient", state: fixture.state });
        transport.ensureStarted(ambient);
        await this.wait(650);
      }
    }
    await this.wait(600);
    transport.ensureStarted(session);
    await this.wait(500);
    transport.speak(session, scenario.greeting);

    for (const turn of scenario.turns) {
      if (options.mode === "manual") {
        await this.waitForAdvance();
      } else if (turn.barge_in && session.agent && !session.agent.completed) {
        const agent = session.agent;
        await this.waitRaw(agent.started_at + agent.estimated_ms * (turn.barge_in_at ?? 0.4) - Date.now());
      } else {
        await this.waitAgentDone();
        await this.wait(turn.pause_before_ms);
      }
      this.throwIfCancelled();
      const utterance_id = transport.nextUtteranceId(session, "caller");
      if (session.agent && !session.agent.completed) transport.interruptAgent(session, "caller_barge_in");
      await this.streamCallerSpeech(turn, utterance_id);
      transport.emit(session, "transcript.final", { text: turn.utterance, speaker: "caller", confidence: 0.93, utterance_id });
      await transport.handleUtterance(session, turn.utterance, { utterance_id, confidence: 0.93, final_emitted: true });
      this.throwIfCancelled();
    }
    this.finished = true;
  }

  private async streamCallerSpeech(turn: ScenarioTurn, utterance_id: string): Promise<void> {
    const words = chunkWords(turn.utterance);
    for (let i = 0; i < words.length; i += 1) {
      this.transport.emit(this.session, "audio.level", { level: fakeAudioLevel(i, 1), speaker: "caller" });
      this.transport.emit(this.session, "transcript.partial", {
        text: words.slice(0, i + 1).join(" "),
        speaker: "caller",
        confidence: Math.min(0.95, 0.55 + 0.4 * ((i + 1) / words.length)),
        utterance_id,
      });
      await this.wait(turn.ms_per_word * (0.75 + ((i * 7919) % 50) / 100));
    }
    this.transport.emit(this.session, "audio.level", { level: 0.05, speaker: "caller" });
  }

  private async waitAgentDone(): Promise<void> {
    const agent = this.session.agent;
    if (!agent || agent.completed) return;
    await Promise.race([agent.done, this.cancelPromise]);
    this.throwIfCancelled();
  }

  private waitForAdvance(): Promise<void> {
    if (this.queuedAdvances > 0) {
      this.queuedAdvances -= 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.gate = resolve;
    }).then(() => this.throwIfCancelled());
  }

  private wait(ms: number): Promise<void> {
    return this.waitRaw(ms / (this.options.pace > 0 ? this.options.pace : 1));
  }

  private async waitRaw(ms: number): Promise<void> {
    this.throwIfCancelled();
    if (ms > 0) await Promise.race([sleep(ms), this.cancelPromise]);
    this.throwIfCancelled();
  }

  private throwIfCancelled(): void {
    if (this.cancelled) throw new CancelledError("cancelled");
  }
}
