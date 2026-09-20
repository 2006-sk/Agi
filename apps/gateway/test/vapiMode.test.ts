import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildGateway, type EchoGateway } from "../src/app.js";
import { NullVoiceClient } from "../src/clients/voice.js";
import { config as baseConfig } from "../src/config.js";
import { FakeGis } from "./helpers/fakeGis.js";
import { NullCallAnnouncer } from "../src/clients/vapiControl.js";

/**
 * Vapi mode: the agent is the brain, ECHO keeps the gate.
 *
 * The point of these tests is that escalation has to be *earned*. A scripted
 * demo that always ends in a critical cardiac arrest proves nothing; what
 * matters is that a twisted ankle stays a twisted ankle, that an address
 * nobody could place keeps the gate shut, and that no sequence of agent tool
 * calls can put an ambulance on the road without a human.
 *
 * Sessions are per-call here (`vapiSessionId: "call_id"`). In the demo they are
 * pinned to the deck's session so a real phone call lights up the screen.
 */

let gateway: EchoGateway;
let intelligence: FakeGis;
let announcer: NullCallAnnouncer;
let baseUrl: string;

async function start(overrides: Partial<typeof baseConfig> = {}) {
  intelligence = new FakeGis();
  announcer = new NullCallAnnouncer();
  gateway = await buildGateway({
    intelligence,
    announcer,
    voice: new NullVoiceClient(),
    logger: false,
    config: {
      ...baseConfig,
      emitViewEvents: true,
      voiceBrain: "vapi",
      vapiSessionId: "call_id",
      vapiSecret: "",
      dispatchTravelMs: 200,
      dispatchTravelMinMs: 80,
      dispatchTravelMaxMs: 300,
      dispatchTickMs: 50,
      ...overrides,
    },
  });
  await gateway.app.listen({ port: 0, host: "127.0.0.1" });
  const address = gateway.app.server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;
}

/** Call one agent tool exactly the way Vapi does. */
async function agentTool(
  callId: string,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  const response = await fetch(`${baseUrl}/vapi/tools`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message: {
        type: "tool-calls",
        call: { id: callId, customer: { number: "+14085901963" } },
        toolCallList: [{ id: `tc_${Math.random().toString(16).slice(2)}`, name, arguments: args }],
      },
    }),
  });
  const body = (await response.json()) as { results: { result: string }[] };
  return body.results[0]?.result ?? "";
}

function sessionOf(callId: string) {
  return gateway.store.get(`vapi_${callId}`);
}

beforeEach(async () => {
  await start();
});

afterEach(async () => {
  await gateway.app.close();
});

/* ------------------------------------------------------------------ */
/* Escalation has to be earned                                         */
/* ------------------------------------------------------------------ */

describe("escalation follows the case, not a script", () => {
  it("leaves a minor injury minor, and opens no gate", async () => {
    const call = "minor";
    await agentTool(call, "update_incident", {
      category: "medical",
      priority: "low",
      chief_complaint: "twisted ankle",
      conscious: "yes",
      breathing: "normal",
      facts: ["tripped on a kerb"],
    });
    await agentTool(call, "verify_address", { address: "170 St. Germain Avenue" });

    const session = sessionOf(call)!;
    expect(session.state?.priority).toBe("low");
    expect(session.state?.status).toBe("active");
    expect(session.approvals.size).toBe(0);

    const types = session.log.map((e) => e.type);
    expect(types).not.toContain("approval.requested");
    // The deck's red flash must not fire for a sprain.
    const classified = session.log.filter(
      (e) => e.type === "incident.classified" || e.type === "incident.reclassified",
    );
    expect(classified.every((e) => e.payload.priority !== "critical")).toBe(true);
  });

  it("escalates only at the moment the caller says it", async () => {
    const call = "escalate";
    await agentTool(call, "update_incident", {
      category: "medical",
      priority: "high",
      chief_complaint: "chest pain",
    });
    let session = sessionOf(call)!;
    expect(session.state?.priority).toBe("high");
    const beforeSeq = session.sequence;

    await agentTool(call, "update_incident", { breathing: "no", facts: ["stopped breathing"] });

    session = sessionOf(call)!;
    expect(session.state?.priority).toBe("critical");
    const thisTurn = session.log.filter((e) => e.sequence > beforeSeq);
    const reclass = thisTurn.find((e) => e.type === "incident.reclassified");
    expect(reclass?.payload.priority).toBe("critical");
    expect(reclass?.payload.previous_priority).toBe("high");
  });

  it("forces critical on 'not breathing' even if the model says otherwise", async () => {
    const call = "override";
    // The agent low-balls it; the caller's words must win.
    await agentTool(call, "update_incident", {
      category: "medical",
      priority: "low",
      breathing: "no",
    });
    expect(sessionOf(call)!.state?.priority).toBe("critical");
  });

  it("never lets the agent walk a priority back down", async () => {
    const call = "monotonic";
    await agentTool(call, "update_incident", { category: "medical", priority: "critical" });
    await agentTool(call, "update_incident", { priority: "low" });
    expect(sessionOf(call)!.state?.priority).toBe("critical");
  });

  it("does not invent a category the caller never gave", async () => {
    const call = "nocat";
    await agentTool(call, "update_incident", { facts: ["someone is shouting"] });
    expect(sessionOf(call)!.state?.category).toBe("unknown");
  });
});

/* ------------------------------------------------------------------ */
/* The gate                                                            */
/* ------------------------------------------------------------------ */

describe("the human gate cannot be talked around", () => {
  async function driveToGate(call: string) {
    await agentTool(call, "update_incident", {
      category: "medical",
      priority: "critical",
      breathing: "no",
    });
    await agentTool(call, "verify_address", { address: "170 St. Germain Avenue" });
    await agentTool(call, "find_units", { service: "EMS" });
    return agentTool(call, "request_dispatch", { reason: "cardiac arrest" });
  }

  it("keeps the gate shut when the address could not be placed", async () => {
    const call = "vague";
    await agentTool(call, "update_incident", { category: "medical", breathing: "no" });
    const verify = await agentTool(call, "verify_address", { address: "somewhere near the park" });
    expect(verify).toMatch(/could not place|street number/i);

    const units = await agentTool(call, "find_units", { service: "EMS" });
    expect(units).toMatch(/not verified/i);
    const dispatch = await agentTool(call, "request_dispatch", { reason: "not breathing" });
    expect(dispatch).toMatch(/verified address/i);

    const session = sessionOf(call)!;
    expect(session.approvals.size).toBe(0);
    expect(session.state?.priority).toBe("critical"); // still critical — just ungated
    expect(session.log.map((e) => e.type)).not.toContain("approval.requested");
  });

  it("refuses dispatch before units have been found", async () => {
    const call = "nounits";
    await agentTool(call, "update_incident", { category: "medical", breathing: "no" });
    await agentTool(call, "verify_address", { address: "170 St. Germain Avenue" });
    const dispatch = await agentTool(call, "request_dispatch", { reason: "hurry" });
    expect(dispatch).toMatch(/find_units/i);
    expect(sessionOf(call)!.approvals.size).toBe(0);
  });

  it("opens the gate but dispatches nothing on its own", async () => {
    const call = "gate";
    const reply = await driveToGate(call);

    // The agent must be told to ask, and told explicitly not to promise.
    expect(reply).toMatch(/approve/i);
    expect(reply).toMatch(/do not say/i);

    const session = sessionOf(call)!;
    expect(session.approvals.size).toBe(1);
    expect(session.state?.status).toBe("awaiting_approval");
    expect(session.state?.human_required).toBe(true);
    expect(session.state?.response_plan?.cad_id).toBeFalsy();
    // Nothing consequential ran.
    expect(intelligence.toolCalls.filter((t) => t.tool.name === "create_cad_draft")).toHaveLength(0);

    const types = session.log.map((e) => e.type);
    expect(types).toContain("approval.requested");
    expect(types).not.toContain("dispatch.started");
  });

  it("dispatches only after a human approves, through the same gated tool", async () => {
    const call = "approve";
    await driveToGate(call);
    const session = sessionOf(call)!;
    const approvalId = [...session.approvals.keys()][0]!;

    const response = await fetch(`${baseUrl}/api/calls/vapi_${call}/approval`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approval_id: approvalId, approved: true, reviewer: "dispatcher" }),
    });
    expect(response.status).toBe(200);

    const cad = intelligence.toolCalls.filter((t) => t.tool.name === "create_cad_draft");
    expect(cad).toHaveLength(1);
    expect(cad[0]?.approved).toBe(true);
    expect(sessionOf(call)!.state?.status).toBe("dispatched");
  });

  it("cannot be opened twice by a repeated tool call", async () => {
    const call = "twice";
    await driveToGate(call);
    const second = await agentTool(call, "request_dispatch", { reason: "again" });
    expect(second).toMatch(/already been asked/i);
    expect(sessionOf(call)!.approvals.size).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* The deck                                                            */
/* ------------------------------------------------------------------ */

describe("telling the caller what happened to them", () => {
  /**
   * Dispatch is the one thing that happens *to* a call rather than in answer
   * to it. Without these the caller listens to an agent that has no idea help
   * was sent — the single thing they actually want to hear.
   */
  async function toTheGate(call: string) {
    // A control url stands in for a live phone call.
    await fetch(`${baseUrl}/vapi/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: {
          type: "status-update",
          status: "in-progress",
          call: { id: call, monitor: { controlUrl: "https://control.test/abc" } },
        },
      }),
    });
    await agentTool(call, "update_incident", { category: "medical", priority: "critical", breathing: "no" });
    await agentTool(call, "verify_address", { address: "170 St. Germain Avenue" });
    await agentTool(call, "find_units", { service: "EMS" });
    await agentTool(call, "request_dispatch", { reason: "cardiac arrest" });
  }

  it("says nothing to the caller before a human decides", async () => {
    await toTheGate("quiet");
    expect(announcer.said).toHaveLength(0);
  });

  it("tells the caller the moment the dispatcher approves", async () => {
    await toTheGate("approved");
    const session = gateway.store.get("vapi_approved")!;
    await fetch(`${baseUrl}/api/calls/vapi_approved/approval`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approved: true, reviewer: "dispatcher" }),
    });

    const line = announcer.said[0] ?? "";
    expect(line).toMatch(/on the way/i);
    expect(line).toMatch(/minutes/i);
    expect(session.vapiControlUrl).toBe("https://control.test/abc");
  });

  it("tells the caller when the unit is on scene", async () => {
    await toTheGate("onscene");
    await fetch(`${baseUrl}/api/calls/vapi_onscene/approval`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approved: true, reviewer: "dispatcher" }),
    });
    // The run is bounded to a few hundred ms in tests.
    await new Promise((r) => setTimeout(r, 700));

    const arrival = announcer.said.find((l) => /arriving now/i.test(l));
    expect(arrival, announcer.said.join(" | ")).toBeTruthy();
    expect(arrival).toContain("M-20");
  });

  it("says nothing when the dispatcher rejects", async () => {
    await toTheGate("rejected");
    await fetch(`${baseUrl}/api/calls/vapi_rejected/approval`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approved: false, reviewer: "dispatcher" }),
    });
    await new Promise((r) => setTimeout(r, 400));
    expect(announcer.said).toHaveLength(0);
  });

  it("does not try to speak when there is no phone call", async () => {
    // The demo runner and the browser console have nobody on a line.
    const call = "nocontrol";
    await agentTool(call, "update_incident", { category: "medical", priority: "critical", breathing: "no" });
    await agentTool(call, "verify_address", { address: "170 St. Germain Avenue" });
    await agentTool(call, "find_units", { service: "EMS" });
    await agentTool(call, "request_dispatch", { reason: "cardiac arrest" });
    await fetch(`${baseUrl}/api/calls/vapi_${call}/approval`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ approved: true }),
    });
    await new Promise((r) => setTimeout(r, 500));
    expect(announcer.said).toHaveLength(0);
  });
});

describe("the transcript", () => {
  /** Post a Vapi server message the way Vapi does. */
  async function webhook(message: Record<string, unknown>) {
    await fetch(`${baseUrl}/vapi/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message }),
    });
  }

  it("puts the caller's words on the deck", async () => {
    // In vapi mode the completions endpoint is never called, so if the webhook
    // drops caller finals nothing publishes them and the panel stays empty for
    // the entire call.
    const call = "transcript";
    await agentTool(call, "update_incident", { category: "medical" });
    await webhook({
      type: "transcript",
      transcriptType: "final",
      role: "user",
      transcript: "my father is clutching his chest",
      call: { id: call },
    });

    const lines = sessionOf(call)!.log.filter(
      (e) => e.type === "transcript.final" && e.payload.speaker === "caller",
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]?.payload.text).toBe("my father is clutching his chest");
  });

  it("puts what the agent said on the deck too", async () => {
    const call = "agentline";
    await agentTool(call, "update_incident", { category: "medical" });
    await webhook({
      type: "transcript",
      transcriptType: "final",
      role: "assistant",
      transcript: "What is the address of the emergency?",
      call: { id: call },
    });

    const line = sessionOf(call)!.log.find(
      (e) => e.type === "transcript.final" && e.payload.speaker === "agent",
    );
    expect(line?.payload.text).toBe("What is the address of the emergency?");
  });

  it("keeps every line of a conversation, not just the first", async () => {
    // The console keys transcript lines by utterance_id and ignores repeats.
    // When every line shared one id the panel showed a single message that
    // never grew, which is what a whole phone call looked like on screen.
    const call = "manylines";
    await agentTool(call, "update_incident", { category: "medical" });

    const spoken = [
      ["user", "someone is in my house"],
      ["assistant", "What is the address?"],
      ["user", "170 St Germain Avenue"],
      ["assistant", "Is anyone hurt?"],
      ["user", "he is not breathing"],
    ] as const;
    for (const [role, transcript] of spoken) {
      await webhook({ type: "transcript", transcriptType: "partial", role, transcript: transcript.slice(0, 5), call: { id: call } });
      await webhook({ type: "transcript", transcriptType: "final", role, transcript, call: { id: call } });
    }

    const finals = sessionOf(call)!.log.filter((e) => e.type === "transcript.final");
    expect(finals).toHaveLength(spoken.length);

    // Every line must be distinguishable, or the console collapses them.
    const ids = finals.map((e) => e.payload.utterance_id);
    expect(new Set(ids).size).toBe(spoken.length);
    expect(finals.map((e) => e.payload.text)).toEqual(spoken.map(([, t]) => t));
  });

  it("ties a partial to the final that closes it", async () => {
    const call = "pairing";
    await agentTool(call, "update_incident", { category: "medical" });
    await webhook({ type: "transcript", transcriptType: "partial", role: "user", transcript: "he is", call: { id: call } });
    await webhook({ type: "transcript", transcriptType: "final", role: "user", transcript: "he is not breathing", call: { id: call } });
    await webhook({ type: "transcript", transcriptType: "partial", role: "user", transcript: "at one", call: { id: call } });

    const log = sessionOf(call)!.log;
    const first = log.find((e) => e.type === "transcript.partial")!;
    const final = log.find((e) => e.type === "transcript.final")!;
    const second = log.filter((e) => e.type === "transcript.partial")[1]!;

    // The partial and its final are one utterance; the next phrase is a new one.
    expect(first.payload.utterance_id).toBe(final.payload.utterance_id);
    expect(second.payload.utterance_id).not.toBe(final.payload.utterance_id);
  });

  it("shows partials while the caller is still talking", async () => {
    const call = "partials";
    await agentTool(call, "update_incident", { category: "medical" });
    await webhook({
      type: "transcript",
      transcriptType: "partial",
      role: "user",
      transcript: "my father is",
      call: { id: call },
    });
    expect(sessionOf(call)!.log.some((e) => e.type === "transcript.partial")).toBe(true);
  });
});

describe("the deck updates live from agent tool calls", () => {
  it("turns each tool call into rail and incident events", async () => {
    const call = "deck";
    await agentTool(call, "update_incident", {
      category: "medical",
      priority: "high",
      chief_complaint: "chest pain",
      facts: ["clutching chest"],
    });
    await agentTool(call, "verify_address", { address: "170 St. Germain Avenue" });
    await agentTool(call, "find_units", { service: "EMS" });

    const types = sessionOf(call)!.log.map((e) => e.type);
    for (const expected of [
      "session.started",
      "call.incoming",
      "tool.invoked",
      "tool.result",
      "incident.classified",
      "fact.extracted",
      "location.verified",
      "responders.available",
      "route.proposed",
      "protocol.activated",
    ]) {
      expect(types, `missing ${expected}`).toContain(expected);
    }
  });

  it("puts the verified address on the city plane", async () => {
    const call = "coords";
    await agentTool(call, "verify_address", { address: "170 St. Germain Avenue" });
    const verified = sessionOf(call)!.log.find((e) => e.type === "location.verified");
    expect(verified?.payload.coords).toEqual({ x: 12.5, z: -27 });
  });

  it("keeps sequencing contiguous across agent tool calls", async () => {
    const call = "seq";
    await agentTool(call, "update_incident", { category: "medical", priority: "high" });
    await agentTool(call, "verify_address", { address: "170 St. Germain Avenue" });
    await agentTool(call, "find_units", { service: "EMS" });

    const log = sessionOf(call)!.log;
    expect(log.map((e) => e.sequence)).toEqual(log.map((_, i) => i + 1));
    expect(new Set(log.map((e) => e.event_id)).size).toBe(log.length);
  });

  it("shows a failed tool as failed rather than silently swallowing it", async () => {
    const call = "toolfail";
    await agentTool(call, "find_units", { service: "EMS" }); // no address yet
    const failed = sessionOf(call)!.log.find(
      (e) => e.type === "tool.completed" && String(e.payload.result_summary).startsWith("failed:"),
    );
    expect(failed).toBeDefined();
    const rail = sessionOf(call)!.log.find(
      (e) => e.type === "tool.result" && e.payload.status === "error",
    );
    expect(rail).toBeDefined();
  });

  it("ignores an unknown tool without corrupting the incident", async () => {
    const call = "unknown";
    const reply = await agentTool(call, "launch_helicopter", { count: 3 });
    expect(reply).toMatch(/did not work/i);
    expect(sessionOf(call)!.approvals.size).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* Robustness                                                          */
/* ------------------------------------------------------------------ */

describe("robustness", () => {
  it("accepts tool arguments delivered as a JSON string", async () => {
    // Vapi has shipped both shapes; the agent should not be able to break us.
    const response = await fetch(`${baseUrl}/vapi/tools`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: {
          type: "tool-calls",
          call: { id: "stringargs" },
          toolCallList: [
            {
              id: "tc1",
              function: { name: "update_incident", arguments: '{"category":"fire","priority":"high"}' },
            },
          ],
        },
      }),
    });
    const body = (await response.json()) as { results: { result: string }[] };
    expect(body.results).toHaveLength(1);
    expect(sessionOf("stringargs")!.state?.category).toBe("fire");
  });

  it("handles several tool calls in one request", async () => {
    const response = await fetch(`${baseUrl}/vapi/tools`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: {
          type: "tool-calls",
          call: { id: "batch" },
          toolCallList: [
            { id: "a", name: "update_incident", arguments: { category: "medical", priority: "high" } },
            { id: "b", name: "verify_address", arguments: { address: "170 St. Germain Avenue" } },
          ],
        },
      }),
    });
    const body = (await response.json()) as { results: { toolCallId: string }[] };
    expect(body.results.map((r) => r.toolCallId)).toEqual(["a", "b"]);
    expect(sessionOf("batch")!.state?.location.verified).toBe(true);
  });

  it("rejects an unauthenticated tool call when a secret is configured", async () => {
    await gateway.app.close();
    await start({ vapiSecret: "s3cret" });
    const response = await fetch(`${baseUrl}/vapi/tools`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        message: { type: "tool-calls", call: { id: "nope" }, toolCallList: [] },
      }),
    });
    expect(response.status).toBe(401);
  });

  async function statusUpdate(callId: string, status: string) {
    await fetch(`${baseUrl}/vapi/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: { type: "status-update", status, call: { id: callId } } }),
    });
  }

  it("starts a fresh incident when a new call arrives on the same line", async () => {
    await gateway.app.close();
    await start({ vapiSessionId: "echo-demo-0197" });

    await statusUpdate("call-1", "in-progress");
    await agentTool("call-1", "update_incident", { category: "medical", priority: "critical" });
    expect(gateway.store.get("echo-demo-0197")!.state?.priority).toBe("critical");

    await statusUpdate("call-2", "in-progress");

    const session = gateway.store.get("echo-demo-0197")!;
    expect(session.state).toBeNull();
    expect(session.log[0]?.sequence).toBe(1);
    expect(session.approvals.size).toBe(0);
  });

  it("does not wipe a live call when Vapi repeats in-progress", async () => {
    // This is what cleared the board mid-conversation: providers re-send
    // lifecycle webhooks, and every notice was being treated as a new call.
    await gateway.app.close();
    await start({ vapiSessionId: "echo-demo-0197" });

    await statusUpdate("call-1", "in-progress");
    await agentTool("call-1", "update_incident", {
      category: "medical",
      priority: "critical",
      breathing: "no",
    });
    await agentTool("call-1", "verify_address", { address: "170 St. Germain Avenue" });
    const before = gateway.store.get("echo-demo-0197")!.state;
    expect(before?.priority).toBe("critical");

    await statusUpdate("call-1", "in-progress");
    await statusUpdate("call-1", "in-progress");

    const session = gateway.store.get("echo-demo-0197")!;
    expect(session.state?.priority).toBe("critical");
    expect(session.state?.location.verified).toBe(true);
  });
});
