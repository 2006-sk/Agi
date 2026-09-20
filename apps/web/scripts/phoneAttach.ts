/**
 * The dashboard must light up for a phone call nobody started from the UI.
 *
 * Boots the console's transport with no call created — exactly what happens
 * when the screen is just sitting there — then rings the phone.
 */
import { GatewayTransport } from "../src/lib/gatewayTransport.ts";
import type { TypedEvent } from "../src/contracts/index.ts";
import { selectFocus, useAuraStore } from "../src/store/useAuraStore.ts";

const GW = "http://localhost:8000";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const post = (p: string, b?: unknown) =>
  fetch(GW + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b ?? {}) }).then((r) => r.json().catch(() => ({})));
const tool = (name: string, args: Record<string, unknown>) =>
  post("/vapi/tools", { message: { type: "tool-calls", call: { id: "PHONE-1", customer: { number: "+14085901963" } }, toolCallList: [{ id: "t" + Math.random(), name, arguments: args }] } });

let fails = 0;
const check = (l: string, ok: boolean, x?: unknown) => { if (!ok) { fails++; console.log("FAIL  " + l, x ?? ""); } else console.log("ok    " + l); };

async function main() {
  await post("/api/demo/reset");
  await sleep(300);

  // The console is open. Nobody has pressed anything.
  const got: TypedEvent[] = [];
  const transport = new GatewayTransport(GW);
  const stop = transport.connect((evs) => got.push(...evs), () => {});
  console.log("console open, no call created\n");
  await sleep(500);
  // Attaching to a session that already exists is the feature, not a fault;
  // what must not happen is an incident appearing before the phone rings.
  check("no incident before the phone rings", !got.some((e) => e.type === "incident.updated"), got.map((e) => e.type));

  // The phone rings.
  console.log("-- phone rings --");
  await post("/vapi/webhook", { message: { type: "status-update", status: "in-progress", call: { id: "PHONE-1", customer: { number: "+14085901963" } } } });
  await sleep(3600); // the console polls for new calls

  check("the console attached on its own", got.length > 0, got.length);

  console.log("-- the caller talks, the agent works --");
  await tool("update_incident", { category: "medical", priority: "high", chief_complaint: "chest pain", facts: ["clutching chest"] });
  await tool("verify_address", { address: "170 St. Germain Avenue" });
  await tool("update_incident", { breathing: "no", priority: "critical", facts: ["stopped breathing"] });
  await tool("find_units", { service: "EMS" });
  await tool("request_dispatch", { reason: "cardiac arrest" });
  await sleep(900);

  useAuraStore.getState().applyEvents(got);
  const focus = selectFocus(useAuraStore.getState());
  console.log(`\nreceived ${got.length} events`);
  console.log("  caller   :", focus?.caller?.caller_label, "| channel:", focus?.caller?.channel);
  console.log("  priority :", focus?.state?.priority);
  console.log("  address  :", focus?.state?.location?.normalized);
  console.log("  units    :", focus?.state?.response_plan?.units.length ?? 0, "| route:", focus?.state?.response_plan?.route ? "yes" : "no");
  console.log("  gate     :", focus?.approval ? "OPEN" : "none");
  console.log();

  check("a session is on the dashboard", Boolean(focus), Object.keys(useAuraStore.getState().sessions));
  check("priority critical", focus?.state?.priority === "critical", focus?.state?.priority);
  check("address verified", focus?.state?.location?.verified === true);
  check("units and route drawn", (focus?.state?.response_plan?.units.length ?? 0) > 0 && Boolean(focus?.state?.response_plan?.route));
  check("approval gate open", Boolean(focus?.approval));
  check("nothing dispatched yet", !focus?.state?.response_plan?.cad_id);

  stop();
  console.log(`\n${fails === 0 ? "PASS" : "FAIL"} — ${fails} failing check(s)`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
