import type { Category, Priority, Service } from "../contracts/index.ts";

export const PRIORITY_COLORS: Record<Priority, string> = {
  unknown: "#64748b",
  low: "#38bdf8",
  medium: "#fbbf24",
  high: "#fb923c",
  critical: "#ef4444",
};

export const PRIORITY_PERIOD_S: Record<Priority, number> = {
  unknown: 3.2,
  low: 2.8,
  medium: 2.1,
  high: 1.5,
  critical: 0.85,
};

export const SERVICE_COLORS: Record<Service, string> = {
  EMS: "#2dd4bf",
  FIRE: "#f97316",
  POLICE: "#60a5fa",
};

export const CATEGORY_LABEL: Record<Category, string> = {
  unknown: "Unclassified",
  medical: "Medical",
  fire: "Fire",
  police: "Police",
  other: "Other",
};

export const ECHO_COLOR = "#22d3ee";

export function priorityColor(priority: Priority | undefined | null): string {
  return PRIORITY_COLORS[priority ?? "unknown"];
}

export function serviceColor(service: string): string {
  return (SERVICE_COLORS as Record<string, string>)[service] ?? "#a3a3a3";
}
