/**
 * Live smoke test against SambaNova via General Compute. Skipped unless both
 * GENERALCOMPUTE_API_KEY and LIVE_MODEL_TESTS=1 are set:
 *
 *   npm run test:live
 */
import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { GeneralComputeClient } from "../src/model/client.js";
import { MEDICAL_SCENARIO, runScenario } from "../src/scenario.js";

const config = loadConfig();
const enabled = Boolean(config.apiKey) && process.env.LIVE_MODEL_TESTS === "1";

describe.skipIf(!enabled)("live: SambaNova via General Compute", () => {
  const makeClient = () =>
    new GeneralComputeClient({
      apiKey: config.apiKey ?? "",
      baseUrl: config.baseUrl,
      model: config.model,
      timeoutMs: Math.max(config.modelTimeoutMs, 15_000),
      maxTokens: config.modelMaxTokens,
    });

  it("serves the configured model", async () => {
    const models = await makeClient().listModels();
    expect(models.length).toBeGreaterThan(0);
    expect(models).toContain(config.model);
  });

  it("runs the scripted medical conversation with the live model", async () => {
    const result = await runScenario({ model: makeClient(), confidenceThreshold: config.confidenceThreshold }, MEDICAL_SCENARIO);
    for (const t of result.turns) {
      // eslint-disable-next-line no-console
      console.log(
        `[live] ${t.utterance} -> ${t.response.state.protocol.step} / ${t.response.state.priority} ` +
          `(source=${t.response.meta.source}, validation=${t.response.meta.validation}, model=${t.response.meta.model_latency_ms} ms)`,
      );
    }
    expect(result.failures).toEqual([]);
    expect(result.turns.some((t) => t.response.meta.source === "model")).toBe(true);
  }, 120_000);
});
