"use client";

// The responding units on the map.
//
// THE HARD RULE: a unit only MOVES after call.approval.status === "approved".
// Before that they are lit — they are candidates, AURA has prepared a response — but they sit still.
// Animating a vehicle before a human has approved the dispatch would be a lie about what the system did.

import { useEffect, useMemo, useRef } from "react";
import { Html } from "@react-three/drei";
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
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  ShaderMaterial,
} from "three";
import type { ResponderUnit } from "@/lib/contracts";
import { elevation, pointAlong, project, type Vec2 } from "@/lib/geo";
import { damp } from "@/lib/motion";
import { palette, priorityHex } from "@/lib/palette";
import type { CallState } from "@/state/auraStore";
import { etaLabel } from "@/state/selectors";
import { buildRibbon, RIBBON_VERTEX } from "./ResponderRoute";

const scratch: Vec2 = [0, 0];

/** Seconds for the selected unit to run the whole route. Legible, not real-time. */
const TRAVEL_SECONDS = 14;
/** Reduced motion: the unit jumps station to station instead of flying. */
const STEPS = 10;
const STEP_SECONDS = 1.3;

// ---------------------------------------------------------------------------
// Shared geometry — an elongated chevron/lozenge with a light bar. Abstract, small, legible.
// ---------------------------------------------------------------------------
const HULL: number[][] = [
  [0, 0.5],
  [0.17, 0.1],
  [0.12, -0.34],
  [-0.12, -0.34],
  [-0.17, 0.1],
];

let hullGeo: BufferGeometry | null = null;
const hull = (): BufferGeometry => {
  if (!hullGeo) {
    const tris = [
      [0, 1, 2],
      [0, 2, 3],
      [0, 3, 4],
    ];
    const pos = new Float32Array(tris.length * 9);
    tris.forEach((t, i) => {
      t.forEach((v, k) => {
        pos[i * 9 + k * 3] = HULL[v][0];
        pos[i * 9 + k * 3 + 1] = 0;
        pos[i * 9 + k * 3 + 2] = HULL[v][1];
      });
    });
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(pos, 3));
    g.computeBoundingSphere();
    hullGeo = g;
  }
  return hullGeo;
};

let outlineGeo: BufferGeometry | null = null;
const outline = (): BufferGeometry => {
  if (!outlineGeo) {
    const pos = new Float32Array(HULL.length * 3);
    HULL.forEach((p, i) => {
      pos[i * 3] = p[0];
      pos[i * 3 + 1] = 0;
      pos[i * 3 + 2] = p[1];
    });
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(pos, 3));
    g.computeBoundingSphere();
    outlineGeo = g;
  }
  return outlineGeo;
};

let barGeo: BufferGeometry | null = null;
const lightBar = (): BufferGeometry => {
  if (!barGeo) {
    const g = new PlaneGeometry(0.26, 0.085);
    g.rotateX(-Math.PI / 2);
    g.translate(0, 0.012, 0.04);
    barGeo = g;
  }
  return barGeo;
};

let columnGeo: BufferGeometry | null = null;
const column = (): BufferGeometry => {
  if (!columnGeo) {
    const g = new CylinderGeometry(0.008, 0.026, 1, 6, 1, true);
    g.translate(0, 0.5, 0);
    columnGeo = g;
  }
  return columnGeo;
};

const TRAIL_FRAGMENT = `
uniform vec3 uColor;
uniform float uHead;
uniform float uAlpha;
varying float vT;
varying float vSide;
void main() {
  float behind = uHead - vT;
  if (behind < 0.0 || behind > 0.10) discard;
  float a = 1.0 - behind / 0.10;
  a = a * a * (1.0 - abs(vSide) * 0.75) * uAlpha;
  if (a <= 0.004) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

export default function ResponderUnits({
  call,
  units,
  routePoints,
  hero,
  quiet,
}: {
  call: CallState;
  units: ResponderUnit[];
  routePoints: Vec2[] | null;
  hero: boolean;
  quiet: boolean;
}) {
  // The single correctness rule of this whole product.
  const approved = call.approval.status === "approved";
  const stateHex = priorityHex(call.priority);

  return (
    <group>
      {units.map((unit) => (
        <UnitMarker
          key={unit.id}
          unit={unit}
          stateHex={stateHex}
          routePoints={unit.selected && routePoints ? routePoints : null}
          moving={approved && unit.selected}
          hero={hero}
          quiet={quiet}
        />
      ))}
      {routePoints && approved ? <Trail points={routePoints} quiet={quiet} /> : null}
    </group>
  );
}

// ---------------------------------------------------------------------------

function UnitMarker({
  unit,
  stateHex,
  routePoints,
  moving,
  hero,
  quiet,
}: {
  unit: ResponderUnit;
  stateHex: string;
  routePoints: Vec2[] | null;
  moving: boolean;
  hero: boolean;
  quiet: boolean;
}) {
  const idle = useMemo(() => {
    const p = project(unit.latitude, unit.longitude);
    // Local tuple, not the module scratch: a memo body must stay free of outside mutation.
    const q: Vec2 = [p[0], p[1]];
    return { p, y: elevation(q) + 0.05 };
  }, [unit.latitude, unit.longitude]);

  const idleHeading = useMemo(() => {
    if (!routePoints || routePoints.length < 2) return 0;
    const a = routePoints[0];
    const b = routePoints[1];
    return Math.atan2(b[0] - a[0], b[1] - a[1]);
  }, [routePoints]);

  const scale = hero ? 1 : 0.62;
  const selected = unit.selected;

  const bodyMat = useMemo(
    () =>
      new MeshBasicMaterial({
        color: new Color(selected ? stateHex : palette.ink2),
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        opacity: 0,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const edgeMat = useMemo(
    () =>
      new LineBasicMaterial({
        color: new Color(selected ? stateHex : palette.ink2),
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
        opacity: 0,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const barMat = useMemo(
    () =>
      new MeshBasicMaterial({
        color: new Color(stateHex),
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        blending: AdditiveBlending,
        opacity: 0,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const columnMat = useMemo(
    () =>
      new MeshBasicMaterial({
        color: new Color(palette.approved),
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        blending: AdditiveBlending,
        opacity: 0,
      }),
    [],
  );

  useEffect(
    () => () => {
      bodyMat.dispose();
      edgeMat.dispose();
      barMat.dispose();
      columnMat.dispose();
    },
    [bodyMat, edgeMat, barMat, columnMat],
  );

  // Green only once a human said yes. Until then the unit carries the incident's own state colour.
  const restColor = useMemo(() => new Color(selected ? stateHex : palette.ink2), [selected, stateHex]);
  const goColor = useMemo(() => new Color(palette.approved), []);

  const groupRef = useRef<Group>(null);
  const spinRef = useRef<Group>(null);
  const columnRef = useRef<Mesh>(null);
  const anim = useRef({ t: 0, lit: 0, go: 0, clock: 0, blink: 0, stepClock: 0 });
  // useFrame is a render-loop subscription, not render: the ref is how its per-frame writes to these
  // (lifetime-stable) materials are expressed to the React compiler.
  const live = useRef({ bodyMat, edgeMat, barMat, columnMat });

  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 20);
    const a = anim.current;
    const g = groupRef.current;
    const spin = spinRef.current;
    const gfx = live.current;

    a.lit += (1 - a.lit) * damp(4, dt);
    a.go += ((moving ? 1 : 0) - a.go) * damp(3.5, dt);

    if (moving && routePoints && routePoints.length >= 2) {
      if (quiet) {
        a.stepClock += dt;
        a.t = Math.min(1, Math.floor(a.stepClock / STEP_SECONDS) / STEPS);
      } else {
        a.t = Math.min(1, a.t + dt / TRAVEL_SECONDS);
        a.blink += dt;
      }
      const at = pointAlong(routePoints, a.t);
      scratch[0] = at.pos[0];
      scratch[1] = at.pos[1];
      if (g) g.position.set(at.pos[0], elevation(scratch) + 0.05, at.pos[1]);
      if (spin) spin.rotation.y = at.heading;
    } else {
      a.t = 0;
      a.stepClock = 0;
      if (g) g.position.set(idle.p[0], idle.y, idle.p[1]);
      if (spin) spin.rotation.y = idleHeading;
    }

    gfx.bodyMat.opacity = a.lit * (selected ? 0.34 : 0.1);
    gfx.edgeMat.opacity = a.lit * (selected ? 0.95 : 0.38);
    gfx.bodyMat.color.copy(restColor).lerp(goColor, a.go);
    gfx.edgeMat.color.copy(restColor).lerp(goColor, a.go);

    // The light bar only runs once the unit is actually en route.
    const pulse = quiet ? 1 : Math.sin(a.blink * Math.PI * 2 * 1.6) > 0 ? 1 : 0.22;
    gfx.barMat.opacity = selected ? a.lit * (0.18 + 0.82 * a.go * pulse) : 0;
    gfx.barMat.color.copy(restColor).lerp(goColor, a.go);

    const col = columnRef.current;
    if (col) {
      col.scale.set(1, 0.34 * a.go, 1);
      col.visible = a.go > 0.02;
    }
    gfx.columnMat.opacity = a.go * 0.55;
  });

  const eta = etaLabel(unit.eta_seconds);

  return (
    <group ref={groupRef}>
      <group ref={spinRef} scale={[scale, 1, scale]}>
        <mesh geometry={hull()} material={bodyMat} renderOrder={6} dispose={null} />
        <lineLoop geometry={outline()} material={edgeMat} renderOrder={7} dispose={null} />
        {selected ? <mesh geometry={lightBar()} material={barMat} renderOrder={7} dispose={null} /> : null}
        {selected ? <mesh ref={columnRef} geometry={column()} material={columnMat} renderOrder={7} dispose={null} /> : null}
      </group>

      {hero && selected ? (
        <Html position={[0, 0.26, 0]} style={{ pointerEvents: "none" }} zIndexRange={[24, 8]}>
          <div className="translate-x-[10px] -translate-y-1/2 select-none whitespace-nowrap">
            <div
              className="data-mono text-[10px] leading-[13px] tracking-[0.14em] uppercase"
              style={{ color: palette.ink }}
            >
              {unit.callsign}
            </div>
            <div className="data-mono text-[10px] leading-[13px]" style={{ color: palette.ink3 }}>
              {eta ?? "ETA —"}
              {moving ? (
                <span className="pl-1.5" style={{ color: palette.approved }}>
                  EN ROUTE
                </span>
              ) : null}
            </div>
          </div>
        </Html>
      ) : null}
    </group>
  );
}

// ---------------------------------------------------------------------------

function Trail({ points, quiet }: { points: Vec2[]; quiet: boolean }) {
  const ribbon = useMemo(() => buildRibbon(points, 0.075, 0.075), [points]);
  const material = useMemo(
    () =>
      new ShaderMaterial({
        vertexShader: RIBBON_VERTEX,
        fragmentShader: TRAIL_FRAGMENT,
        uniforms: {
          uColor: { value: new Color(palette.approved) },
          uHead: { value: -1 },
          uAlpha: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        blending: AdditiveBlending,
      }),
    [],
  );

  useEffect(() => () => ribbon?.geometry.dispose(), [ribbon]);
  useEffect(() => () => material.dispose(), [material]);

  const anim = useRef({ t: 0, stepClock: 0, alpha: 0 });
  const live = useRef(material);

  useFrame((_, delta) => {
    const dt = Math.min(delta, 1 / 20);
    const a = anim.current;
    if (quiet) {
      a.stepClock += dt;
      a.t = Math.min(1, Math.floor(a.stepClock / STEP_SECONDS) / STEPS);
    } else {
      a.t = Math.min(1, a.t + dt / TRAVEL_SECONDS);
    }
    a.alpha += ((a.t >= 1 ? 0 : 1) - a.alpha) * damp(3, dt);
    live.current.uniforms.uHead.value = a.t;
    live.current.uniforms.uAlpha.value = quiet ? 0 : a.alpha * 0.9;
  });

  if (!ribbon) return null;

  return <mesh geometry={ribbon.geometry} material={material} renderOrder={4} dispose={null} />;
}
