import type { FastifyInstance } from "fastify";
import type { Config } from "../config.js";
import { GeneralComputeClient, type ModelClient } from "../model/client.js";
import { listProtocols } from "../protocol/registry.js";

export interface HealthRouteOptions {
  config: Config;
  model: ModelClient;
}

export async function healthRoutes(app: FastifyInstance, options: HealthRouteOptions): Promise<void> {
  app.get("/internal/health", async (request) => {
    const query = request.query as { probe?: string };
    const body: Record<string, unknown> = {
      ok: true,
      service: "echo-intelligence",
      model: options.config.model,
      model_client: options.model.kind,
      base_url: options.config.baseUrl,
      mock: options.config.useMockModel,
      confidence_threshold: options.config.confidenceThreshold,
      protocols: listProtocols().map((p) => ({
        id: p.id,
        category: p.category,
        steps: p.steps.map((s) => s.id),
      })),
    };
    if (query.probe === "1" && options.model instanceof GeneralComputeClient) {
      const started = performance.now();
      try {
        const models = await options.model.listModels();
        body.probe = {
          reachable: true,
          latency_ms: Math.round(performance.now() - started),
          model_available: models.includes(options.config.model),
          models_count: models.length,
        };
      } catch (error) {
        body.ok = false;
        body.probe = { reachable: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
    return body;
  });
}
