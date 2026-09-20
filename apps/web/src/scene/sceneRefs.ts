/** Tiny mutable channel between the camera director and the scene shake wrapper. */
export const shake = {
  until: 0,
  intensity: 0,
  trigger(durationMs: number, intensity: number) {
    this.until = performance.now() + durationMs;
    this.intensity = intensity;
  },
};

export const FOG_DENSITY = 0.0024;
