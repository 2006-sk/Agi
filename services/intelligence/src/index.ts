import { pathToFileURL } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import { type Config, loadConfig } from "./config.js";
import { GeneralComputeClient, type Logger, type ModelClient } from "./model/client.js";
import { MockModelClient } from "./model/mock.js";
import { analyzeRoutes } from "./routes/analyze.js";
import { healthRoutes } from "./routes/health.js";
import { toolRoutes } from "./routes/tools.js";

export function createModelClient(config: Config, logger?: Logger): ModelClient {
  if (config.useMockModel || !config.apiKey) {
    logger?.warn(
      { reason: config.useMockModel ? "USE_MOCK_MODEL=true" : "GENERALCOMPUTE_API_KEY missing" },
      "using deterministic mock model client",
    );
    return new MockModelClient();
  }
  return new GeneralComputeClient({
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    model: config.model,
    timeoutMs: config.modelTimeoutMs,
    maxTokens: config.modelMaxTokens,
    logger,
  });
}

export interface BuildServerOptions {
  config?: Config;
  model?: ModelClient;
  logger?: boolean | object;
}

export async function buildServer(options: BuildServerOptions = {}): Promise<FastifyInstance> {
  const config = options.config ?? loadConfig();
  const app = Fastify({
    logger: options.logger ?? { level: config.logLevel },
    bodyLimit: 1_048_576,
  });
  const model = options.model ?? createModelClient(config, app.log);

  await app.register(healthRoutes, { config, model });
  await app.register(analyzeRoutes, {
    deps: { model, confidenceThreshold: config.confidenceThreshold, logger: app.log },
  });
  await app.register(toolRoutes);

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, "unhandled error");
    const message = error instanceof Error ? error.message : String(error);
    reply.code(500).send({ error: "internal_error", message });
  });

  return app;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const app = await buildServer({ config });
  try {
    await app.listen({ port: config.port, host: config.host });
    app.log.info(
      { model: config.model, base_url: config.baseUrl, mock: config.useMockModel },
      "AURA intelligence service ready",
    );
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

const invokedDirectly = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (invokedDirectly) {
  void main();
}
