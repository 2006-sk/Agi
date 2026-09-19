/**
 * Runs the deterministic medical demo conversation through the analyzer and prints the
 * incident progression turn by turn. Exits non-zero if any expectation fails.
 *
 *   npm run demo                 # mock model (offline)
 *   npm run demo:live            # SambaNova via General Compute
 *   npx tsx scripts/scripted-conversation.ts --repeat 3   # determinism check
 */
import { loadConfig } from "../src/config.js";
import { createModelClient } from "../src/index.js";
import { MEDICAL_SCENARIO, runScenario, stableState } from "../src/scenario.js";

const args = process.argv.slice(2);
const repeatIndex = args.indexOf("--repeat");
const repeat = repeatIndex >= 0 ? Math.max(1, Number(args[repeatIndex + 1] ?? 1)) : 1;

const config = loadConfig();
const logger = {
  info: () => undefined,
  warn: (obj: Record<string, unknown>, msg?: string) => console.warn(`  [warn] ${msg ?? ""} ${JSON.stringify(obj)}`),
};
const model = createModelClient(config, logger);
console.log(`Model client: ${model.kind} (${model.name})${model.kind === "model" ? ` via ${config.baseUrl}` : ""}\n`);

const snapshots: string[] = [];
let anyFailure = false;

for (let run = 1; run <= repeat; run += 1) {
  if (repeat > 1) console.log(`=== run ${run}/${repeat} ===`);
  const result = await runScenario({ model, confidenceThreshold: config.confidenceThreshold, logger }, MEDICAL_SCENARIO);

  result.turns.forEach((turn, i) => {
    const r = turn.response;
    const s = r.state;
    const transition = r.protocol_transition
      ? `${r.protocol_transition.from ?? "-"} -> ${r.protocol_transition.to}${r.protocol_transition.escalation ? "  [ESCALATION]" : ""}`
      : `(stays) ${s.protocol.step}`;
    console.log(`Turn ${i + 1}  Caller: ${JSON.stringify(turn.utterance)}`);
    console.log(`         Protocol: ${transition}`);
    console.log(`         Incident: ${s.category} / ${s.priority} / ${s.status}  human_required=${s.human_required}`);
    console.log(`         Location: ${s.location.normalized ?? s.location.raw ?? "unknown"} (verified=${s.location.verified})`);
    console.log(`         Facts: ${s.facts.join("; ") || "-"}${s.unverified_facts.length ? `  (unverified: ${s.unverified_facts.join("; ")})` : ""}`);
    console.log(`         Assessment: conscious=${s.assessment.conscious} breathing=${s.assessment.breathing}  missing=${JSON.stringify(s.missing_fields)}`);
    if (r.executed_tools.length) console.log(`         Tools run: ${r.executed_tools.map((t) => `${t.name} (${t.result_summary})`).join(" | ")}`);
    if (r.proposed_tools.length) console.log(`         Proposed (human approval): ${r.proposed_tools.map((t) => t.name).join(", ")}`);
    if (s.response_plan) {
      console.log(
        `         Plan: ${s.response_plan.services.join("/")} units ${s.response_plan.units.map((u) => u.unit_id).join(", ")}; route ${s.response_plan.route?.unit_id} ETA ${s.response_plan.route?.eta_minutes} min`,
      );
    }
    console.log(`         Events: ${r.events.map((e) => e.type).join(", ")}`);
    console.log(`         AURA: ${JSON.stringify(r.next_response)}`);
    console.log(
      `         Meta: source=${r.meta.source} validation=${r.meta.validation} model_latency=${r.meta.model_latency_ms ?? "-"}ms total=${r.meta.total_latency_ms}ms triggers=${JSON.stringify(r.meta.triggers_matched)}`,
    );
    if (r.meta.rejected.length) console.log(`         Rejected/notes: ${r.meta.rejected.join(" | ")}`);
    if (turn.failures.length) console.log(`         FAILED: ${turn.failures.join("; ")}`);
    console.log();
  });

  snapshots.push(JSON.stringify(stableState(result.final_state)));
  if (result.failures.length) {
    anyFailure = true;
    console.log(`Run ${run}: ${result.failures.length} expectation failure(s):\n  - ${result.failures.join("\n  - ")}\n`);
  } else {
    console.log(`Run ${run}: all ${result.turns.length} turns matched the expected progression.\n`);
  }
}

if (repeat > 1) {
  const identical = snapshots.every((s) => s === snapshots[0]);
  console.log(identical ? `Determinism: ${repeat} runs produced identical final states.` : "Determinism: final states DIFFER between runs.");
  if (!identical) anyFailure = true;
}

process.exit(anyFailure ? 1 : 0);
