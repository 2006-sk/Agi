/**
 * The golden path: a deterministic cardiac scenario.
 *
 * This is the demo safety net. It drives the real gateway, the real protocol
 * machine and the real approval gate — only the caller is scripted — so what the
 * judges see on the deterministic run is the same code path as the live call.
 * The only thing it skips is the microphone.
 */

export interface ScriptedUtterance {
  /** Milliseconds to wait before speaking this line. */
  delayMs: number;
  text: string;
  /** Marks the line that must visibly escalate the incident. */
  escalates?: boolean;
  note: string;
}

export const CARDIAC_SCRIPT: ScriptedUtterance[] = [
  {
    delayMs: 0,
    text: "Help, my father is clutching his chest and he can't breathe properly",
    note: "classify medical / high, open the cardiac protocol",
  },
  {
    delayMs: 900,
    text: "We're at 170 St. Germain Avenue",
    note: "address captured, geocoded and verified in one turn",
  },
  {
    delayMs: 900,
    text: "Yes he's awake but he's sweating a lot and says the pain goes down his arm",
    note: "consciousness confirmed, symptoms extracted",
  },
  {
    delayMs: 900,
    text: "Wait, he stopped breathing",
    escalates: true,
    note: "deterministic trigger: critical, jump to approval, EMS units + route",
  },
];

/** A second, non-escalating scenario used to prove the gate holds without a location. */
export const VAGUE_SCRIPT: ScriptedUtterance[] = [
  {
    delayMs: 0,
    text: "Someone collapsed near the park and he is not breathing",
    note: "critical without a verified address: no approval gate may open",
  },
];
