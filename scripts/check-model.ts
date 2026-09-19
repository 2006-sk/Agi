/**
 * Lists the models served by General Compute and runs one smoke extraction with the
 * configured model, printing latency and the validated JSON.
 *
 *   npm run check-model
 */
import { loadConfig } from "../src/config.js";
import { GeneralComputeClient, runExtraction } from "../src/model/client.js";
import { fallbackExtraction } from "../src/model/fallback.js";
import { buildExtractionMessages } from "../src/model/prompts.js";
import { createInitialState } from "../src/schemas/incident.js";

const config = loadConfig();
if (!config.apiKey) {
  console.error("GENERALCOMPUTE_API_KEY is not set. Copy .env.example to .env and add your key.");
  process.exit(1);
}

const logger = {
  info: (obj: Record<string, unknown>, msg?: string) => console.log(`[info] ${msg ?? ""}`, JSON.stringify(obj)),
  warn: (obj: Record<string, unknown>, msg?: string) => console.warn(`[warn] ${msg ?? ""}`, JSON.stringify(obj)),
};

const client = new GeneralComputeClient({
  apiKey: config.apiKey,
  baseUrl: config.baseUrl,
  model: config.model,
  timeoutMs: Math.max(config.modelTimeoutMs, 15_000),
  maxTokens: config.modelMaxTokens,
  logger,
});

console.log(`Base URL: ${config.baseUrl}`);
console.log(`Configured model: ${config.model}\n`);

try {
  const started = performance.now();
  const models = await client.listModels();
  console.log(`GET /v1/models -> ${models.length} models in ${Math.round(performance.now() - started)} ms`);
  for (const id of models) console.log(`  - ${id}${id === config.model ? "   <== configured" : ""}`);
  if (!models.includes(config.model)) {
    console.warn(`\nWARNING: configured model "${config.model}" is not in the list. Set GC_MODEL to one of the ids above.`);
  }
} catch (error) {
  console.error("Could not list models:", error instanceof Error ? error.message : error);
}

const utterance = "Hi, um, my dad is having really bad chest pain and we're at 170 St. Germain Avenue";
console.log(`\nSmoke extraction: ${JSON.stringify(utterance)}`);
const messages = buildExtractionMessages({
  utterance,
  state: createInitialState("check_model"),
  stepId: null,
  stepGoal: null,
  lastPrompt: null,
});
const outcome = await runExtraction(client, messages, {
  logger,
  fallback: () => fallbackExtraction(utterance),
});
console.log(
  `\nsource=${outcome.source} validation=${outcome.validation} attempts=${outcome.attempts} latency=${outcome.latency_ms} ms model=${outcome.model}`,
);
if (outcome.errors.length) console.log("errors:", outcome.errors);
console.log(JSON.stringify(outcome.extraction, null, 2));
process.exit(outcome.source === "fallback" ? 2 : 0);
