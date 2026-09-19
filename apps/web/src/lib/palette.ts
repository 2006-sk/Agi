// Hex mirror of the CSS tokens in globals.css — Three.js cannot read CSS variables.
import type { Priority } from "./contracts";

export const palette = {
  void: "#04060a",
  abyss: "#070b12",
  navy900: "#0a1220",
  navy800: "#0f1b2e",
  navy700: "#16263f",
  edge: "#2b4468", // building edge lines at rest
  ink: "#dde7f3",
  ink2: "#8c9bb3",
  ink3: "#66758e",
  listen: "#54e0f5",
  reason: "#9b82ff",
  urgent: "#ffb547",
  critical: "#ff3d47",
  approved: "#42f0a2",
} as const;

export type SemanticColor = "listen" | "reason" | "urgent" | "critical" | "approved" | "ink2";

/** Priority → semantic colour. `pending`/`routine` stay neutral: colour is state, never decoration. */
export const priorityColor: Record<Priority, SemanticColor> = {
  pending: "ink2",
  routine: "listen",
  urgent: "urgent",
  critical: "critical",
};

export const priorityHex = (p: Priority): string => palette[priorityColor[p]];

/** CSS custom property for a semantic colour, e.g. `var(--color-urgent)`. */
export const cssVar = (c: SemanticColor): string => `var(--color-${c === "ink2" ? "ink-2" : c})`;

export const priorityRank: Record<Priority, number> = { critical: 0, urgent: 1, routine: 2, pending: 3 };

export const priorityLabel: Record<Priority, string> = {
  pending: "Assessing",
  routine: "Routine",
  urgent: "Urgent",
  critical: "Critical",
};
