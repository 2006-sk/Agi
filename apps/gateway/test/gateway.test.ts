import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";

import type { EchoEvent } from "@echo/contracts";
import { buildGateway, type EchoGateway } from "../src/app.js";
import { NullVoiceClient } from "../src/clients/voice.js";
import { config as baseConfig } from "../src/config.js";
import { FakeIntelligence } from "./helpers/fakeIntelligence.js";

const SESSION = "echo-demo-0197";

let gateway: EchoGateway;
let intelligence: FakeIntelligence;
let voice: NullVoiceClient;
let baseUrl: string;

async function start(fakeOptions = {}) {
  intelligence = new FakeIntelligence(fakeOptions);
  voice = new NullVoiceClient();
  gateway = await buildGateway({
    intelligence,
    voice,
    logger: false,
    config: { ...baseConfig, emitViewEvents: true, dispatchTravelMs: 300, dispatchTickMs: 60, degradeAfterFallbacks: 2 },
  });
  await gateway.app.listen({ port: 0, host: "127.0.0.1" });
  const address = gateway.app.server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
  return port;
}

async function post(path: string, body: unknown = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function get(path: string) {
  const response = await fetch(`${baseUrl}${path}`);
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

/** Collect frames from a deck socket until `settle` ms pass with no new frame. */
function collect(port: number, sessionId = SESSION) {
  const received: EchoEvent[] = [];
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws/calls/${sessionId}`);
  socket.on("message", (data) => received.push(JSON.parse(data.toString())));
  const open = new Promise<void>((resolve, reject) => {
    socket.on("open", () => resolve());
    socket.on("error", reject);
  });
  return {
    socket,
    received,
    open,
    async settle(ms = 150) {
      let last = -1;
      while (last !== received.length) {
        last = received.length;
        await new Promise((r) => setTimeout(r, ms));
      }
    },
    close() {
      socket.close();
    },
  };
}

function typesOf(events: EchoEvent[]): string[] {
  return events.map((e) => e.type);
}

beforeEach(async () => {
  await start();
});

afterEach(async () => {
  await gateway.app.close();
});

/* ------------------------------------------------------------------ */

describe("call lifecycle", () => {
  it("creates a call with the id the deck is already watching", async () => {
    const created = await post("/api/calls", { session_id: SESSION });
    expect(created.status).toBe(201);
    expect(created.body.session_id).toBe(SESSION);
    expect(created.body.ws).toBe(`/ws/calls/${SESSION}`);
  });

  it("resumes rather than duplicating when the same id is created twice", async () => {
    await post("/api/calls", { session_id: SESSION });
    const again = await post("/api/calls", { session_id: SESSION });
    expect(again.status).toBe(200);
    expect(again.body.resumed).toBe(true);
    expect(gateway.store.list()).toHaveLength(1);
  });

  it("opens with session.started at sequence 1 so the deck can reset cleanly", async () => {
    await post("/api/calls", { session_id: SESSION });
    const session = gateway.store.get(SESSION)!;
    expect(session.log[0]?.type).toBe("session.started");
    expect(session.log[0]?.sequence).toBe(1);
  });

  it("returns 404 for a session that was never opened", async () => {
    expect((await get("/api/calls/nope")).status).toBe(404);
  });
});

describe("event sequencing", () => {
  it("numbers every event contiguously from 1", async () => {
    await post("/api/calls", { session_id: SESSION });
    await post(`/api/calls/${SESSION}/utterance`, { text: "he has chest pain", source: "demo" });
    const session = gateway.store.get(SESSION)!;
    const sequences = session.log.map((e) => e.sequence);
    expect(sequences).toEqual(sequences.map((_, i) => i + 1));
  });

  it("gives every event a unique id", async () => {
    await post("/api/calls", { session_id: SESSION });
    await post(`/api/calls/${SESSION}/utterance`, { text: "he has chest pain", source: "demo" });
    const ids = gateway.store.get(SESSION)!.log.map((e) => e.event_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("emits a shared-name event once, carrying both vocabularies' fields", async () => {
    await post("/api/calls", { session_id: SESSION });
    await post(`/api/calls/${SESSION}/utterance`, { text: "he has chest pain", source: "demo" });
    const log = gateway.store.get(SESSION)!.log;
    const finals = log.filter((e) => e.type === "transcript.final" && e.payload.speaker === "caller");
    expect(finals).toHaveLength(1);
    // Canonical fields and deck fields on the same event.
    expect(finals[0]?.payload.confidence).toBeDefined();
    expect(finals[0]?.payload.call_id).toBe(`call-${SESSION}`);
    expect(finals[0]?.payload.turn_id).toBeDefined();
  });

  it("puts the canonical event before the deck events it implies", async () => {
    await post("/api/calls", { session_id: SESSION });
    await post(`/api/calls/${SESSION}/utterance`, { text: "he has chest pain", source: "demo" });
    const log = gateway.store.get(SESSION)!.log;
    const canonical = log.findIndex((e) => e.type === "incident.updated");
    const derived = log.findIndex((e) => e.type === "incident.classified");
    expect(canonical).toBeGreaterThanOrEqual(0);
    expect(derived).toBeGreaterThan(canonical);
  });
});

describe("websocket delivery", () => {
  it("streams live events to a connected deck", async () => {
    const port = Number(new URL(baseUrl).port);
    await post("/api/calls", { session_id: SESSION });
    const client = collect(port);
    await client.open;
    await client.settle();
    const before = client.received.length;

    await post(`/api/calls/${SESSION}/utterance`, { text: "he has chest pain", source: "demo" });
    await client.settle();

    expect(client.received.length).toBeGreaterThan(before);
    expect(typesOf(client.received)).toContain("incident.classified");
    client.close();
  });

  it("replays the whole log to a reconnecting deck, in order", async () => {
    const port = Number(new URL(baseUrl).port);
    await post("/api/calls", { session_id: SESSION });
    await post(`/api/calls/${SESSION}/utterance`, { text: "he has chest pain", source: "demo" });

    const client = collect(port);
    await client.open;
    await client.settle();

    const log = gateway.store.get(SESSION)!.log;
    expect(client.received).toHaveLength(log.length);
    expect(client.received.map((e) => e.sequence)).toEqual(log.map((e) => e.sequence));
    expect(client.received[0]?.type).toBe("session.started");
    client.close();
  });

  it("fans out to two decks at once", async () => {
    const port = Number(new URL(baseUrl).port);
    await post("/api/calls", { session_id: SESSION });
    const a = collect(port);
    const b = collect(port);
    await Promise.all([a.open, b.open]);
    await Promise.all([a.settle(), b.settle()]);

    await post(`/api/calls/${SESSION}/utterance`, { text: "he has chest pain", source: "demo" });
    await Promise.all([a.settle(), b.settle()]);

    expect(typesOf(a.received)).toEqual(typesOf(b.received));
    a.close();
    b.close();
  });

  it("opens the pinned demo session before any call exists", async () => {
    // The console may legitimately open this one early rather than race the
    // operator; `baseConfig.vapiSessionId` is that id.
    const port = Number(new URL(baseUrl).port);
    const client = collect(port, baseConfig.vapiSessionId);
    await client.open;
    await client.settle();
    expect(client.received[0]?.type).toBe("session.started");
    client.close();
  });

  it("refuses a socket for a session that does not exist", async () => {
    // A stale browser tab retrying an id from a previous run must not be able
    // to resurrect it as a phantom incident on the dashboard.
    const port = Number(new URL(baseUrl).port);
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws/calls/ghost-from-a-past-run`);
    const code = await new Promise<number>((resolve) => {
      socket.on("close", (c) => resolve(c));
      socket.on("error", () => resolve(-1));
    });
    expect(code).toBe(4404);
    expect(gateway.store.has("ghost-from-a-past-run")).toBe(false);
  });

});

describe("human approval gate", () => {
  async function driveToGate() {
    await post("/api/calls", { session_id: SESSION });
    await post(`/api/calls/${SESSION}/utterance`, { text: "he has chest pain", source: "demo" });
    await post(`/api/calls/${SESSION}/utterance`, { text: "we are at 170 St. Germain Avenue", source: "demo" });
    await post(`/api/calls/${SESSION}/utterance`, { text: "wait, he stopped breathing", source: "demo" });
  }

  it("raises approval.requested carrying the proposal's own action id", async () => {
    await driveToGate();
    const log = gateway.store.get(SESSION)!.log;
    const proposed = log.find((e) => e.type === "dispatch.proposed");
    const requested = log.find((e) => e.type === "approval.requested");
    expect(requested).toBeDefined();
    expect(requested?.payload.approval_id).toBe(proposed?.payload.action_id);
    // Both vocabularies on one event.
    expect(requested?.payload.risk).toBe("high");
    expect(requested?.payload.summary).toContain("M-20");
  });

  it("does not run the consequential tool before a human decides", async () => {
    await driveToGate();
    expect(intelligence.toolCalls).toHaveLength(0);
    expect(gateway.store.get(SESSION)!.state?.status).toBe("awaiting_approval");
  });

  it("runs the CAD tool with approved:true only after approval", async () => {
    await driveToGate();
    const result = await post(`/api/calls/${SESSION}/approval`, {
      approved: true,
      reviewer: "shresth",
    });
    expect(result.status).toBe(200);
    expect(intelligence.toolCalls).toHaveLength(1);
    expect(intelligence.toolCalls[0]?.tool.name).toBe("create_cad_draft");
    expect(intelligence.toolCalls[0]?.approved).toBe(true);
    expect(intelligence.toolCalls[0]?.reviewer).toBe("shresth");
    expect(gateway.store.get(SESSION)!.state?.status).toBe("dispatched");
  });

  it("never dispatches on rejection", async () => {
    await driveToGate();
    await post(`/api/calls/${SESSION}/approval`, { approved: false, reason: "address unclear" });
    expect(intelligence.toolCalls).toHaveLength(0);
    expect(gateway.store.get(SESSION)!.state?.status).toBe("awaiting_approval");
    const log = gateway.store.get(SESSION)!.log;
    expect(typesOf(log)).toContain("approval.rejected");
    expect(typesOf(log)).not.toContain("dispatch.started");
  });

  it("refuses a second decision on the same approval", async () => {
    await driveToGate();
    await post(`/api/calls/${SESSION}/approval`, { approved: true });
    const again = await post(`/api/calls/${SESSION}/approval`, { approved: true });
    expect(again.status).toBe(409);
    expect(again.body.error).toBe("already_resolved");
    expect(intelligence.toolCalls).toHaveLength(1);
  });

  it("rejects an approval when nothing is pending", async () => {
    await post("/api/calls", { session_id: SESSION });
    const result = await post(`/api/calls/${SESSION}/approval`, { approved: true });
    expect(result.status).toBe(409);
    expect(result.body.error).toBe("no_pending_approval");
  });

  it("withholds the gate when the address was never verified", async () => {
    await post("/api/calls", { session_id: SESSION });
    await post(`/api/calls/${SESSION}/utterance`, {
      text: "someone collapsed near the park and he stopped breathing",
      source: "demo",
    });
    const log = gateway.store.get(SESSION)!.log;
    expect(typesOf(log)).toContain("incident.updated");
    expect(typesOf(log)).not.toContain("approval.requested");
    expect(gateway.store.get(SESSION)!.state?.priority).toBe("critical");
  });

  it("accepts the operator's decision over the websocket", async () => {
    const port = Number(new URL(baseUrl).port);
    await driveToGate();
    const approvalId = [...gateway.store.get(SESSION)!.approvals.keys()][0]!;

    const client = collect(port);
    await client.open;
    await client.settle();
    client.socket.send(
      JSON.stringify({
        type: "operator.decision",
        payload: { kind: "approval", approval_id: approvalId, decision: "granted", reason: "" },
      }),
    );
    await client.settle(250);

    expect(intelligence.toolCalls).toHaveLength(1);
    expect(typesOf(client.received)).toContain("approval.granted");
    client.close();
  });

  it("ignores junk sent up the operator socket", async () => {
    const port = Number(new URL(baseUrl).port);
    await driveToGate();
    const client = collect(port);
    await client.open;
    await client.settle();

    client.socket.send("not json");
    client.socket.send(JSON.stringify({ type: "nonsense" }));
    await client.settle();

    expect(intelligence.toolCalls).toHaveLength(0);
    expect(client.socket.readyState).toBe(WebSocket.OPEN);
    client.close();
  });

  it("animates the responder only after approval, ending at arrival", async () => {
    const port = Number(new URL(baseUrl).port);
    await driveToGate();
    const client = collect(port);
    await client.open;
    await client.settle();
    expect(typesOf(client.received)).not.toContain("dispatch.started");

    await post(`/api/calls/${SESSION}/approval`, { approved: true });
    await client.settle(250);

    const types = typesOf(client.received);
    expect(types).toContain("dispatch.started");
    expect(types).toContain("dispatch.progress");
    expect(types).toContain("dispatch.arrived");

    const progress = client.received
      .filter((e) => e.type === "dispatch.progress")
      .map((e) => Number(e.payload.progress));
    expect(progress.at(-1)).toBe(1);
    // Progress never moves backwards.
    expect([...progress].sort((a, b) => a - b)).toEqual(progress);
    client.close();
  });

  it("reports a failed dispatch instead of pretending it worked", async () => {
    await driveToGate();
    intelligence.options.failAnalyze = false;
    // Make the gated tool itself fail.
    intelligence.executeTool = async () => {
      throw Object.assign(new Error("boom"), { status: 500 });
    };
    await post(`/api/calls/${SESSION}/approval`, { approved: true });

    const log = gateway.store.get(SESSION)!.log;
    const failure = log.find(
      (e) => e.type === "tool.completed" && String(e.payload.result_summary).startsWith("failed:"),
    );
    expect(failure).toBeDefined();
    expect(typesOf(log)).toContain("system.degraded");
    expect(typesOf(log)).not.toContain("dispatch.started");
  });
});

describe("turn handling", () => {
  it("round-trips the previous state into the next analysis", async () => {
    await post("/api/calls", { session_id: SESSION });
    await post(`/api/calls/${SESSION}/utterance`, { text: "he has chest pain", source: "demo" });
    await post(`/api/calls/${SESSION}/utterance`, { text: "we are at 170 St. Germain Avenue", source: "demo" });

    expect(intelligence.analyzeCalls[0]?.current_state).toEqual({});
    const second = intelligence.analyzeCalls[1]?.current_state as Record<string, unknown>;
    expect(second.category).toBe("medical");
    expect(second.protocol).toMatchObject({ id: "MED_CARDIAC_01" });
  });

  it("passes a conversation summary built from prior explanations", async () => {
    await post("/api/calls", { session_id: SESSION });
    await post(`/api/calls/${SESSION}/utterance`, { text: "he has chest pain", source: "demo" });
    await post(`/api/calls/${SESSION}/utterance`, { text: "we are at 170 St. Germain Avenue", source: "demo" });
    expect(intelligence.analyzeCalls[1]?.conversation_summary).toContain("Handled:");
  });

  it("serializes turns for one session instead of racing them", async () => {
    await start({ latencyMs: 60 });
    await post("/api/calls", { session_id: SESSION });
    await Promise.all([
      post(`/api/calls/${SESSION}/utterance`, { text: "he has chest pain", source: "demo" }),
      post(`/api/calls/${SESSION}/utterance`, { text: "we are at 170 St. Germain Avenue", source: "demo" }),
    ]);
    // The second analysis must have seen the first one's state.
    const second = intelligence.analyzeCalls[1]?.current_state as Record<string, unknown>;
    expect(second.category).toBe("medical");
  });

  it("keeps a superseded turn's facts but discards its reply", async () => {
    await start({ latencyMs: 80 });
    await post("/api/calls", { session_id: SESSION });
    const session = gateway.store.get(SESSION) ?? gateway.store.create({ session_id: SESSION });

    const first = gateway.orchestrator.submitUtterance(session, {
      text: "he has chest pain",
      speaker: "caller",
      language: "en",
      source: "demo",
    });
    // Open a newer turn while the first is still in the model.
    await new Promise((r) => setTimeout(r, 10));
    gateway.store.beginTurn(session);

    const result = await first;
    expect(result.superseded).toBe(true);
    expect(result.reply_text).toBeNull();
    // The facts it extracted still landed.
    expect(session.state?.category).toBe("medical");
  });

  it("speaks to the voice service for demo turns but not for voice turns", async () => {
    await post("/api/calls", { session_id: SESSION });
    await post(`/api/calls/${SESSION}/utterance`, { text: "he has chest pain", source: "demo" });
    expect(voice.spoken).toHaveLength(1);

    await post(`/api/calls/${SESSION}/utterance`, { text: "we are at 170 St. Germain Avenue", source: "voice" });
    // Still one: the voice bridge speaks the HTTP reply itself.
    expect(voice.spoken).toHaveLength(1);
  });

  it("does not republish a transcript the voice service already sent", async () => {
    await post("/api/calls", { session_id: SESSION });
    await post(`/api/calls/${SESSION}/utterance`, { text: "he has chest pain", source: "voice" });
    const finals = gateway.store
      .get(SESSION)!
      .log.filter((e) => e.type === "transcript.final" && e.payload.speaker === "caller");
    expect(finals).toHaveLength(0);
  });

  it("adopts an unknown session rather than dropping the caller's first words", async () => {
    const result = await post("/api/calls/walk-in/utterance", {
      text: "he has chest pain",
      source: "voice",
    });
    expect(result.status).toBe(200);
    expect(gateway.store.has("walk-in")).toBe(true);
  });

  it("cancels ECHO's speech when the caller barges in", async () => {
    await post("/api/calls", { session_id: SESSION });
    const session = gateway.store.get(SESSION)!;
    await post("/internal/voice-events", {
      session_id: SESSION,
      type: "agent.speaking",
      payload: { text: "Is he breathing normally?", active: true },
    });
    expect(session.agentSpeaking).toBe(true);

    await post(`/api/calls/${SESSION}/utterance`, { text: "wait, he stopped breathing", source: "voice" });
    expect(voice.cancelled).toHaveLength(1);
    expect(voice.cancelled[0]?.reason).toBe("barge_in");
  });
});

describe("voice fan-in", () => {
  it("sequences a voice event and stamps the deck's call id on it", async () => {
    await post("/api/calls", { session_id: SESSION });
    const result = await post("/internal/voice-events", {
      session_id: SESSION,
      type: "transcript.partial",
      payload: { speaker: "caller", text: "my father", confidence: 0.8, language: "en" },
    });
    expect(result.status).toBe(200);
    const partial = gateway.store.get(SESSION)!.log.find((e) => e.type === "transcript.partial");
    expect(partial?.payload.call_id).toBe(`call-${SESSION}`);
    expect(partial?.payload.text).toBe("my father");
  });

  it("turns an agent line into a deck transcript entry", async () => {
    await post("/api/calls", { session_id: SESSION });
    await post("/internal/voice-events", {
      session_id: SESSION,
      type: "agent.speaking",
      payload: { text: "What is the address?", active: true },
    });
    const log = gateway.store.get(SESSION)!.log;
    const echo = log.find((e) => e.type === "transcript.final" && e.payload.speaker === "echo");
    expect(echo?.payload.text).toBe("What is the address?");
  });

  it("refuses an event type the voice service has no business sending", async () => {
    await post("/api/calls", { session_id: SESSION });
    const result = await post("/internal/voice-events", {
      session_id: SESSION,
      type: "incident.updated",
      payload: { priority: "critical" },
    });
    expect(result.status).toBe(422);
  });

  it("rejects a malformed event", async () => {
    const result = await post("/internal/voice-events", { type: "audio.level" });
    expect(result.status).toBe(400);
  });

  it("degrades when the voice layer reports an unrecoverable error", async () => {
    await post("/api/calls", { session_id: SESSION });
    await post("/internal/voice-events", {
      session_id: SESSION,
      type: "voice.error",
      payload: { code: "gradium_disconnect", message: "closed", recoverable: false },
    });
    const log = gateway.store.get(SESSION)!.log;
    const degraded = log.find((e) => e.type === "system.degraded");
    expect(degraded?.payload.failed_dependency).toBe("gradium");
  });
});

describe("degraded modes", () => {
  it("keeps the call alive and says so when intelligence is unreachable", async () => {
    await start({ failAnalyze: true });
    await post("/api/calls", { session_id: SESSION });
    const result = await post(`/api/calls/${SESSION}/utterance`, {
      text: "he has chest pain",
      source: "demo",
    });

    expect(result.status).toBe(200);
    expect(result.body.reply_text).toContain("stay on the line");
    const log = gateway.store.get(SESSION)!.log;
    const degraded = log.find((e) => e.type === "system.degraded");
    expect(degraded?.payload.failed_dependency).toBe("intelligence");
  });

  it("raises system.degraded after two consecutive fallback turns, once", async () => {
    await start({ fallbackMode: true });
    await post("/api/calls", { session_id: SESSION });
    await post(`/api/calls/${SESSION}/utterance`, { text: "he has chest pain", source: "demo" });
    let log = gateway.store.get(SESSION)!.log;
    expect(typesOf(log)).not.toContain("system.degraded");

    await post(`/api/calls/${SESSION}/utterance`, { text: "we are at 170 St. Germain Avenue", source: "demo" });
    log = gateway.store.get(SESSION)!.log;
    expect(typesOf(log).filter((t) => t === "system.degraded")).toHaveLength(1);

    await post(`/api/calls/${SESSION}/utterance`, { text: "he is awake", source: "demo" });
    log = gateway.store.get(SESSION)!.log;
    expect(typesOf(log).filter((t) => t === "system.degraded")).toHaveLength(1);
  });

  it("reports health without blocking on a downstream service", async () => {
    const health = await get("/health");
    expect(health.status).toBe(200);
    expect(health.body.ok).toBe(true);
  });

  it("reports dependency health separately", async () => {
    const deps = await get("/health/deps");
    expect(deps.status).toBe(200);
    expect(deps.body.intelligence.ok).toBe(true);
  });
});

describe("reset", () => {
  it("restarts numbering and clears the incident so the demo can re-run", async () => {
    await post("/api/calls", { session_id: SESSION });
    await post(`/api/calls/${SESSION}/utterance`, { text: "he has chest pain", source: "demo" });
    expect(gateway.store.get(SESSION)!.sequence).toBeGreaterThan(2);

    const reset = await post(`/api/calls/${SESSION}/reset`);
    expect(reset.status).toBe(200);

    const session = gateway.store.get(SESSION)!;
    expect(session.log[0]?.type).toBe("session.started");
    expect(session.log[0]?.sequence).toBe(1);
    expect(session.state).toBeNull();
    expect(session.approvals.size).toBe(0);
  });

  it("forgets a previous run's approval", async () => {
    await post("/api/calls", { session_id: SESSION });
    await post(`/api/calls/${SESSION}/utterance`, { text: "he has chest pain", source: "demo" });
    await post(`/api/calls/${SESSION}/utterance`, { text: "we are at 170 St. Germain Avenue", source: "demo" });
    await post(`/api/calls/${SESSION}/utterance`, { text: "wait, he stopped breathing", source: "demo" });
    expect(gateway.store.get(SESSION)!.approvals.size).toBe(1);

    await post(`/api/calls/${SESSION}/reset`);
    const result = await post(`/api/calls/${SESSION}/approval`, { approved: true });
    expect(result.status).toBe(409);
  });
});

describe("scripted demo", () => {
  it("drives the cardiac scenario to the approval gate through the real pipeline", async () => {
    const result = await post(`/api/calls/${SESSION}/demo`, {
      scenario: "cardiac",
      await_completion: true,
      fast: true,
    });

    expect(result.status).toBe(200);
    expect(result.body.status).toBe("completed");
    expect(result.body.state.priority).toBe("critical");
    expect(result.body.pending_approvals).toHaveLength(1);

    const types = typesOf(gateway.store.get(SESSION)!.log);
    for (const expected of [
      "session.started",
      "call.incoming",
      "incident.classified",
      "location.verified",
      "protocol.activated",
      "incident.reclassified",
      "responders.available",
      "route.proposed",
      "dispatch.proposed",
      "approval.requested",
    ]) {
      expect(types, `missing ${expected}`).toContain(expected);
    }
  });

  it("returns immediately when not asked to wait", async () => {
    const result = await post(`/api/calls/${SESSION}/demo`, { scenario: "cardiac", fast: true });
    expect(result.status).toBe(202);
    expect(result.body.status).toBe("running");
  });

  it("holds the gate shut on the vague-address scenario", async () => {
    const result = await post(`/api/calls/${SESSION}/demo`, {
      scenario: "vague",
      await_completion: true,
      fast: true,
    });
    expect(result.body.pending_approvals).toHaveLength(0);
    expect(typesOf(gateway.store.get(SESSION)!.log)).not.toContain("approval.requested");
  });

  it("produces the same event sequence on three consecutive runs", async () => {
    const runs: string[][] = [];
    for (let i = 0; i < 3; i++) {
      await post(`/api/calls/${SESSION}/demo`, {
        scenario: "cardiac",
        await_completion: true,
        fast: true,
      });
      runs.push(typesOf(gateway.store.get(SESSION)!.log));
    }
    expect(runs[1]).toEqual(runs[0]);
    expect(runs[2]).toEqual(runs[0]);
  });
});
