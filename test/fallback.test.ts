import { describe, expect, it } from "vitest";
import { extractJsonObject, runExtraction, type ModelClient } from "../src/model/client.js";
import { fallbackExtraction } from "../src/model/fallback.js";
import { MockModelClient } from "../src/model/mock.js";
import { buildExtractionMessages } from "../src/model/prompts.js";
import { createInitialState } from "../src/schemas/incident.js";
import { ModelExtraction } from "../src/schemas/model-output.js";

const messages = buildExtractionMessages({
  utterance: "Wait, he stopped breathing",
  state: createInitialState("call_fallback"),
  stepId: "breathing_check",
  stepGoal: "Determine whether the patient is breathing",
  lastPrompt: "Is the person breathing normally right now?",
});

describe("fallbackExtraction", () => {
  it("produces a schema-valid extraction from triggers alone", () => {
    const extraction = fallbackExtraction("Wait, he stopped breathing");
    expect(ModelExtraction.parse(extraction)).toEqual(extraction);
    expect(extraction.breathing).toBe("no");
    expect(extraction.priority).toBe("critical");
    expect(extraction.category).toBe("medical");
    expect(extraction.facts.map((f) => f.text)).toContain("not breathing");
    expect(extraction.confidence).toBeGreaterThan(0.5);
    expect(extraction.summary).toMatch(/not breathing/);
  });

  it("stays silent (low confidence, unknowns) when nothing matched", () => {
    const extraction = fallbackExtraction("hello can you hear me");
    expect(extraction.category).toBe("unknown");
    expect(extraction.breathing).toBe("unknown");
    expect(extraction.facts).toEqual([]);
    expect(extraction.confidence).toBeLessThan(0.5);
  });
});

describe("extractJsonObject", () => {
  it("strips code fences, reasoning blocks and surrounding prose", () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(extractJsonObject('<think>hmm</think>{"a":2}')).toEqual({ a: 2 });
    expect(extractJsonObject('Sure! Here it is: {"a":{"b":[1,2]}} thanks')).toEqual({ a: { b: [1, 2] } });
    expect(() => extractJsonObject("no json here")).toThrow(/no JSON object/);
  });
});

describe("runExtraction", () => {
  it("returns validated model output on the first attempt", async () => {
    const client = new MockModelClient();
    const outcome = await runExtraction(client, messages, { fallback: () => fallbackExtraction("x") });
    expect(outcome.source).toBe("mock");
    expect(outcome.validation).toBe("ok");
    expect(outcome.attempts).toBe(1);
    expect(outcome.extraction.breathing).toBe("no");
  });

  it("retries once after malformed output and includes the repair note", async () => {
    const client = new MockModelClient({ queue: ["this is not json"] });
    let repairNote: string | null = null;
    const outcome = await runExtraction(client, messages, {
      fallback: () => fallbackExtraction("x"),
      buildRepair: (note) => {
        repairNote = note;
        return buildExtractionMessages({
          utterance: messages.utterance,
          state: createInitialState("call_fallback"),
          stepId: "breathing_check",
          stepGoal: null,
          lastPrompt: null,
          repairNote: note,
        });
      },
    });
    expect(outcome.validation).toBe("retried");
    expect(outcome.attempts).toBe(2);
    expect(outcome.errors).toHaveLength(1);
    expect(repairNote).toMatch(/could not parse JSON/);
    expect(client.calls).toBe(2);
  });

  it("falls back to deterministic extraction after two schema violations", async () => {
    const bad = JSON.stringify({ category: "space", priority: "urgent" });
    const client = new MockModelClient({ queue: [bad, bad] });
    const outcome = await runExtraction(client, messages, {
      fallback: () => fallbackExtraction("Wait, he stopped breathing"),
    });
    expect(outcome.source).toBe("fallback");
    expect(outcome.validation).toBe("fallback");
    expect(outcome.errors).toHaveLength(2);
    expect(outcome.errors[0]).toMatch(/schema violation/);
    expect(outcome.extraction.breathing).toBe("no");
  });

  it("falls back when the model throws (timeout / network)", async () => {
    const failing: ModelClient = {
      name: "boom",
      kind: "model",
      complete: async () => {
        throw new Error("Request timed out");
      },
    };
    const outcome = await runExtraction(failing, messages, { fallback: () => fallbackExtraction("he passed out") });
    expect(outcome.source).toBe("fallback");
    expect(outcome.errors.every((e) => /timed out/.test(e))).toBe(true);
    expect(outcome.extraction.conscious).toBe("no");
  });
});
