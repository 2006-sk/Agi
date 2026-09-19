import OpenAI from "openai";
import type { ChatCompletionCreateParamsNonStreaming } from "openai/resources/chat/completions";
import {
  MODEL_EXTRACTION_JSON_SCHEMA,
  MODEL_EXTRACTION_SCHEMA_NAME,
  ModelExtraction,
} from "../schemas/model-output.js";
import type { ModelMessages } from "./prompts.js";

export interface ModelRawResponse {
  content: string;
  latency_ms: number;
  model: string;
}

export interface ModelClient {
  readonly name: string;
  readonly kind: "model" | "mock";
  complete(messages: ModelMessages): Promise<ModelRawResponse>;
}

export interface Logger {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  debug?(obj: Record<string, unknown>, msg?: string): void;
}

export const silentLogger: Logger = {
  info: () => undefined,
  warn: () => undefined,
  debug: () => undefined,
};

export interface GeneralComputeClientOptions {
  apiKey: string;
  baseUrl: string;
  model: string;
  timeoutMs: number;
  maxTokens: number;
  logger?: Logger;
}

/**
 * SambaNova inference hosted by General Compute. The endpoint is OpenAI-compatible, so
 * the official SDK is pointed at the General Compute base URL. Structured output is
 * requested with `response_format: json_schema`; if the endpoint rejects that for the
 * chosen model we fall back to `json_object` mode for the rest of the process lifetime.
 */
export class GeneralComputeClient implements ModelClient {
  readonly kind = "model" as const;
  readonly name: string;
  private readonly client: OpenAI;
  private jsonSchemaSupported = true;
  private readonly logger: Logger;

  constructor(private readonly options: GeneralComputeClientOptions) {
    this.name = options.model;
    this.logger = options.logger ?? silentLogger;
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseUrl,
      timeout: options.timeoutMs,
      maxRetries: 0, // retries are handled by runExtraction so they are observable
    });
  }

  private buildParams(messages: ModelMessages): ChatCompletionCreateParamsNonStreaming {
    return {
      model: this.options.model,
      temperature: 0,
      max_tokens: this.options.maxTokens,
      messages: [
        { role: "system", content: messages.system },
        { role: "user", content: messages.user },
      ],
      response_format: this.jsonSchemaSupported
        ? {
            type: "json_schema",
            json_schema: {
              name: MODEL_EXTRACTION_SCHEMA_NAME,
              schema: MODEL_EXTRACTION_JSON_SCHEMA,
              strict: false,
            },
          }
        : { type: "json_object" },
    };
  }

  async complete(messages: ModelMessages): Promise<ModelRawResponse> {
    const started = performance.now();
    let completion;
    try {
      completion = await this.client.chat.completions.create(this.buildParams(messages));
    } catch (error) {
      if (this.jsonSchemaSupported && isBadRequest(error)) {
        this.logger.warn(
          { model: this.options.model, error: errorMessage(error) },
          "json_schema response_format rejected; falling back to json_object mode",
        );
        this.jsonSchemaSupported = false;
        completion = await this.client.chat.completions.create(this.buildParams(messages));
      } else {
        throw error;
      }
    }
    const content = completion.choices[0]?.message?.content ?? "";
    return {
      content,
      latency_ms: Math.round(performance.now() - started),
      model: completion.model ?? this.options.model,
    };
  }

  async listModels(): Promise<string[]> {
    const page = await this.client.models.list();
    const ids: string[] = [];
    for await (const model of page) ids.push(model.id);
    return ids.sort();
  }
}

function isBadRequest(error: unknown): boolean {
  return typeof error === "object" && error !== null && "status" in error && (error as { status?: number }).status === 400;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

/** Pull a JSON object out of model text that may include fences or reasoning preambles. */
export function extractJsonObject(content: string): unknown {
  let text = content.trim();
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence?.[1]) text = fence[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("no JSON object found in model output");
  return JSON.parse(text.slice(start, end + 1));
}

export interface ExtractionOutcome {
  extraction: ModelExtraction;
  source: "model" | "mock" | "fallback";
  validation: "ok" | "retried" | "fallback";
  attempts: number;
  latency_ms: number | null;
  model: string;
  errors: string[];
}

export interface RunExtractionOptions {
  fallback: () => ModelExtraction;
  logger?: Logger;
  maxAttempts?: number;
  buildRepair?: (note: string) => ModelMessages;
}

/**
 * Call the model, enforce the schema, retry malformed output once with the validation
 * errors attached, then hand over to the deterministic fallback extractor.
 */
export async function runExtraction(
  client: ModelClient,
  messages: ModelMessages,
  options: RunExtractionOptions,
): Promise<ExtractionOutcome> {
  const logger = options.logger ?? silentLogger;
  const maxAttempts = options.maxAttempts ?? 2;
  const errors: string[] = [];
  let latencyTotal = 0;
  let current = messages;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const raw = await client.complete(current);
      latencyTotal += raw.latency_ms;
      const parsed = extractJsonObject(raw.content);
      const validated = ModelExtraction.safeParse(parsed);
      if (validated.success) {
        const outcome: ExtractionOutcome = {
          extraction: validated.data,
          source: client.kind,
          validation: attempt === 1 ? "ok" : "retried",
          attempts: attempt,
          latency_ms: latencyTotal,
          model: raw.model,
          errors,
        };
        logger.info(
          { model: raw.model, attempt, latency_ms: raw.latency_ms, validation: outcome.validation },
          "model extraction validated",
        );
        return outcome;
      }
      const issue = validated.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .slice(0, 6)
        .join("; ");
      errors.push(`attempt ${attempt}: schema violation: ${issue}`);
      logger.warn({ model: raw.model, attempt, issue }, "model output failed schema validation");
      current = options.buildRepair ? options.buildRepair(issue) : current;
    } catch (error) {
      const message = errorMessage(error);
      errors.push(`attempt ${attempt}: ${message}`);
      logger.warn({ model: client.name, attempt, error: message }, "model call failed");
      current = options.buildRepair ? options.buildRepair(`could not parse JSON: ${message}`) : current;
    }
  }

  logger.warn({ model: client.name, errors }, "using deterministic fallback extraction");
  return {
    extraction: options.fallback(),
    source: "fallback",
    validation: "fallback",
    attempts: maxAttempts,
    latency_ms: latencyTotal || null,
    model: client.name,
    errors,
  };
}
