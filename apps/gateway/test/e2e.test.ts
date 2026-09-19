/**
 * End-to-end: the real gateway wired to Pranay's real intelligence service.
 *
 * Nothing is faked below the HTTP boundary — the actual protocol state machine,
 * the actual geocode tables, the actual 403 gate. The model is the deterministic
 * mock client by default (`USE_MOCK_MODEL=true`) so this runs offline and gives
 * the same answer every time; set `LIVE_MODEL_E2E=1` to point the same
 * assertions at General Compute instead.
 *
 * This is the test that backs the handoff's "done when" list: one command, a
 * stable ordered stream, a gate that cannot be walked around, and a golden path
 * that survives three consecutive runs.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";

import type { AuraEvent } from "@aura/contracts";
import { buildGateway, type AuraGateway } from "../src/app.js";
import { HttpIntelligenceClient } from "../src/clients/intelligence.js";
import { NullVoiceClient } from "../src/clients/voice.js";
import { config as baseConfig } from "../src/config.js";

const LIVE = process.env.LIVE_MODEL_E2E === "1";
const INTELLIGENCE_PORT = 8391;
const INTELLIGENCE_URL = `http://127.0.0.1:${INTELLIGENCE_PORT}`;
const SESSION = "aura-demo-0197";

const serviceDir = fileURLToPath(new URL("../../../services/intelligence", import.meta.url));

let child: ChildProcess;
let gateway: AuraGateway;
let voice: NullVoiceClient;
let baseUrl: string;
let port: number;

async function waitForHealth(url: string, timeoutMs = 60000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "never responded";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/internal/health`);
      if (response.ok) return;
      lastError = `status ${response.status}`;
    } catch (error) {
      lastError = (error as Error).message;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`intelligence service did not come up: ${lastError}`);
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

function typesOf(events: AuraEvent[]): string[] {
  return events.map((e) => e.type);
}

beforeAll(async () => {
  child = spawn("npx", ["tsx", "src/index.ts"], {
    cwd: serviceDir,
    env: {
      ...process.env,
      PORT: String(INTELLIGENCE_PORT),
      HOST: "127.0.0.1",
      LOG_LEVEL: "warn",
      USE_MOCK_MODEL: LIVE ? "false" : "true",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stderr?.on("data", (chunk) => {
    const line = chunk.toString();
    if (/error|ECONN|fatal/i.test(line)) process.stderr.write(`[intelligence] ${line}`);
  });

  await waitForHealth(INTELLIGENCE_URL);

  voice = new NullVoiceClient();
  gateway = await buildGateway({
    logger: false,
    voice,
    intelligence: new HttpIntelligenceClient(INTELLIGENCE_URL, LIVE ? 20000 : 9000),
    config: {
      ...baseConfig,
      intelligenceUrl: INTELLIGENCE_URL,
      dispatchTravelMs: 400,
      dispatchTickMs: 80,
    },
  });
  await gateway.app.listen({ port: 0, host: "127.0.0.1" });
  const address = gateway.app.server.address();
  port = typeof address === "object" && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}`;
}, 120000);

afterAll(async () => {
  await gateway?.app.close();
  child?.kill("SIGTERM");
});

/* ------------------------------------------------------------------ */

describe("service wiring", () => {
  it("reports both services from one health call", async () => {
    const response = await fetch(`${baseUrl}/health/deps`);
    const body = (await response.json()) as {
      intelligence: { ok: boolean; detail: { service: string } };
    };
    expect(body.intelligence.ok).toBe(true);
    expect(body.intelligence.detail.service).toBe("aura-intelligence");
  });
});

describe("the golden cardiac path", () => {
  it("runs end to end and stops at the human gate", async () => {
    const result = await post(`/api/calls/${SESSION}/demo`, {
      scenario: "cardiac",
      await_completion: true,
      fast: true,
    });

    expect(result.status).toBe(200);
    const state = result.body.state;

    // The incident went from nothing to a verified, structured, critical state.
    expect(state.category).toBe("medical");
    expect(state.priority).toBe("critical");
    expect(state.location.verified).toBe(true);
    expect(state.location.latitude).toBeCloseTo(37.754, 2);
    expect(state.protocol.step).toBe("human_dispatch_approval");
    expect(state.human_required).toBe(true);
    expect(state.status).toBe("awaiting_approval");

    // A tool actually proposed EMS and drew a route.
    expect(state.response_plan).toBeTruthy();
    expect(state.response_plan.units.length).toBeGreaterThan(0);
    expect(state.response_plan.route.polyline.length).toBeGreaterThan(1);
    expect(state.response_plan.cad_id).toBeNull();

    // And it is waiting for a human.
    expect(result.body.pending_approvals).toHaveLength(1);
  }, 120000);

  it("tells the deck the whole story, in order", async () => {
    await post(`/api/calls/${SESSION}/demo`, {
      scenario: "cardiac",
      await_completion: true,
      fast: true,
    });
    const log = gateway.store.get(SESSION)!.log;
    const types = typesOf(log);

    for (const expected of [
      "session.started",
      "call.incoming",
      "protocol.activated",
      "incident.classified",
      "location.verified",
      "fact.extracted",
      "tool.invoked",
      "tool.result",
      "responders.available",
      "route.proposed",
      "dispatch.proposed",
      "approval.requested",
    ]) {
      expect(types, `missing ${expected}`).toContain(expected);
    }

    // Sequencing guarantees the deck's ingest depends on.
    const sequences = log.map((e) => e.sequence);
    expect(sequences).toEqual(sequences.map((_, i) => i + 1));
    expect(new Set(log.map((e) => e.event_id)).size).toBe(log.length);
    expect(log[0]?.type).toBe("session.started");

    // The protocol was activated before any step was reported against it.
    expect(types.indexOf("protocol.activated")).toBeLessThan(types.indexOf("protocol.step"));
    // The gate came after the proposal it gates.
    expect(types.indexOf("dispatch.proposed")).toBeLessThan(types.indexOf("approval.requested"));
  }, 120000);

  it("escalates to critical on the scripted interruption", async () => {
    await post(`/api/calls/${SESSION}/reset`);
    await post(`/api/calls/${SESSION}/utterance`, {
      text: "Help, my father is clutching his chest and he can't breathe properly",
      source: "demo",
    });
    await post(`/api/calls/${SESSION}/utterance`, {
      text: "We're at 170 St. Germain Avenue",
      source: "demo",
    });

    const beforeSeq = gateway.store.get(SESSION)!.sequence;
    expect(gateway.store.get(SESSION)!.state?.priority).not.toBe("critical");

    await post(`/api/calls/${SESSION}/utterance`, {
      text: "Wait, he stopped breathing",
      source: "demo",
    });

    const session = gateway.store.get(SESSION)!;
    expect(session.state?.priority).toBe("critical");

    // One utterance did all of it: priority, protocol jump, units, gate.
    const thisTurn = session.log.filter((e) => e.sequence > beforeSeq);
    const types = typesOf(thisTurn);
    expect(types).toContain("incident.reclassified");
    expect(types).toContain("approval.requested");

    const reclass = thisTurn.find((e) => e.type === "incident.reclassified");
    expect(reclass?.payload.priority).toBe("critical");
  }, 120000);
});

describe("the approval gate is real", () => {
  it("refuses the CAD tool with 403 when nobody approved it", async () => {
    // Bypass the gateway entirely and ask the intelligence service directly —
    // this is the check that proves the gate is not merely a UI affordance.
    await post(`/api/calls/${SESSION}/demo`, {
      scenario: "cardiac",
      await_completion: true,
      fast: true,
    });
    const state = gateway.store.get(SESSION)!.state;

    const response = await fetch(`${INTELLIGENCE_URL}/internal/tools/execute`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        session_id: SESSION,
        tool: { name: "create_cad_draft", arguments: {} },
        current_state: state,
        approved: false,
      }),
    });

    expect(response.status).toBe(403);
    const refusal = (await response.json()) as { error: string };
    expect(refusal.error).toBe("human_approval_required");
  }, 120000);

  it("creates the CAD record and moves the unit once a human approves", async () => {
    await post(`/api/calls/${SESSION}/demo`, {
      scenario: "cardiac",
      await_completion: true,
      fast: true,
    });

    const received: AuraEvent[] = [];
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws/calls/${SESSION}`);
    socket.on("message", (data) => received.push(JSON.parse(data.toString())));
    await new Promise((resolve, reject) => {
      socket.on("open", resolve);
      socket.on("error", reject);
    });
    await new Promise((r) => setTimeout(r, 200));

    const approval = await post(`/api/calls/${SESSION}/approval`, {
      approved: true,
      reviewer: "shresth",
    });
    expect(approval.status).toBe(200);
    await new Promise((r) => setTimeout(r, 1200));

    const state = gateway.store.get(SESSION)!.state!;
    expect(state.status).toBe("dispatched");
    expect(state.human_required).toBe(false);
    expect(state.response_plan?.cad_id).toBeTruthy();

    const types = typesOf(received);
    expect(types).toContain("approval.resolved");
    expect(types).toContain("approval.granted");
    expect(types).toContain("dispatch.started");
    expect(types).toContain("dispatch.arrived");

    socket.close();
  }, 120000);

  it("holds the gate shut for an unverifiable address", async () => {
    const result = await post(`/api/calls/${SESSION}/demo`, {
      scenario: "vague",
      await_completion: true,
      fast: true,
    });
    expect(result.body.state.priority).toBe("critical");
    expect(result.body.state.location.verified).toBe(false);
    expect(result.body.pending_approvals).toHaveLength(0);
    expect(typesOf(gateway.store.get(SESSION)!.log)).not.toContain("approval.requested");
  }, 120000);
});

describe("reconnect and replay", () => {
  it("rebuilds the incident for a deck that connects late", async () => {
    await post(`/api/calls/${SESSION}/demo`, {
      scenario: "cardiac",
      await_completion: true,
      fast: true,
    });
    const log = gateway.store.get(SESSION)!.log;

    const received: AuraEvent[] = [];
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws/calls/${SESSION}`);
    socket.on("message", (data) => received.push(JSON.parse(data.toString())));
    await new Promise((resolve, reject) => {
      socket.on("open", resolve);
      socket.on("error", reject);
    });
    await new Promise((r) => setTimeout(r, 400));

    expect(received).toHaveLength(log.length);
    expect(received.map((e) => e.sequence)).toEqual(log.map((e) => e.sequence));
    expect(received[0]?.type).toBe("session.started");
    socket.close();
  }, 120000);
});

describe("the demo survives repetition", () => {
  /**
   * The handoff's acceptance bar: the primary demo has to succeed three times
   * in a row. Same script, same service, three clean runs, identical shape.
   */
  it("produces the same incident three consecutive times", async () => {
    const shapes: string[][] = [];
    const states: Record<string, unknown>[] = [];

    for (let run = 0; run < 3; run++) {
      const result = await post(`/api/calls/${SESSION}/demo`, {
        scenario: "cardiac",
        await_completion: true,
        fast: true,
      });
      expect(result.status).toBe(200);

      const state = result.body.state;
      states.push({
        category: state.category,
        priority: state.priority,
        step: state.protocol.step,
        verified: state.location.verified,
        unit: state.response_plan?.route?.unit_id,
        status: state.status,
      });
      shapes.push(typesOf(gateway.store.get(SESSION)!.log));

      // And each run can be carried through the gate.
      const approved = await post(`/api/calls/${SESSION}/approval`, {
        approved: true,
        reviewer: "shresth",
      });
      expect(approved.status).toBe(200);
      expect(gateway.store.get(SESSION)!.state?.status).toBe("dispatched");
    }

    expect(states[1]).toEqual(states[0]);
    expect(states[2]).toEqual(states[0]);
    // Captured at the gate, before the reviewer decides: every run must stop
    // here and wait, which is the property worth pinning.
    expect(states[0]).toMatchObject({
      category: "medical",
      priority: "critical",
      step: "human_dispatch_approval",
      verified: true,
      status: "awaiting_approval",
    });

    // The deterministic path must be reproducible event for event — that is the
    // whole point of the fallback demo. A live model is not: it extracts a
    // different number of facts each time (Pranay's notes call out minimax being
    // generous here), so what has to hold there is the milestone spine, in order.
    const MILESTONES = [
      "session.started",
      "protocol.activated",
      "incident.classified",
      "location.verified",
      "dispatch.proposed",
      "approval.requested",
    ];
    const spineOf = (types: string[]) => types.filter((t) => MILESTONES.includes(t));

    if (LIVE) {
      expect(spineOf(shapes[1]!)).toEqual(spineOf(shapes[0]!));
      expect(spineOf(shapes[2]!)).toEqual(spineOf(shapes[0]!));
    } else {
      expect(shapes[1]).toEqual(shapes[0]);
      expect(shapes[2]).toEqual(shapes[0]);
    }
  }, 300000);
});
