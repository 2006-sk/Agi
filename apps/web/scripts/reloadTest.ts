/**
 * A reload must hand back a clean board.
 *
 * Between demo runs — and after a call is cut off half way — the console must
 * not come back showing the last caller's emergency.
 */
import { GatewayTransport } from "../src/lib/gatewayTransport.ts";
import type { TypedEvent } from "../src/contracts/index.ts";
import { selectFocus, useEchoStore } from "../src/store/useEchoStore.ts";

const GW = "http://localhost:8000";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const post = (p: string, b?: unknown) =>
  fetch(GW + p, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(b ?? {}) }).then((r) => r.json().catch(() => ({})));
const tool = (name: string, args: Record<string, unknown>) =>
  post("/vapi/tools", { message: { type: "tool-calls", call: { id: "RELOAD-1" }, toolCallList: [{ id: "t" + Math.random(), name, arguments: args }] } });

let fails = 0;
const check = (l: string, ok: boolean, x?: unknown) => { if (!ok) { fails++; console.log("FAIL  " + l, x ?? ""); } else console.log("ok    " + l); };

/** One page load. */
async function load() {
  const got: TypedEvent[] = [];
  const t = new GatewayTransport(GW);
  const stop = t.connect((evs) => got.push(...evs), () => {});
  await sleep(1400);
  return { got, stop };
}

async function main() {
  console.log("--- first load, then a call gets half way ---");
  const first = await load();
  await post("/vapi/webhook", { message: { type: "status-update", status: "in-progress", call: { id: "RELOAD-1" } } });
  await sleep(300);
  await tool("update_incident", { category: "medical", priority: "critical", breathing: "no", chief_complaint: "chest pain" });
  await tool("verify_address", { address: "170 St. Germain Avenue" });
  await sleep(500);

  useEchoStore.setState({ sessions: {}, order: [], focusId: null });
  useEchoStore.getState().applyEvents(first.got);
  const mid = selectFocus(useEchoStore.getState());
  check("the incident is on screen before the reload", mid?.state?.priority === "critical", mid?.state?.priority);
  first.stop();

  console.log("\n--- the caller hangs up mid-call, operator reloads ---");
  const second = await load();

  useEchoStore.setState({ sessions: {}, order: [], focusId: null });
  useEchoStore.getState().applyEvents(second.got);
  const after = selectFocus(useEchoStore.getState());

  console.log("  priority :", after?.state?.priority ?? "(none)");
  console.log("  address  :", after?.state?.location?.normalized ?? "(none)");
  console.log("  facts    :", after?.state?.facts?.length ?? 0);
  console.log("  gate     :", after?.approval ? "OPEN" : "none");

  check("the last caller's emergency is gone", !after?.state || after.state.priority === "unknown", after?.state?.priority);
  check("no stale address", !after?.state?.location?.normalized, after?.state?.location?.normalized);
  check("no stale approval gate", !after?.approval);
  check("the board is still live, not dead", second.got.length > 0, second.got.length);
  second.stop();

  console.log(`\n${fails === 0 ? "PASS" : "FAIL"} — ${fails} failing check(s)`);
  process.exit(fails === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
