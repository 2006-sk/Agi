import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ quiet: true });

const boolFromEnv = z
  .string()
  .optional()
  .transform((v) => (v === undefined ? undefined : ["1", "true", "yes", "on"].includes(v.toLowerCase())));

const numberFromEnv = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v === "" ? undefined : Number(v)))
  .pipe(z.number().finite().optional());

const EnvSchema = z.object({
  GENERALCOMPUTE_API_KEY: z.string().optional(),
  GC_BASE_URL: z.string().url().default("https://api.generalcompute.com/v1"),
  GC_MODEL: z.string().default("gpt-oss-120b"),
  MODEL_TIMEOUT_MS: numberFromEnv,
  MODEL_MAX_TOKENS: numberFromEnv,
  CONFIDENCE_THRESHOLD: numberFromEnv,
  USE_MOCK_MODEL: boolFromEnv,
  PORT: numberFromEnv,
  HOST: z.string().default("0.0.0.0"),
  LOG_LEVEL: z.string().default("info"),
});

export interface Config {
  apiKey: string | undefined;
  baseUrl: string;
  model: string;
  modelTimeoutMs: number;
  modelMaxTokens: number;
  confidenceThreshold: number;
  useMockModel: boolean;
  port: number;
  host: string;
  logLevel: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.parse(env);
  const useMock = parsed.USE_MOCK_MODEL ?? !parsed.GENERALCOMPUTE_API_KEY;
  return {
    apiKey: parsed.GENERALCOMPUTE_API_KEY,
    baseUrl: parsed.GC_BASE_URL,
    model: parsed.GC_MODEL,
    modelTimeoutMs: parsed.MODEL_TIMEOUT_MS ?? 4000,
    modelMaxTokens: parsed.MODEL_MAX_TOKENS ?? 600,
    confidenceThreshold: parsed.CONFIDENCE_THRESHOLD ?? 0.5,
    useMockModel: useMock,
    port: parsed.PORT ?? 8082,
    host: parsed.HOST,
    logLevel: parsed.LOG_LEVEL,
  };
}
