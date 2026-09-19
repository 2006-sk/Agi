import { detectTriggers } from "../engine/triggers.js";
import type { ModelExtraction } from "../schemas/model-output.js";
import type { ModelClient, ModelRawResponse } from "./client.js";
import { fallbackExtraction } from "./fallback.js";
import type { ModelMessages } from "./prompts.js";

export interface MockModelOptions {
  /** Utterance (case-insensitive, whitespace-normalized) -> partial extraction override. */
  script?: Record<string, Partial<ModelExtraction>>;
  /** Raw responses returned verbatim, in order, before any scripted behaviour. Use to simulate bad output. */
  queue?: string[];
  latencyMs?: number;
  /** Confidence reported for unscripted utterances. */
  defaultConfidence?: number;
}

function normalizeKey(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Richer canned output for the scripted medical demo so the offline path looks like the live one. */
export const DEMO_SCRIPT: Record<string, Partial<ModelExtraction>> = {
  [normalizeKey("Hi, um, my dad is having really bad chest pain")]: {
    category: "medical",
    category_confidence: 0.97,
    priority: "high",
    priority_confidence: 0.9,
    chief_complaint: "chest pain",
    facts: [
      { text: "chest pain", confidence: 0.98 },
      { text: "adult male", confidence: 0.9 },
      { text: "severe pain", confidence: 0.7 },
    ],
    people_at_risk: 1,
    summary: "Caller's father is experiencing severe chest pain.",
    confidence: 0.94,
  },
  [normalizeKey("We're at 170 St. Germain Avenue")]: {
    location_raw: "170 St. Germain Avenue",
    location_confidence: 0.95,
    summary: "Caller gives the address 170 St. Germain Avenue.",
    confidence: 0.93,
  },
  [normalizeKey("He's awake but sweating and can't catch his breath")]: {
    category: "medical",
    category_confidence: 0.9,
    priority: "high",
    priority_confidence: 0.85,
    conscious: "yes",
    breathing: "labored",
    facts: [
      { text: "sweating", confidence: 0.95 },
      { text: "shortness of breath", confidence: 0.95 },
    ],
    summary: "Patient is conscious, sweating, and short of breath.",
    confidence: 0.92,
  },
  [normalizeKey("Wait, he stopped breathing")]: {
    category: "medical",
    category_confidence: 0.95,
    priority: "critical",
    priority_confidence: 0.98,
    breathing: "no",
    facts: [{ text: "not breathing", confidence: 0.99 }],
    summary: "Caller reports the patient has stopped breathing.",
    confidence: 0.97,
  },
};

/**
 * Deterministic stand-in for the model. Unscripted utterances are answered by the
 * regex extractor with a high confidence so the offline pipeline still progresses.
 */
export class MockModelClient implements ModelClient {
  readonly kind = "mock" as const;
  readonly name = "mock-model";
  private readonly script: Record<string, Partial<ModelExtraction>>;
  private readonly queue: string[];
  private readonly latencyMs: number;
  private readonly defaultConfidence: number;
  calls = 0;

  constructor(options: MockModelOptions = {}) {
    this.script = Object.fromEntries(
      Object.entries({ ...DEMO_SCRIPT, ...(options.script ?? {}) }).map(([key, value]) => [normalizeKey(key), value]),
    );
    this.queue = [...(options.queue ?? [])];
    this.latencyMs = options.latencyMs ?? 0;
    this.defaultConfidence = options.defaultConfidence ?? 0.85;
  }

  async complete(messages: ModelMessages): Promise<ModelRawResponse> {
    this.calls += 1;
    if (this.latencyMs > 0) await new Promise((r) => setTimeout(r, this.latencyMs));
    const queued = this.queue.shift();
    if (queued !== undefined) return { content: queued, latency_ms: this.latencyMs, model: this.name };

    const base = fallbackExtraction(messages.utterance, {
      step: messages.stepId,
      lastPrompt: messages.stepId ? "(asked)" : null,
    });
    const scripted = this.script[normalizeKey(messages.utterance)];
    const extraction: ModelExtraction = {
      ...base,
      confidence: detectTriggers(messages.utterance).matched.length ? this.defaultConfidence : 0.6,
      ...(scripted ?? {}),
    };
    return { content: JSON.stringify(extraction), latency_ms: this.latencyMs, model: this.name };
  }
}
