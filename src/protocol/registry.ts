import type { Category, Service } from "../schemas/incident.js";
import { loadProtocolFile, type ProtocolDefinition } from "./definition.js";
import { ProtocolMachine } from "./machine.js";

const MEDICAL = loadProtocolFile(new URL("./medical.json", import.meta.url));
const GENERAL = loadProtocolFile(new URL("./general_intake.json", import.meta.url));

const DEFINITIONS: ProtocolDefinition[] = [MEDICAL, GENERAL];

const MACHINES = new Map<string, ProtocolMachine>(DEFINITIONS.map((d) => [d.id, new ProtocolMachine(d)]));

const PROTOCOL_BY_CATEGORY: Record<Category, string> = {
  medical: MEDICAL.id,
  fire: GENERAL.id,
  police: GENERAL.id,
  other: GENERAL.id,
  unknown: GENERAL.id,
};

const SERVICES_BY_CATEGORY: Record<Category, Service[]> = {
  medical: ["EMS"],
  fire: ["FIRE", "EMS"],
  police: ["POLICE"],
  other: [],
  unknown: [],
};

export function listProtocols(): ProtocolDefinition[] {
  return DEFINITIONS;
}

export function getProtocol(id: string | null | undefined): ProtocolMachine | undefined {
  return id ? MACHINES.get(id) : undefined;
}

export function protocolForCategory(category: Category): ProtocolMachine {
  const machine = MACHINES.get(PROTOCOL_BY_CATEGORY[category]);
  if (!machine) throw new Error(`no protocol registered for category ${category}`);
  return machine;
}

export function servicesForCategory(category: Category): Service[] {
  return SERVICES_BY_CATEGORY[category];
}
