import type { Signals } from "../protocol/machine.js";
import type { Category, Priority } from "../schemas/incident.js";

/**
 * Deterministic trigger layer. Runs on every utterance alongside the model so that
 * state-changing phrases ("he stopped breathing") always take effect within the
 * turn, even if the model is slow, wrong, or unavailable.
 */

export interface TriggerContext {
  /** Protocol step whose question the caller is answering (if one was asked). */
  step?: string | null;
  lastPrompt?: string | null;
}

export interface TriggerResult {
  signals: Signals;
  facts: string[];
  hazards: string[];
  category: Category | null;
  priority_hint: Priority | null;
  location_raw: string | null;
  people_at_risk: number | null;
  chief_complaint: string | null;
  matched: string[];
}

interface Rule {
  id: string;
  patterns: RegExp[];
  /** Skip this rule when any of these rules already matched (negatives win over positives). */
  unless?: string[];
  apply: (result: TriggerResult, match: RegExpMatchArray) => void;
}

const NOT_BREATHING: RegExp[] = [
  /\b(?:stopp?ed|quit|ceased)\s+breathing\b/i,
  /\b(?:is\s*n[o']t|isn'?t|not|no longer|ain'?t|has\s*n[o']t|hasn'?t|does\s*n[o']t|doesn'?t seem to be|don'?t think (?:he|she|they)(?:'s| is| are)?)\s+breath(?:e|ing)\b/i,
  /\bno (?:breath|breathing|pulse)\b/i,
  /\bbreathing (?:has )?stopped\b/i,
  /\bnot breathing\b/i,
];

const LABORED_BREATHING: RegExp[] = [
  /\b(?:can'?t|cannot|can not|hard to|trouble|difficulty|difficult|struggling to|struggles to|short of|shortness of|labou?red)\W+(?:\w+\W+){0,3}?breath/i,
  /\bcatch (?:his|her|their|my) breath\b/i,
  /\b(?:gasping|wheezing)\b/i,
  /\bbreathing (?:\w+ ){0,2}?(?:hard|heavy|heavily|fast|rapidly|weird|funny|strange|shallow)\b/i,
];

const NORMAL_BREATHING: RegExp[] = [
  /\bbreathing (?:normally|fine|ok(?:ay)?|regularly|steadily|normal)\b/i,
  /\b(?:he|she|they)(?:'s| is| are) breathing\b(?!\s+(?:hard|heavy|heavily|fast|rapidly|weird|funny|strange|shallow|but))/i,
];

const UNCONSCIOUS: RegExp[] = [
  /\b(?:unconscious|unresponsive|passed out|blacked out|fainted|knocked out|out cold)\b/i,
  /\b(?:not|isn'?t|is not|won'?t|will not|doesn'?t|does not|can'?t|cannot)\s+(?:\w+\s+){0,2}?(?:respond(?:ing)?|wak(?:e|ing) up|answer(?:ing)?|mov(?:e|ing)|talk(?:ing)?|conscious|awake|alert)\b/i,
  /\bno response\b/i,
];

const CONSCIOUS: RegExp[] = [
  /\b(?<!\bnot\s)(?<!\bisn'?t\s)(?<!\bnot\s\w+\s)(?:awake|alert|conscious|responsive|responding|talking|answering)\b/i,
  /\b(?:he|she|they)(?:'s| is| are) (?:okay|ok|fine) now\b/i,
];

const ADDRESS =
  /\b(\d{1,6})\s+((?:[A-Za-z][A-Za-z.'-]*\s+){1,4}?)(Street|St\.?|Avenue|Ave\.?|Boulevard|Blvd\.?|Road|Rd\.?|Drive|Dr\.?|Lane|Ln\.?|Way|Court|Ct\.?|Place|Pl\.?|Terrace|Ter\.?|Highway|Hwy\.?|Parkway|Pkwy\.?|Circle|Cir\.?)\b\.?(?:\s*,?\s*(?:apt\.?|apartment|unit|suite|#)\s*([\w-]+))?/i;

const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

const PEOPLE =
  /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:people|persons|patients|victims|kids|children|adults|passengers)\b/i;

const YES = /^\W*(?:yes|yeah|yep|yup|uh[- ]huh|he is|she is|they are|i think so|correct|right|affirmative)\b/i;
const NO = /^\W*(?:no|nope|nah|uh[- ]uh|he'?s not|she'?s not|he isn'?t|she isn'?t|not really|i don'?t think so|negative)\b/i;

function addUnique(list: string[], value: string): void {
  const v = value.trim().toLowerCase();
  if (v && !list.includes(v)) list.push(v);
}

function raisePriority(result: TriggerResult, priority: Priority): void {
  const rank: Record<Priority, number> = { unknown: 0, low: 1, medium: 2, high: 3, critical: 4 };
  if (!result.priority_hint || rank[priority] > rank[result.priority_hint]) result.priority_hint = priority;
}

function setCategory(result: TriggerResult, category: Category): void {
  // Medical wins ties: a person in danger is what the protocol asks about first.
  if (!result.category || category === "medical") result.category = category;
}

const RULES: Rule[] = [
  {
    id: "not_breathing",
    patterns: NOT_BREATHING,
    apply: (r) => {
      r.signals.breathing = "no";
      addUnique(r.facts, "not breathing");
      setCategory(r, "medical");
      raisePriority(r, "critical");
      r.chief_complaint ??= "not breathing";
    },
  },
  {
    id: "unconscious",
    patterns: UNCONSCIOUS,
    apply: (r) => {
      r.signals.conscious = "no";
      addUnique(r.facts, "unresponsive");
      setCategory(r, "medical");
      raisePriority(r, "critical");
      r.chief_complaint ??= "unresponsive patient";
    },
  },
  {
    id: "labored_breathing",
    patterns: LABORED_BREATHING,
    unless: ["not_breathing"],
    apply: (r) => {
      r.signals.breathing = "labored";
      addUnique(r.facts, "difficulty breathing");
      setCategory(r, "medical");
      raisePriority(r, "high");
    },
  },
  {
    id: "normal_breathing",
    patterns: NORMAL_BREATHING,
    unless: ["not_breathing", "labored_breathing"],
    apply: (r) => {
      r.signals.breathing = "normal";
    },
  },
  {
    id: "conscious",
    patterns: CONSCIOUS,
    unless: ["unconscious"],
    apply: (r) => {
      r.signals.conscious = "yes";
    },
  },
  {
    id: "chest_pain",
    patterns: [/\bchest (?:pain|pains|pressure|tightness|discomfort|hurts?)\b/i, /\bpain in (?:his|her|their|my|the) chest\b/i, /\bheart attack\b/i],
    apply: (r) => {
      addUnique(r.facts, "chest pain");
      setCategory(r, "medical");
      raisePriority(r, "high");
      r.chief_complaint ??= "chest pain";
    },
  },
  {
    id: "sweating",
    patterns: [/\bsweat(?:ing|y)\b/i, /\bclammy\b/i],
    apply: (r) => addUnique(r.facts, "sweating"),
  },
  {
    id: "seizure",
    patterns: [/\bseizure|seizing|convuls/i],
    apply: (r) => {
      addUnique(r.facts, "seizure");
      setCategory(r, "medical");
      raisePriority(r, "high");
      r.chief_complaint ??= "seizure";
    },
  },
  {
    id: "stroke",
    patterns: [/\bstroke\b/i, /\bslurred speech\b/i, /\bface (?:is )?droop/i],
    apply: (r) => {
      addUnique(r.facts, "possible stroke");
      setCategory(r, "medical");
      raisePriority(r, "high");
      r.chief_complaint ??= "possible stroke";
    },
  },
  {
    id: "bleeding",
    patterns: [/\bbleeding\b/i, /\bblood everywhere\b/i],
    apply: (r) => {
      addUnique(r.facts, "bleeding");
      setCategory(r, "medical");
      raisePriority(r, "high");
      r.chief_complaint ??= "bleeding";
    },
  },
  {
    id: "choking",
    patterns: [/\bchoking\b/i],
    apply: (r) => {
      addUnique(r.facts, "choking");
      setCategory(r, "medical");
      raisePriority(r, "critical");
      r.chief_complaint ??= "choking";
    },
  },
  {
    id: "overdose",
    patterns: [/\boverdos(?:e|ed|ing)\b/i, /\btook (?:too many|a bunch of) pills\b/i],
    apply: (r) => {
      addUnique(r.facts, "possible overdose");
      setCategory(r, "medical");
      raisePriority(r, "high");
      r.chief_complaint ??= "possible overdose";
    },
  },
  {
    id: "fire",
    patterns: [/\b(?:fire|flames|on fire|smoke)\b/i, /\bburning\b/i],
    apply: (r) => {
      addUnique(r.facts, "fire reported");
      setCategory(r, "fire");
      raisePriority(r, "high");
      r.chief_complaint ??= "fire";
    },
  },
  {
    id: "violence",
    patterns: [/\b(?:gun|shot|shooting|shots fired|stabbed|stabbing|robbery|robbed|break(?:ing)? in|intruder|assault(?:ed)?|attacked)\b/i],
    apply: (r) => {
      addUnique(r.facts, "violence reported");
      setCategory(r, "police");
      raisePriority(r, "high");
      r.chief_complaint ??= "violence";
    },
  },
  {
    id: "hazard_gas",
    patterns: [/\bgas (?:leak|smell)\b/i, /\bsmells? (?:like )?gas\b/i, /\bfumes\b/i],
    apply: (r) => addUnique(r.hazards, "gas smell"),
  },
  {
    id: "hazard_power_line",
    patterns: [/\bdowned (?:power )?lines?\b/i, /\bpower lines? (?:down|on the ground)\b/i],
    apply: (r) => addUnique(r.hazards, "downed power line"),
  },
  {
    id: "hazard_traffic",
    patterns: [/\b(?:busy|heavy|oncoming) traffic\b/i, /\bin the (?:middle of the )?(?:street|road|highway|freeway)\b/i],
    apply: (r) => addUnique(r.hazards, "traffic"),
  },
  {
    id: "hazard_weapon",
    patterns: [/\b(?:weapon|gun|knife|armed)\b/i],
    apply: (r) => addUnique(r.hazards, "weapon present"),
  },
  {
    id: "hazard_dog",
    patterns: [/\b(?:aggressive|loose|big) dog\b/i, /\bdog (?:is )?(?:loose|barking|aggressive)\b/i],
    apply: (r) => addUnique(r.hazards, "dog on premises"),
  },
  {
    id: "relation_adult_male",
    patterns: [/\bmy (?:dad|father|husband|grandfather|grandpa|boyfriend|uncle)\b/i],
    apply: (r) => {
      addUnique(r.facts, "adult male");
      r.people_at_risk ??= 1;
    },
  },
  {
    id: "relation_adult_female",
    patterns: [/\bmy (?:mom|mother|wife|grandmother|grandma|girlfriend|aunt)\b/i],
    apply: (r) => {
      addUnique(r.facts, "adult female");
      r.people_at_risk ??= 1;
    },
  },
  {
    id: "relation_child",
    patterns: [/\bmy (?:baby|toddler|son|daughter|kid|child)\b/i],
    apply: (r) => {
      addUnique(r.facts, "child involved");
      r.people_at_risk ??= 1;
      raisePriority(r, "high");
    },
  },
];

export function detectTriggers(utterance: string, ctx: TriggerContext = {}): TriggerResult {
  const result: TriggerResult = {
    signals: {},
    facts: [],
    hazards: [],
    category: null,
    priority_hint: null,
    location_raw: null,
    people_at_risk: null,
    chief_complaint: null,
    matched: [],
  };
  const text = utterance.replace(/\s+/g, " ").trim();
  if (!text) return result;

  for (const rule of RULES) {
    if (rule.unless?.some((id) => result.matched.includes(id))) continue;
    for (const pattern of rule.patterns) {
      const match = text.match(pattern);
      if (match) {
        rule.apply(result, match);
        result.matched.push(rule.id);
        break;
      }
    }
  }

  const address = text.match(ADDRESS);
  if (address) {
    result.location_raw = address[0].trim().replace(/[.,]+$/, "");
    result.matched.push("address");
  }

  const people = text.match(PEOPLE);
  if (people?.[1]) {
    const token = people[1].toLowerCase();
    const count = NUMBER_WORDS[token] ?? Number(token);
    if (Number.isFinite(count) && count > 0) {
      result.people_at_risk = count;
      result.matched.push("people_count");
    }
  }

  // Short yes/no answers are interpreted against the question AURA just asked.
  if (ctx.step && ctx.lastPrompt) {
    const yes = YES.test(text);
    const no = !yes && NO.test(text);
    if (ctx.step === "breathing_check" && !result.signals.breathing) {
      if (no) {
        result.signals.breathing = "no";
        addUnique(result.facts, "not breathing");
        raisePriority(result, "critical");
        result.matched.push("answer_no:breathing_check");
      } else if (yes) {
        result.signals.breathing = "normal";
        result.matched.push("answer_yes:breathing_check");
      }
    }
    if (ctx.step === "conscious_check" && !result.signals.conscious) {
      if (no) {
        result.signals.conscious = "no";
        addUnique(result.facts, "unresponsive");
        raisePriority(result, "critical");
        result.matched.push("answer_no:conscious_check");
      } else if (yes) {
        result.signals.conscious = "yes";
        result.matched.push("answer_yes:conscious_check");
      }
    }
  }

  return result;
}
