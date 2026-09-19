"use client";

// The incident itself, standing on the terrain: a vertical light beam plus radar rings on the ground.
//
//   colour      = the call's priority (pending/assessing stays neutral ink-2 — colour is state)
//   pulse       = the live caller audio for the active call, read from audioBus in useFrame (never React state)
//   cadence     = the category (medical double-beat, fire fast, police slow, traffic alternating)
//   searching   = loose: wide bands, a rotating uncertainty circle sized by location confidence, a drifting mark
//   locked      = loc.verified: bands snap tight, the circle collapses to a crosshair and settles
//   escalation  = ONE short outward shockwave. Never loops.

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  ShaderMaterial,
} from "three";
import type { Category } from "@/lib/contracts";
import { elevation, type Vec2 } from "@/lib/geo";
import { damp } from "@/lib/motion";
import { palette, priorityHex } from "@/lib/palette";
import { audioBus } from "@/state/audioBus";
import { useAura, type CallState } from "@/state/auraStore";
import { agentMode, scenePhase } from "@/state/selectors";

const scratch: Vec2 = [0, 0];

// ---------------------------------------------------------------------------
// Shared geometry — built once, reused by every beacon on the map.
// ---------------------------------------------------------------------------
let beamGeo: BufferGeometry | null = null;
const beam = (): BufferGeometry => {
  if (!beamGeo) {
    const g = new CylinderGeometry(0.5, 1, 1, 12, 1, true);
    g.translate(0, 0.5, 0); // local y runs 0..1 from the ground up
    beamGeo = g;
  }
  return beamGeo;
};

const segments = (pairs: number[][]): BufferGeometry => {
  const pos = new Float32Array(pairs.length * 6);
  pairs.forEach((p, i) => {
    pos[i * 6] = p[0];
    pos[i * 6 + 1] = 0;
    pos[i * 6 + 2] = p[1];
    pos[i * 6 + 3] = p[2];
    pos[i * 6 + 4] = 0;
    pos[i * 6 + 5] = p[3];
  });
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(pos, 3));
  g.computeBoundingSphere();
  return g;
};

const polygon = (sides: number, radius: number, phase = 0): number[][] => {
  const out: number[][] = [];
  for (let i = 0; i < sides; i++) {
    const a = phase + (i / sides) * Math.PI * 2;
    const b = phase + ((i + 1) / sides) * Math.PI * 2;
    out.push([Math.cos(a) * radius, Math.sin(a) * radius, Math.cos(b) * radius, Math.sin(b) * radius]);
  }
  return out;
};

/** Category marks. Small, etched, legible from the default camera — not cute, not an icon tile. */
const MARK_PAIRS: Record<Category, number[][]> = {
  medical: [
    [-1, 0, 1, 0],
    [0, -1, 0, 1],
  ],
  fire: [
    [-0.85, -0.7, 0, 0.95],
    [0, 0.95, 0.85, -0.7],
    [-0.44, -0.72, 0, -0.06],
    [0, -0.06, 0.44, -0.72],
  ],
  police: [...polygon(6, 0.95, Math.PI / 6), [0, -0.45, 0, 0.45]],
  traffic: [
    [-0.85, -0.85, 0.85, 0.85],
    [-0.85, 0.85, 0.85, -0.85],
    [-1, 0, -0.45, 0],
    [0.45, 0, 1, 0],
  ],
  other: polygon(4, 0.8, Math.PI / 4),
  unknown: [
    [-0.9, -0.9, -0.3, -0.9],
    [0.3, -0.9, 0.9, -0.9],
    [0.9, -0.3, 0.9, 0.3],
    [0.9, 0.9, 0.3, 0.9],
    [-0.3, 0.9, -0.9, 0.9],
    [-0.9, 0.3, -0.9, -0.3],
  ],
};

const markCache = new Map<Category, BufferGeometry>();
const markGeometry = (c: Category): BufferGeometry => {
  const hit = markCache.get(c);
  if (hit) return hit;
  const g = segments(MARK_PAIRS[c]);
  markCache.set(c, g);
  return g;
};

let crossGeo: BufferGeometry | null = null;
/** The locked pin: four inward ticks plus a tight circle. Precision, not decoration. */
const crosshair = (): BufferGeometry => {
  if (!crossGeo) {
    crossGeo = segments([
      [0, 0.72, 0, 1.18],
      [0, -0.72, 0, -1.18],
      [0.72, 0, 1.18, 0],
      [-0.72, 0, -1.18, 0],
      ...polygon(24, 0.55),
    ]);
  }
  return crossGeo;
};

let searchGeo: BufferGeometry | null = null;
/** The searching circle: dashed, because the location is not confirmed yet. */
const searchRing = (): BufferGeometry => {
  if (!searchGeo) {
    const pairs: number[][] = [];
    const dashes = 22;
    for (let i = 0; i < dashes; i++) {
      const a = (i / dashes) * Math.PI * 2;
      const b = a + (Math.PI * 2) / dashes / 2;
      pairs.push([Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b)]);
    }
    searchGeo = segments(pairs);
  }
  return searchGeo;
};

/** Concentric terrain-following annuli. `aR` is the normalised radius the ring shader sweeps through. */
const buildRings = (centre: Vec2, maxRadius: number, rings: number, segs: number, lift: number): BufferGeometry => {
  const vCount = rings * (segs + 1) * 2;
  const pos = new Float32Array(vCount * 3);
  const aR = new Float32Array(vCount);
  const idx: number[] = [];
  let v = 0;
  for (let r = 0; r < rings; r++) {
    const f = (r + 1) / rings;
    const rad = maxRadius * f;
    const w = maxRadius * 0.024 + 0.012;
    const base = v;
    for (let s = 0; s <= segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      const cx = Math.cos(a);
      const cz = Math.sin(a);
      for (let e = 0; e < 2; e++) {
        const rr = e === 0 ? Math.max(0.015, rad - w) : rad + w;
        const dx = cx * rr;
        const dz = cz * rr;
        scratch[0] = centre[0] + dx;
        scratch[1] = centre[1] + dz;
        pos[v * 3] = dx;
        pos[v * 3 + 1] = elevation(scratch) + lift;
        pos[v * 3 + 2] = dz;
        aR[v] = f;
        v++;
      }
    }
    for (let s = 0; s < segs; s++) {
      const i0 = base + s * 2;
      idx.push(i0, i0 + 1, i0 + 2, i0 + 2, i0 + 1, i0 + 3);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(pos, 3));
  g.setAttribute("aR", new BufferAttribute(aR, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
};

// ---------------------------------------------------------------------------
// Shaders
// ---------------------------------------------------------------------------
const RING_VERTEX = `
attribute float aR;
varying float vR;
void main() {
  vR = aR;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const RING_FRAGMENT = `
uniform vec3 uColor;
uniform float uPhase;
uniform float uBeatPhase;
uniform float uBeat;
uniform float uIntensity;
uniform float uLock;
uniform float uBurst;
uniform float uQuiet;
varying float vR;

float band(float d, float tight) {
  return exp(-d * d * tight);
}

void main() {
  float tight = mix(26.0, 110.0, uLock);
  float fade = 1.0 - vR * 0.55;
  float sweep = band(vR - uPhase, tight) + uBeat * band(vR - uBeatPhase, tight);
  // Once the address is verified the sweep quietens and the precise lock ring carries the mark.
  float travelling = sweep * fade * uIntensity * (1.0 - 0.70 * uLock);
  float lockRing = uLock * band((vR - 0.40) * 3.2, 14.0) * 0.85;
  float shock = mix(band((vR - (1.0 - uBurst)) * 3.0, 9.0), 1.0 - vR * 0.4, uQuiet);
  float a = travelling + lockRing + uBurst * shock * 1.3;
  if (a <= 0.004) discard;
  gl_FragColor = vec4(uColor * (0.9 + uBurst * 1.8), a);
}
`;

const BEAM_VERTEX = `
varying float vY;
void main() {
  vY = position.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const BEAM_FRAGMENT = `
uniform vec3 uColor;
uniform float uIntensity;
varying float vY;
void main() {
  float fall = pow(max(0.0, 1.0 - vY), 1.8);
  float a = fall * uIntensity;
  if (a <= 0.003) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

// ---------------------------------------------------------------------------
// Cadence per category — how the rings breathe.
// ---------------------------------------------------------------------------
const CADENCE: Record<Category, { period: number; beat: number; offset: number }> = {
  medical: { period: 1.5, beat: 1, offset: 0.17 }, // double beat, like a pulse
  fire: { period: 0.85, beat: 0, offset: 0 }, // fast and insistent
  police: { period: 1.95, beat: 0, offset: 0 }, // slow sweep
  traffic: { period: 1.25, beat: 1, offset: 0.5 }, // two alternating fronts
  other: { period: 1.7, beat: 0, offset: 0 },
  unknown: { period: 2.3, beat: 0, offset: 0 },
};

const BURST_SECONDS = 0.7;

export default function IncidentBeacon({
  call,
  at,
  hero,
  quiet,
}: {
  call: CallState;
  at: Vec2;
  hero: boolean;
  quiet: boolean;
}) {
  const escalation = useAura((s) => s.escalation);

  const loc = call.incident?.location ?? null;
  const verified = loc?.verified === true;
  const confidence = loc?.confidence ?? 0;
  const category = call.incident?.category ?? "unknown";
  const scene = scenePhase(call);
  const mode = agentMode(call);

  const groundY = useMemo(() => {
    // Local tuple, not the module scratch: a memo body must stay free of outside mutation.
    const p: Vec2 = [at[0], at[1]];
    return elevation(p);
  }, [at]);

  const maxRadius = hero ? 2.4 : 1.05;
  const ringsGeo = useMemo(
    () => buildRings(at, maxRadius, hero ? 14 : 8, hero ? 48 : 28, 0.06),
    [at, maxRadius, hero],
  );
  useEffect(() => () => ringsGeo.dispose(), [ringsGeo]);

  const ringMat = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: RING_VERTEX,
        fragmentShader: RING_FRAGMENT,
        uniforms: {
          uColor: { value: new Color(priorityHex(call.priority)) },
          uPhase: { value: 0 },
          uBeatPhase: { value: 0 },
          uBeat: { value: 0 },
          uIntensity: { value: 0 },
          uLock: { value: 0 },
          uBurst: { value: 0 },
          uQuiet: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        blending: AdditiveBlending,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const beamMat = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: BEAM_VERTEX,
        fragmentShader: BEAM_FRAGMENT,
        uniforms: { uColor: { value: new Color(priorityHex(call.priority)) }, uIntensity: { value: 0 } },
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        blending: AdditiveBlending,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const haloMat = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: BEAM_VERTEX,
        fragmentShader: BEAM_FRAGMENT,
        uniforms: { uColor: { value: new Color(priorityHex(call.priority)) }, uIntensity: { value: 0 } },
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        blending: AdditiveBlending,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const markMat = useMemo(
    () =>
      new LineBasicMaterial({
        color: new Color(priorityHex(call.priority)),
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        opacity: 0,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const lockMat = useMemo(
    () =>
      new LineBasicMaterial({
        color: new Color(priorityHex(call.priority)),
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        opacity: 0,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const searchMat = useMemo(
    () =>
      new LineBasicMaterial({
        color: new Color(palette.ink2),
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        opacity: 0,
      }),
    [],
  );

  useEffect(
    () => () => {
      ringMat.dispose();
      beamMat.dispose();
      haloMat.dispose();
      markMat.dispose();
      lockMat.dispose();
      searchMat.dispose();
    },
    [ringMat, beamMat, haloMat, markMat, lockMat, searchMat],
  );

  // Priority colour: state, never decoration. pending/assessing stays neutral ink-2.
  useEffect(() => {
    const hex = priorityHex(call.priority);
    ringMat.uniforms.uColor.value.set(hex);
    beamMat.uniforms.uColor.value.set(hex);
    haloMat.uniforms.uColor.value.set(hex);
    markMat.color.set(hex);
    lockMat.color.set(hex);
  }, [call.priority, ringMat, beamMat, haloMat, markMat, lockMat]);

  // While AURA is still working the address out, the uncertainty circle carries what it is doing.
  useEffect(() => {
    searchMat.color.set(mode === "reasoning" ? palette.reason : mode === "idle" ? palette.ink3 : palette.listen);
  }, [mode, searchMat]);

  const anim = useRef({ phase: 0, level: 0, lock: 0, burst: 0, intensity: 0, wander: 0 });
  const firedAt = useRef(0);

  // The critical escalation: exactly one shockwave, keyed on the store's escalation timestamp.
  useEffect(() => {
    if (!escalation || escalation.sessionId !== call.sessionId) return;
    if (escalation.at === firedAt.current) return;
    firedAt.current = escalation.at;
    anim.current.burst = 1;
  }, [escalation, call.sessionId]);

  const coreRef = useRef<Mesh>(null);
  const haloRef = useRef<Mesh>(null);
  const markRef = useRef<LineSegments>(null);
  const searchRef = useRef<LineSegments>(null);
  const lockRef = useRef<Group>(null);

  // The GPU materials are written every frame from useFrame, which is a render-loop subscription and
  // not part of render. Holding them in a ref is how that mutation is expressed to the React
  // compiler; the objects are the same lifetime-stable instances the JSX below binds.
  const live = useRef({ ringMat, beamMat, haloMat, markMat, lockMat, searchMat });

  const cadence = CADENCE[category];
  const emphasis = scene === "dispatched" ? 0.7 : scene === "rejected" ? 0.5 : 1;
  const markScale = hero ? 0.5 : 0.26;
  const lockScale = hero ? 0.62 : 0.34;

  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 20);
    const a = anim.current;
    const gfx = live.current;

    a.lock += ((verified ? 1 : 0) - a.lock) * damp(2.6, dt);
    const heard = hero ? audioBus.readAny(call.sessionId) : 0;
    a.level += (heard - a.level) * damp(hero ? 9 : 4, dt);

    if (quiet) {
      a.phase = 0.55;
      a.burst = Math.max(0, a.burst - dt / 0.2);
    } else {
      a.phase += dt / cadence.period;
      if (a.phase > 1) a.phase -= 1;
      a.wander += dt * 0.7;
      a.burst = Math.max(0, a.burst - dt / BURST_SECONDS);
    }

    const base = hero ? 0.58 + 0.52 * a.level : 0.3;
    a.intensity += (base * emphasis - a.intensity) * damp(6, dt);
    const lit = a.intensity + a.burst * 0.9;

    const ru = gfx.ringMat.uniforms;
    ru.uPhase.value = a.phase;
    ru.uBeatPhase.value = quiet ? 0.55 : (a.phase + cadence.offset) % 1;
    ru.uBeat.value = quiet ? 0 : cadence.beat;
    ru.uIntensity.value = lit;
    ru.uLock.value = a.lock;
    ru.uBurst.value = a.burst;
    ru.uQuiet.value = quiet ? 1 : 0;

    const h = (hero ? 5.2 : 1.8) * (0.86 + 0.14 * a.level);
    const w = (hero ? 0.055 : 0.03) * (0.82 + 0.48 * a.level);
    const core = coreRef.current;
    const halo = haloRef.current;
    if (core) core.scale.set(w, h, w);
    if (halo) halo.scale.set(w * 4.2, h * 0.94, w * 4.2);
    gfx.beamMat.uniforms.uIntensity.value = 0.95 * lit;
    gfx.haloMat.uniforms.uIntensity.value = 0.24 * lit;

    // Searching: the mark drifts inside the confidence circle. Locked: it settles onto the pin.
    const drift = (1 - a.lock) * 0.3;
    const mx = at[0] + Math.cos(a.wander * 1.3) * drift;
    const mz = at[1] + Math.sin(a.wander) * drift;
    const mark = markRef.current;
    if (mark) {
      scratch[0] = mx;
      scratch[1] = mz;
      mark.position.set(mx, elevation(scratch) + 0.11, mz);
    }
    gfx.markMat.opacity = (0.45 + 0.55 * a.lock) * Math.min(1, lit * 1.2);
    gfx.lockMat.opacity = a.lock * Math.min(1, lit * 1.4);

    const search = searchRef.current;
    if (search) {
      const r = 0.42 + (1 - Math.min(1, confidence)) * (hero ? 1.9 : 0.8);
      const shown = r * (1 - a.lock) + 0.55 * a.lock;
      search.scale.set(shown, 1, shown);
      if (!quiet) search.rotation.y += dt * 0.35;
    }
    gfx.searchMat.opacity = (1 - a.lock) * 0.5 * Math.min(1, lit * 1.4);

    const lock = lockRef.current;
    if (lock) {
      const settle = lockScale * (1.55 - 0.55 * a.lock); // wide and loose, snapping in on verification
      lock.scale.set(settle, 1, settle);
    }
  });

  return (
    <group>
      <mesh
        geometry={ringsGeo}
        material={ringMat}
        position={[at[0], 0, at[1]]}
        renderOrder={2}
        dispose={null}
      />

      <group position={[at[0], groundY, at[1]]}>
        <mesh ref={haloRef} geometry={beam()} material={haloMat} renderOrder={5} dispose={null} />
        <mesh ref={coreRef} geometry={beam()} material={beamMat} renderOrder={6} dispose={null} />

        <lineSegments ref={searchRef} geometry={searchRing()} material={searchMat} position={[0, 0.09, 0]} renderOrder={5} dispose={null} />

        <group ref={lockRef} position={[0, 0.1, 0]}>
          <lineSegments geometry={crosshair()} material={lockMat} renderOrder={5} dispose={null} />
        </group>
      </group>

      <lineSegments
        ref={markRef}
        geometry={markGeometry(category)}
        material={markMat}
        position={[at[0], groundY + 0.11, at[1]]}
        scale={[markScale, 1, markScale]}
        renderOrder={6}
        dispose={null}
      />
    </group>
  );
}
