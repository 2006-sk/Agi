// Motion tokens — see DESIGN.md §6.
export const dur = { fast: 0.12, base: 0.24, slow: 0.42, cine: 0.9 } as const;
export const easeOut = [0.2, 0.8, 0.2, 1] as const;
export const easeIn = [0.7, 0, 0.84, 0] as const;
export const layoutSpring = { type: "spring", stiffness: 420, damping: 38, mass: 0.9 } as const;

export const enter = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0, transition: { duration: dur.base, ease: easeOut } },
  exit: { opacity: 0, y: -4, transition: { duration: dur.fast, ease: easeIn } },
} as const;

/** Frame-rate independent damping: `value += (target - value) * damp(lambda, dt)`. Demo panel is 360 Hz. */
export const damp = (lambda: number, dt: number): number => 1 - Math.exp(-lambda * dt);
