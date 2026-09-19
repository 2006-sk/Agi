// Deterministic medical scenario used until (and whenever) the live gateway is unavailable.
// It emits exactly the event envelope the gateway will send, so no visual component can tell the difference.
// Times are seconds from scenario start.
import type { Speaker } from "@/lib/contracts";

export type ScriptEvent = { at: number; session: string; type: string; payload: Record<string, unknown> };
export type AudioWindow = { session: string; speaker: Speaker; from: number; to: number; intensity: number };
export type Script = { events: ScriptEvent[]; audio: AudioWindow[] };

export const PRIMARY_SESSION = "call_001";

const ADDRESS = {
  raw: "170 St. Germain Avenue",
  normalized: "170 St Germain Ave, San Francisco, CA",
  latitude: 37.754,
  longitude: -122.452,
};

export const UNITS = [
  { id: "ems_12", callsign: "MEDIC 12", service: "EMS", latitude: 37.7655, longitude: -122.441, eta_seconds: 240, selected: true },
  { id: "ems_07", callsign: "MEDIC 07", service: "EMS", latitude: 37.747, longitude: -122.429, eta_seconds: 420, selected: false },
  { id: "ems_21", callsign: "MEDIC 21", service: "EMS", latitude: 37.772, longitude: -122.464, eta_seconds: 510, selected: false },
];

type Builder = {
  ev: (at: number, type: string, payload: Record<string, unknown>, session?: string) => void;
  callerSays: (from: number, to: number, text: string, confidence?: number) => void;
  agentSays: (from: number, to: number, text: string, cutAt?: number) => void;
  script: Script;
};

const builder = (): Builder => {
  const script: Script = { events: [], audio: [] };
  const ev: Builder["ev"] = (at, type, payload, session = PRIMARY_SESSION) => {
    script.events.push({ at, session, type, payload });
  };
  return {
    script,
    ev,
    callerSays(from, to, text, confidence = 0.93) {
      const words = text.split(" ");
      const steps = Math.min(words.length, Math.max(3, Math.round((to - from) / 0.4)));
      for (let k = 1; k < steps; k++) {
        ev(from + ((to - from - 0.25) * k) / steps, "transcript.partial", {
          speaker: "caller",
          text: words.slice(0, Math.ceil((words.length * k) / steps)).join(" "),
          confidence: Math.max(0.5, confidence - 0.12),
        });
      }
      ev(to, "transcript.final", { speaker: "caller", text, confidence });
      script.audio.push({ session: PRIMARY_SESSION, speaker: "caller", from, to: to - 0.15, intensity: 0.9 });
    },
    agentSays(from, to, text, cutAt) {
      ev(from, "agent.speaking", { active: true, text });
      script.audio.push({ session: PRIMARY_SESSION, speaker: "agent", from, to: cutAt ?? to, intensity: 0.7 });
      if (cutAt === undefined) {
        ev(to, "agent.speaking", { active: false, text });
        ev(to + 0.02, "transcript.final", { speaker: "agent", text });
      }
    },
  };
};

const incident = (over: Record<string, unknown>) => ({
  session_id: PRIMARY_SESSION,
  category: "medical",
  priority: "pending",
  status: "active",
  location: { raw: ADDRESS.raw, normalized: null, latitude: null, longitude: null, confidence: 0.58, verified: false },
  people_at_risk: 1,
  facts: ["chest pain"],
  hazards: [],
  missing_fields: ["verified_address", "patient_age", "consciousness", "breathing"],
  protocol: { id: "MED_CHEST_PAIN_01", step: "address_verification" },
  recommended_services: [],
  confidence: 0.61,
  human_required: false,
  ...over,
});

const verifiedLocation = { ...ADDRESS, confidence: 0.96, verified: true };

/** Main scenario: runs until the human-approval gate opens, then waits for a person. */
export const medicalScenario = (): Script => {
  const b = builder();
  const { ev, callerSays, agentSays } = b;

  // --- the room is already busy: human dispatchers are occupied, which is why this call overflows to AURA ---
  ev(0.4, "call.started", { caller_label: "Landline · Mission", language: "en", channel: "Line 1", ambient: true, handled_by: "Dispatcher 2", elapsed_seconds: 252 }, "call_101");
  ev(0.5, "incident.updated", {
    session_id: "call_101", category: "traffic", priority: "urgent", status: "active",
    location: { raw: "Market St at 9th St", normalized: "Market St & 9th St, San Francisco, CA", latitude: 37.7765, longitude: -122.4165, confidence: 0.98, verified: true },
    people_at_risk: 2, facts: ["two vehicles", "no entrapment"], hazards: ["fuel leak"], missing_fields: [],
    protocol: { id: "TRF_COLLISION_02", step: "units_en_route" }, recommended_services: ["EMS", "POLICE"], confidence: 0.97, human_required: false,
  }, "call_101");

  ev(1.3, "call.started", { caller_label: "Mobile · Outer Sunset", language: "en", channel: "Line 2", ambient: true, handled_by: "Dispatcher 4", elapsed_seconds: 97 }, "call_102");
  ev(1.4, "incident.updated", {
    session_id: "call_102", category: "fire", priority: "routine", status: "active",
    location: { raw: "Noriega St near 28th Ave", normalized: "Noriega St & 28th Ave, San Francisco, CA", latitude: 37.7395, longitude: -122.4745, confidence: 0.91, verified: true },
    people_at_risk: 0, facts: ["smoke odour", "no visible flames"], hazards: [], missing_fields: [],
    protocol: { id: "FIR_SMOKE_01", step: "caller_interview" }, recommended_services: ["FIRE"], confidence: 0.88, human_required: false,
  }, "call_102");

  // --- the overflow call ---
  ev(3.0, "call.started", { caller_label: "Mobile · unknown caller", language: "en", channel: "Overflow line 3" });
  agentSays(3.6, 8.2, "Emergency intake, this is AURA. A human dispatcher is supervising this call. What is the address of the emergency?");

  callerSays(8.7, 12.6, "It's my dad, he's got really bad chest pain. We're at 170 St. Germain Avenue.", 0.91);

  ev(12.8, "tool.started", { tool_name: "locate_address", safe_arguments: { query: ADDRESS.raw } });
  ev(13.0, "incident.updated", incident({}));
  ev(13.05, "protocol.changed", { protocol_id: "MED_CHEST_PAIN_01", previous_step: null, current_step: "address_verification", reason: "Caller reported chest pain" });
  ev(14.1, "tool.completed", { tool_name: "locate_address", result_summary: "170 St Germain Ave, San Francisco · match 0.96" });
  ev(14.2, "incident.updated", incident({
    location: verifiedLocation,
    missing_fields: ["patient_age", "consciousness", "breathing"],
    protocol: { id: "MED_CHEST_PAIN_01", step: "patient_assessment" },
    confidence: 0.7,
  }));
  ev(14.25, "protocol.changed", { protocol_id: "MED_CHEST_PAIN_01", previous_step: "address_verification", current_step: "patient_assessment", reason: "Address verified" });
  ev(14.4, "tool.started", { tool_name: "classify_incident", safe_arguments: { facts: ["chest pain"] } });
  ev(15.2, "tool.completed", { tool_name: "classify_incident", result_summary: "Medical · chest pain · urgent" });
  ev(15.3, "incident.updated", incident({
    location: verifiedLocation,
    priority: "urgent",
    missing_fields: ["patient_age", "consciousness", "breathing"],
    protocol: { id: "MED_CHEST_PAIN_01", step: "patient_assessment" },
    recommended_services: ["EMS"],
    confidence: 0.78,
  }));

  agentSays(14.6, 19.4, "I have 170 St. Germain Avenue in San Francisco. How old is your father, and is he awake right now?");
  callerSays(19.9, 23.6, "He's sixty-four. He's awake but he's sweating a lot and he looks grey.", 0.94);

  ev(23.8, "tool.started", { tool_name: "verify_facts", safe_arguments: { protocol: "MED_CHEST_PAIN_01" } });
  ev(24.0, "incident.updated", incident({
    location: verifiedLocation,
    priority: "urgent",
    facts: ["chest pain", "male", "64 years", "conscious", "sweating heavily"],
    missing_fields: ["breathing"],
    protocol: { id: "MED_CHEST_PAIN_01", step: "symptom_assessment" },
    recommended_services: ["EMS"],
    confidence: 0.86,
  }));
  ev(24.05, "protocol.changed", { protocol_id: "MED_CHEST_PAIN_01", previous_step: "patient_assessment", current_step: "symptom_assessment", reason: "Age and consciousness confirmed" });
  ev(24.8, "tool.completed", { tool_name: "verify_facts", result_summary: "4 of 5 required fields confirmed" });

  // AURA is mid-sentence when the caller barges in.
  agentSays(24.6, 30.0, "Thank you. I'm arranging help now. Is he breathing normally, and does he have any history of heart problems?", 27.3);
  ev(27.0, "transcript.partial", { speaker: "caller", text: "Wait—", confidence: 0.8 });
  ev(27.3, "agent.interrupted", { interrupted_text: "Thank you. I'm arranging help now. Is he breathing normally, and does he—", reason: "caller_barge_in" });
  b.script.audio.push({ session: PRIMARY_SESSION, speaker: "caller", from: 27.0, to: 29.3, intensity: 1 });
  ev(27.7, "transcript.partial", { speaker: "caller", text: "Wait— he just collapsed.", confidence: 0.86 });
  ev(28.5, "transcript.partial", { speaker: "caller", text: "Wait— he just collapsed. He stopped breathing.", confidence: 0.9 });
  ev(29.4, "transcript.final", { speaker: "caller", text: "Wait— he just collapsed. He stopped breathing. He stopped breathing!", confidence: 0.95 });

  const critical = {
    location: verifiedLocation,
    priority: "critical",
    facts: ["chest pain", "male", "64 years", "collapsed", "unresponsive", "not breathing"],
    missing_fields: [],
    recommended_services: ["EMS"],
    confidence: 0.94,
    human_required: true,
  };
  ev(29.6, "incident.updated", incident({ ...critical, protocol: { id: "MED_CARDIAC_01", step: "cardiac_arrest_confirmed" } }));
  ev(29.65, "protocol.changed", { protocol_id: "MED_CARDIAC_01", previous_step: "MED_CHEST_PAIN_01/symptom_assessment", current_step: "cardiac_arrest_confirmed", reason: "Caller reported the patient collapsed and stopped breathing" });

  ev(29.9, "tool.started", { tool_name: "find_nearest_units", safe_arguments: { service: "EMS", near: ADDRESS.normalized } });
  agentSays(30.2, 33.4, "I'm getting help to you right now. Stay on the line with me.");
  ev(31.0, "tool.completed", { tool_name: "find_nearest_units", result_summary: "3 EMS units in range · MEDIC 12 closest" });
  ev(31.2, "tool.started", { tool_name: "prepare_ems_dispatch", safe_arguments: { unit: "MEDIC 12", protocol: "MED_CARDIAC_01" } });
  ev(32.0, "dispatch.proposed", {
    services: ["EMS"],
    units: UNITS,
    route: { points: [], distance_m: 2100, eta_seconds: 240 },
    reason: "Suspected cardiac arrest. MEDIC 12 is the closest available advanced life support unit.",
  });
  ev(32.1, "tool.completed", { tool_name: "prepare_ems_dispatch", result_summary: "Response prepared · awaiting human approval" });
  ev(32.4, "incident.updated", incident({ ...critical, protocol: { id: "MED_CARDIAC_01", step: "human_dispatch_approval" } }));
  ev(32.45, "protocol.changed", { protocol_id: "MED_CARDIAC_01", previous_step: "cardiac_arrest_confirmed", current_step: "human_dispatch_approval", reason: "Dispatch is a consequential action and needs a human" });
  ev(32.7, "approval.requested", { action: "Dispatch MEDIC 12 to 170 St Germain Ave", risk: "critical", timeout_seconds: 45 });

  b.script.events.sort((x, y) => x.at - y.at);
  return b.script;
};

/** Continuation once a human answers the gate. Times are seconds after the decision. */
export const approvalOutcome = (approved: boolean): Script => {
  const b = builder();
  const { ev, agentSays } = b;
  const base = {
    location: verifiedLocation,
    priority: "critical",
    facts: ["chest pain", "male", "64 years", "collapsed", "unresponsive", "not breathing"],
    missing_fields: [],
    recommended_services: ["EMS"],
    confidence: 0.94,
    human_required: true,
  };

  ev(0, "approval.resolved", { approved, reviewer: "Supervisor console" });
  if (approved) {
    ev(0.25, "tool.started", { tool_name: "dispatch_unit", safe_arguments: { unit: "MEDIC 12" } });
    ev(1.0, "tool.completed", { tool_name: "dispatch_unit", result_summary: "MEDIC 12 acknowledged · en route" });
    ev(1.1, "incident.updated", incident({ ...base, status: "dispatched", protocol: { id: "MED_CARDIAC_01", step: "responder_en_route" } }));
    ev(1.15, "protocol.changed", { protocol_id: "MED_CARDIAC_01", previous_step: "human_dispatch_approval", current_step: "responder_en_route", reason: "Response approved by a human reviewer" });
    agentSays(1.5, 6.2, "An ambulance is on its way to you now. Stay on the line. A dispatcher is joining us to guide you.");
  } else {
    ev(0.4, "incident.updated", incident({ ...base, status: "escalated", protocol: { id: "MED_CARDIAC_01", step: "handover_to_dispatcher" } }));
    ev(0.45, "protocol.changed", { protocol_id: "MED_CARDIAC_01", previous_step: "human_dispatch_approval", current_step: "handover_to_dispatcher", reason: "Reviewer rejected the proposed response" });
    agentSays(1.0, 4.6, "Please stay on the line. A dispatcher is taking over this call now.");
  }
  b.script.events.sort((x, y) => x.at - y.at);
  return b.script;
};
