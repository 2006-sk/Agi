import { describe, expect, it } from "vitest";
import { detectTriggers } from "../src/engine/triggers.js";

describe("deterministic triggers", () => {
  it("detects the demo escalation phrase and marks it critical", () => {
    const r = detectTriggers("Wait, he stopped breathing");
    expect(r.signals.breathing).toBe("no");
    expect(r.facts).toContain("not breathing");
    expect(r.category).toBe("medical");
    expect(r.priority_hint).toBe("critical");
    expect(r.matched).toContain("not_breathing");
  });

  it.each([
    "he's not breathing",
    "I don't think he's breathing",
    "she isn't breathing anymore",
    "no pulse, nothing",
    "his breathing has stopped",
    "he is not breathing normally",
  ])("treats %j as not breathing", (utterance) => {
    expect(detectTriggers(utterance).signals.breathing).toBe("no");
  });

  it.each([
    "he can't catch his breath",
    "she's having trouble breathing",
    "he can't breathe",
    "he's gasping",
    "he's breathing really fast",
  ])("treats %j as labored breathing, not arrest", (utterance) => {
    const r = detectTriggers(utterance);
    expect(r.signals.breathing).toBe("labored");
    expect(r.priority_hint).toBe("high");
    expect(r.matched).not.toContain("not_breathing");
  });

  it("recognises normal breathing without over-triggering", () => {
    expect(detectTriggers("he is breathing normally").signals.breathing).toBe("normal");
    expect(detectTriggers("yes she's breathing").signals.breathing).toBe("normal");
    expect(detectTriggers("he's breathing but it's weird").signals.breathing).toBeUndefined();
  });

  it("separates unresponsive from responsive phrasing", () => {
    expect(detectTriggers("he's not responding").signals.conscious).toBe("no");
    expect(detectTriggers("she passed out").signals.conscious).toBe("no");
    expect(detectTriggers("he won't wake up").signals.conscious).toBe("no");
    expect(detectTriggers("he is responding to me").signals.conscious).toBe("yes");
    expect(detectTriggers("He's awake but sweating").signals.conscious).toBe("yes");
    expect(detectTriggers("he's not awake").signals.conscious).toBe("no");
    expect(detectTriggers("he's unconscious").signals.conscious).toBe("no");
  });

  it("extracts chest pain, relation and priority from the demo opener", () => {
    const r = detectTriggers("Hi, um, my dad is having really bad chest pain");
    expect(r.facts).toEqual(expect.arrayContaining(["chest pain", "adult male"]));
    expect(r.category).toBe("medical");
    expect(r.priority_hint).toBe("high");
    expect(r.chief_complaint).toBe("chest pain");
    expect(r.people_at_risk).toBe(1);
  });

  it("captures street addresses including units", () => {
    expect(detectTriggers("We're at 170 St. Germain Avenue").location_raw).toBe("170 St. Germain Avenue");
    expect(detectTriggers("it's 1800 Market Street apt 4B, hurry").location_raw).toBe("1800 Market Street apt 4B");
    expect(detectTriggers("somewhere on the hill").location_raw).toBeNull();
  });

  it("captures hazards, people counts and other categories", () => {
    const r = detectTriggers("there's a gas smell and two people are hurt, I think the kitchen is on fire");
    expect(r.hazards).toContain("gas smell");
    expect(r.people_at_risk).toBe(2);
    expect(r.category).toBe("fire");
    expect(detectTriggers("someone has a gun and shot my neighbor").category).toBe("police");
    expect(detectTriggers("someone has a gun").hazards).toContain("weapon present");
  });

  it("interprets short yes/no answers against the question that was asked", () => {
    const ctx = (step: string) => ({ step, lastPrompt: "Is the person breathing normally right now?" });
    expect(detectTriggers("no", ctx("breathing_check")).signals.breathing).toBe("no");
    expect(detectTriggers("No, he's not", ctx("breathing_check")).signals.breathing).toBe("no");
    expect(detectTriggers("yeah", ctx("breathing_check")).signals.breathing).toBe("normal");
    expect(detectTriggers("no", ctx("conscious_check")).signals.conscious).toBe("no");
    expect(detectTriggers("yes he is", ctx("conscious_check")).signals.conscious).toBe("yes");
    // Without a question context a bare "no" means nothing.
    expect(detectTriggers("no").signals).toEqual({});
    // Not applied at unrelated steps.
    expect(detectTriggers("no", ctx("collect_hazards")).signals).toEqual({});
  });

  it("returns an empty result for empty or irrelevant text", () => {
    expect(detectTriggers("   ").matched).toEqual([]);
    const r = detectTriggers("hello, can you hear me?");
    expect(r.matched).toEqual([]);
    expect(r.category).toBeNull();
    expect(r.priority_hint).toBeNull();
  });
});
