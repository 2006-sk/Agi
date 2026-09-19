import type { FastifyInstance } from "fastify";
import { analyze, type AnalyzerDeps } from "../engine/analyzer.js";
import { AnalyzeRequest } from "../schemas/analyze.js";

export interface AnalyzeRouteOptions {
  deps: AnalyzerDeps;
}

export async function analyzeRoutes(app: FastifyInstance, options: AnalyzeRouteOptions): Promise<void> {
  app.post("/internal/analyze", async (request, reply) => {
    const parsed = AnalyzeRequest.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_request",
        issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
      });
    }
    const result = await analyze(parsed.data, { ...options.deps, logger: options.deps.logger ?? request.log });
    return reply.send(result);
  });
}
