"use client";

// The route from the responding unit to the incident, drawn along the SF street grid.
//
// A route is a PROPOSAL until a human approves it, and it must look like one:
//   proposed  → violet (reason), dashed, draws itself across the streets over ~1.2s
//   approved  → one green signal runs the full length, then the line settles to approved green
//   rejected  → the line retracts toward the unit and dissolves; no dead line is left on the map
//
// Everything is driven by shader uniforms mutated in useFrame on delta time — no allocation per
// frame, and nothing animates per-frame-constant (the demo panel is 360 Hz).

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, DoubleSide, Mesh, ShaderMaterial } from "three";
import { elevation, type Vec2 } from "@/lib/geo";
import { damp } from "@/lib/motion";
import { palette } from "@/lib/palette";

export type RouteStatus = "proposed" | "approved" | "rejected";

const dist = (a: Vec2, b: Vec2): number => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** Replace the hard grid corners with short arcs so the line reads as a driven route, not an L. */
const roundCorners = (pts: Vec2[], radius: number): Vec2[] => {
  if (pts.length < 3) return pts.slice();
  const out: Vec2[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const p = pts[i];
    const a = pts[i - 1];
    const b = pts[i + 1];
    const la = dist(a, p);
    const lb = dist(p, b);
    const r = Math.min(radius, la * 0.45, lb * 0.45);
    if (r < 0.03 || la < 1e-4 || lb < 1e-4) {
      out.push(p);
      continue;
    }
    const sx = p[0] + ((a[0] - p[0]) / la) * r;
    const sz = p[1] + ((a[1] - p[1]) / la) * r;
    const ex = p[0] + ((b[0] - p[0]) / lb) * r;
    const ez = p[1] + ((b[1] - p[1]) / lb) * r;
    for (let k = 0; k <= 6; k++) {
      const t = k / 6;
      const m = 1 - t;
      out.push([m * m * sx + 2 * m * t * p[0] + t * t * ex, m * m * sz + 2 * m * t * p[1] + t * t * ez]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
};

/** Even spacing, so the shader's arc-length parameter is honest and the reveal reads as constant speed. */
const resample = (pts: Vec2[], spacing: number): Vec2[] => {
  const out: Vec2[] = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const len = dist(a, b);
    if (len < 1e-6) continue;
    const dx = (b[0] - a[0]) / len;
    const dz = (b[1] - a[1]) / len;
    let d = spacing - carry;
    while (d <= len) {
      out.push([a[0] + dx * d, a[1] + dz * d]);
      d += spacing;
    }
    carry = len - (d - spacing);
  }
  const tail = out[out.length - 1];
  const last = pts[pts.length - 1];
  if (dist(tail, last) > 1e-4) out.push(last);
  return out;
};

export type Ribbon = { geometry: BufferGeometry; length: number };

/**
 * Flat ribbon that hugs the terrain along a polyline. `aT` is normalised arc length (0..1),
 * `aSide` is -1/+1 across the width — both are all the shaders need.
 * Shared with ResponderUnits, which uses a narrower ribbon for the unit's trail.
 */
export const buildRibbon = (points: Vec2[], width: number, lift: number): Ribbon | null => {
  if (points.length < 2) return null;
  const path = resample(roundCorners(points, 0.85), 0.22);
  const n = path.length;
  if (n < 2) return null;

  const cum = new Float32Array(n);
  let total = 0;
  for (let i = 1; i < n; i++) {
    total += dist(path[i - 1], path[i]);
    cum[i] = total;
  }
  if (total <= 1e-4) return null;

  const pos = new Float32Array(n * 2 * 3);
  const ts = new Float32Array(n * 2);
  const sides = new Float32Array(n * 2);
  const idx: number[] = [];
  const probe: Vec2 = [0, 0];
  const half = width / 2;

  for (let i = 0; i < n; i++) {
    const prev = path[Math.max(0, i - 1)];
    const next = path[Math.min(n - 1, i + 1)];
    let tx = next[0] - prev[0];
    let tz = next[1] - prev[1];
    const tl = Math.hypot(tx, tz) || 1;
    tx /= tl;
    tz /= tl;
    const t = cum[i] / total;
    for (let s = 0; s < 2; s++) {
      const sign = s === 0 ? 1 : -1;
      const x = path[i][0] + tz * half * sign;
      const z = path[i][1] - tx * half * sign;
      probe[0] = x;
      probe[1] = z;
      const v = i * 2 + s;
      pos[v * 3] = x;
      pos[v * 3 + 1] = elevation(probe) + lift;
      pos[v * 3 + 2] = z;
      ts[v] = t;
      sides[v] = sign;
    }
  }
  for (let i = 0; i < n - 1; i++) {
    const a0 = i * 2;
    idx.push(a0, a0 + 1, a0 + 2, a0 + 2, a0 + 1, a0 + 3);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(pos, 3));
  geometry.setAttribute("aT", new BufferAttribute(ts, 1));
  geometry.setAttribute("aSide", new BufferAttribute(sides, 1));
  geometry.setIndex(idx);
  geometry.computeBoundingSphere();
  return { geometry, length: total };
};

export const RIBBON_VERTEX = `
attribute float aT;
attribute float aSide;
varying float vT;
varying float vSide;
void main() {
  vT = aT;
  vSide = aSide;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const ROUTE_FRAGMENT = `
uniform vec3 uBase;
uniform vec3 uSignalColor;
uniform float uProgress;
uniform float uSignal;
uniform float uAlpha;
uniform float uDash;
uniform float uDashMix;
varying float vT;
varying float vSide;
void main() {
  if (vT > uProgress) discard;
  float core = 1.0 - abs(vSide);
  float body = 0.20 + 0.80 * pow(core, 1.4);
  float dash = mix(1.0, 0.28 + 0.72 * step(0.42, fract(vT * 34.0 - uDash)), uDashMix);
  float hd = (uProgress - vT) * 30.0;
  float head = exp(-hd * hd) * (1.0 - step(0.998, uProgress));
  float sd = (vT - uSignal) * 16.0;
  float sig = uSignal < 0.0 ? 0.0 : exp(-sd * sd);
  vec3 col = mix(uBase, uSignalColor, min(1.0, sig * 1.8));
  float a = (body * dash * 0.48 + head * 0.85 + sig * 0.95) * uAlpha;
  if (a <= 0.003) discard;
  gl_FragColor = vec4(col * (0.85 + sig * 1.3 + head * 1.1), a);
}
`;

const REVEAL_LAMBDA = 4.2; // ≈1.2s to settle, exponential ease-out, delta-time correct
const SIGNAL_SECONDS = 1.0;

export default function ResponderRoute({
  points,
  status,
  quiet,
}: {
  points: Vec2[];
  status: RouteStatus;
  quiet: boolean;
}) {
  const ribbon = useMemo(() => buildRibbon(points, 0.17, 0.05), [points]);

  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: RIBBON_VERTEX,
        fragmentShader: ROUTE_FRAGMENT,
        uniforms: {
          uBase: { value: new Color(palette.reason) },
          uSignalColor: { value: new Color(palette.approved) },
          uProgress: { value: 0 },
          uSignal: { value: -1 },
          uAlpha: { value: 0 },
          uDash: { value: 0 },
          uDashMix: { value: 1 },
        },
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        blending: AdditiveBlending,
      }),
    [],
  );

  const proposedColor = useMemo(() => new Color(palette.reason), []);
  const approvedColor = useMemo(() => new Color(palette.approved), []);

  useEffect(() => () => ribbon?.geometry.dispose(), [ribbon]);
  useEffect(() => () => material.dispose(), [material]);

  const meshRef = useRef<Mesh>(null);
  const anim = useRef({ progress: 0, alpha: 0, signal: -1, dash: 0, settle: 0, seen: "" });
  // useFrame is a render-loop subscription, not render: the ref is how its per-frame writes to the
  // (lifetime-stable) shader material are expressed to the React compiler.
  const live = useRef(material);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 20);
    const s = anim.current;
    const u = live.current.uniforms;

    if (s.seen !== status) {
      if (status === "approved") s.signal = quiet ? -1 : 0;
      s.seen = status;
    }

    const rejected = status === "rejected";
    const targetProgress = rejected ? 0 : 1;
    const targetAlpha = rejected ? 0 : 1;

    if (quiet) {
      // reduced motion / low quality: the route appears, it does not travel.
      s.progress = targetProgress;
      s.alpha = targetAlpha;
      s.signal = -1;
      s.settle = status === "approved" ? 1 : 0;
      s.dash = 0;
    } else {
      s.progress += (targetProgress - s.progress) * damp(rejected ? 7 : REVEAL_LAMBDA, dt);
      if (!rejected && s.progress > 0.998) s.progress = 1;
      if (rejected && s.progress < 0.004) s.progress = 0;
      s.alpha += (targetAlpha - s.alpha) * damp(rejected ? 6 : 5, dt);
      s.dash += dt * 1.4;
      if (s.dash > 1e4) s.dash = 0;
      if (s.signal >= 0) {
        s.signal += dt / SIGNAL_SECONDS;
        if (s.signal > 1.2) s.signal = -1;
      }
      const settleTarget = status === "approved" && s.signal < 0 ? 1 : 0;
      s.settle += (settleTarget - s.settle) * damp(3.2, dt);
    }

    u.uProgress.value = s.progress;
    u.uAlpha.value = s.alpha;
    u.uSignal.value = s.signal;
    u.uDash.value = s.dash;
    // A proposal is dashed; an approved response is solid.
    u.uDashMix.value = status === "proposed" && !quiet ? 1 : 0;
    u.uBase.value.copy(proposedColor).lerp(approvedColor, s.settle);

    const mesh = meshRef.current;
    if (mesh) mesh.visible = s.alpha > 0.004 && s.progress > 0.002;
  });

  if (!ribbon) return null;

  return <mesh ref={meshRef} geometry={ribbon.geometry} material={material} renderOrder={3} dispose={null} />;
}
