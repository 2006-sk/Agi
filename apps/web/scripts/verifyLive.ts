/**
 * End-to-end wiring check: the command center against the real gateway.
 *
 * Drives the gateway through the exact transport the app uses, then validates
 * every frame with the app's own zod contract and replays them through the
 * app's own reducer. If this passes, the only thing left between here and the
 * screen is pixels.
 *
 *   npm run verify:live
 */

import { GatewayTransport } from "../src/lib/gatewayTransport.ts";
import { parseEvent, type TypedEvent } from "../src/contracts/index.ts";
import { selectFocus, useEchoStore } from "../src/store/useEchoStore.ts";

const GATEWAY = process.env.GATEWAY ?? "http://localhost:8000";

let fails = 0;
const check = (label: string, ok: boolean, extra?: unknown) => {
  if (!ok) {
    fails++;
    console.log("FAIL  " + label, extra ?? "");
  } else {
    console.log("ok    " + label);
  }
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log(`--- command center -> ${GATEWAY} ---\n`);

  // Start from a clean board, the way the presenter console's reset does.
  await fetch(`${GATEWAY}/api/demo/reset`, { method: "POST" }).catch(() => null);

  const transport = new GatewayTransport(GATEWAY);
  const received: TypedEvent[] = [];
  const rejected: string[] = [];
  let status = "";

  const stop = transport.connect(
    (events) => received.push(...events),
    (s) => {
      status = s;
    },
  );

  console.log("--- session ---");
  const { session_id } = await transport.createCall({ caller_label: "caller", channel: "voice" });
  check("gateway created a call", Boolean(session_id), session_id);
  await sleep(400);
  check("socket open", status === "open", status);

  console.log("\n--- scripted incident ---");
  await transport.startDemo(session_id, { scenario: "cardiac", mode: "auto", pace: 1, ambient: false });
  // The demo runs against the live model; give it the full run.
  for (let i = 0; i < 60 && !received.some((e) => e.type === "approval.requested"); i++) {
    await sleep(1000);
  }
  await sleep(600);

  console.log(`received ${received.length} events\n`);

  // Anything the gateway sends that the contract rejects would be dropped on
  // the floor in the browser with only a console warning.
  const raw = await fetch(`${GATEWAY}/api/calls/${session_id}/events`)
    .then((r) => r.json())
    .then((b) => b.events as unknown[]);
  for (const event of raw) {
    const parsed = parseEvent(event);
    if (!parsed.ok) rejected.push(`${(event as { type?: string }).type}: ${parsed.error}`);
  }

  console.log("--- contract ---");
  check("every gateway event validates against the UI contract", rejected.length === 0, rejected.slice(0, 6));
  // Starting the demo resets the session, so the socket sees the tail of the
  // opening run and then the whole scripted one. What has to hold is that the
  // live run is intact and nothing arrived twice.
  // The LAST run: starting the demo resets, so sequence 1 appears twice.
  let runStart = 0;
  for (let i = received.length - 1; i >= 0; i--) {
    if (received[i]!.sequence === 1) {
      runStart = i;
      break;
    }
  }
  const live = received.slice(runStart);
  const sequences = live.map((e) => e.sequence);
  check("the live run is contiguous from 1", sequences.every((s, i) => s === i + 1), sequences.slice(0, 14));
  check("the live run matches the log", sequences.length >= raw.length - 1, {
    overSocket: sequences.length,
    inLog: raw.length,
  });
  check("unique event ids", new Set(received.map((e) => e.event_id)).size === received.length);

  console.log("\n--- event coverage ---");
  const seen = new Set(received.map((e) => e.type));
  for (const type of [
    "call.started",
    "analysis.started",
    "analysis.completed",
    "transcript.final",
    "incident.updated",
    "protocol.changed",
    "tool.started",
    "tool.completed",
    "dispatch.proposed",
    "approval.requested",
  ]) {
    check(`emits ${type}`, seen.has(type), [...seen]);
  }

  console.log("\n--- the store the HUD reads ---");
  useEchoStore.getState().applyEvents(received);
  const focus = selectFocus(useEchoStore.getState());
  check("a focused session exists", Boolean(focus), Object.keys(useEchoStore.getState().sessions));

  const incident = focus?.state ?? null;
  const location = incident?.location ?? null;
  const plan = incident?.response_plan ?? null;

  console.log("  caller     :", focus?.caller?.caller_label, "| kind:", focus?.kind);
  console.log("  priority   :", incident?.priority);
  console.log("  category   :", incident?.category);
  console.log("  status     :", incident?.status);
  console.log("  address    :", location?.normalized, "| verified:", location?.verified);
  console.log("  protocol   :", JSON.stringify(incident?.protocol));
  console.log("  facts      :", incident?.facts?.length ?? 0);
  console.log("  transcript :", focus?.transcript.length ?? 0);
  console.log("  tools      :", focus?.tools.length ?? 0);
  console.log("  protocol changes:", focus?.protocolChanges.length ?? 0);
  console.log("  analysis   :", focus?.analysis ? "present" : "none", "| analyzing:", focus?.analyzing);
  console.log("  units      :", plan?.units.length ?? 0, "| route:", plan?.route ? "yes" : "no");
  console.log("  approval   :", focus?.approval ? focus.approval.payload.action_id : "none");
  console.log();

  check("category medical", incident?.category === "medical", incident?.category);
  check("priority critical", incident?.priority === "critical", incident?.priority);
  check("address verified", location?.verified === true, location);
  check("coordinates present", typeof location?.latitude === "number", location);
  check("protocol at the approval step",
    incident?.protocol?.step === "human_dispatch_approval", incident?.protocol);
  check("facts extracted", (incident?.facts?.length ?? 0) > 0);
  check("transcript populated", (focus?.transcript.length ?? 0) > 0);
  check("tool calls recorded", (focus?.tools.length ?? 0) > 0);
  check("protocol history recorded", (focus?.protocolChanges.length ?? 0) > 0);
  check("analysis panel has data", Boolean(focus?.analysis), focus?.analysis);
  check("reasoning finished", focus?.analyzing === false, focus?.analyzing);
  check("units proposed", (plan?.units.length ?? 0) > 0);
  check("route drawn", Boolean(plan?.route));
  check("dispatch proposal on screen", Boolean(focus?.dispatch), focus?.dispatch);
  check("approval gate on screen", Boolean(focus?.approval), focus?.approval);
  check("waiting on a human",
    incident?.human_required === true && incident?.status === "awaiting_approval",
    { human_required: incident?.human_required, status: incident?.status });
  check("no CAD record before approval", !plan?.cad_id, plan?.cad_id);

  console.log("\n--- the gate ---");
  const gate = received.find((e) => e.type === "approval.requested");
  const actionId = (gate?.payload as Record<string, unknown> | undefined)?.action_id as string | undefined;
  check("gate carries an action id", Boolean(actionId), gate?.payload);

  await transport.approval(session_id, { action_id: actionId, approved: true, reviewer: "verify" });
  await sleep(1500);

  const after = await fetch(`${GATEWAY}/api/calls/${session_id}`).then((r) => r.json());
  check("dispatched after approval", after.state?.status === "dispatched", after.state?.status);
  check("CAD record created", Boolean(after.state?.response_plan?.cad_id), after.state?.response_plan?.cad_id);
  check("approval.resolved reached the console",
    received.some((e) => e.type === "approval.resolved"),
    [...new Set(received.map((e) => e.type))]);

  stop();
  console.log(`\n${fails === 0 ? "PASS" : "FAIL"} — ${fails} failing check(s)`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error("crashed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
