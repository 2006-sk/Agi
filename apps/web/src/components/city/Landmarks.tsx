"use client";

// The things a San Franciscan checks for, built as shapes rather than boxes: the Transamerica
// Pyramid with its two shoulder wings and spire, Salesforce Tower tapering to a crown, Coit, the
// Ferry Building, City Hall — and Sutro Tower, a three-legged lattice spire that stands directly
// above the demo incident and is the single most recognisable silhouette in the city.
//
// The two bridges leave the landmass as thin lit decks under a suspension curve. Two spans running
// off the peninsula place the city faster than any label could.
//
// These are architecture, not UI. No labels, no glow beyond the city's own edge treatment, and
// never a semantic state colour — Sutro's aviation banding is deliberately desaturated so it can
// not be mistaken for `critical`.
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { BRIDGES, LANDMARKS, type Landmark, type Vec2 } from "@/lib/geo";
import { palette } from "@/lib/palette";
import { createSolidMaterial } from "./Buildings";
import { surfaceY } from "./Terrain";

const TAU = Math.PI * 2;

const EDGE = new THREE.Color(palette.edge).multiplyScalar(1.75);
/** Aviation banding, deliberately desaturated: a semantic red means "critical", never "landmark". */
const BAND_WARM = new THREE.Color("#6f6a63");
const BAND_COOL = new THREE.Color("#9fb0c6");
const DECK = new THREE.Color("#93a9c9");
const CABLE = new THREE.Color("#5f7da1");

type Volume = { key: string; at: [number, number, number]; rotY: number; pieces: THREE.BufferGeometry[] };

const find = (short: string): Landmark | undefined => LANDMARKS.find((l) => l.short === short);

const box = (w: number, h: number, d: number, y: number): THREE.BufferGeometry => {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, y + h / 2, 0);
  return g;
};

const column = (rTop: number, rBottom: number, h: number, sides: number, y: number): THREE.BufferGeometry => {
  const g = new THREE.CylinderGeometry(rTop, rBottom, h, sides, 1);
  g.translate(0, y + h / 2, 0);
  return g;
};

const buildVolumes = (): Volume[] => {
  const out: Volume[] = [];

  // Salesforce Tower: one continuous taper into a crown. The silhouette is a needle, not a slab.
  const salesforce = find("SALESFORCE");
  if (salesforce) {
    const h = salesforce.height;
    out.push({
      key: "salesforce",
      at: [salesforce.at[0], surfaceY(salesforce.at), salesforce.at[1]],
      rotY: 0.36,
      pieces: [column(0.16, 0.3, h * 0.84, 12, 0), column(0.035, 0.16, h * 0.16, 12, h * 0.84)],
    });
  }

  // Transamerica Pyramid: a four-sided taper with the two shoulder wings that carry the lifts and
  // the stairs, and the spire above. Those wings are what make it unmistakable from the air.
  const pyramid = find("TRANSAMERICA");
  if (pyramid) {
    const h = pyramid.height;
    const shaft = new THREE.ConeGeometry(0.33, h * 0.86, 4, 1);
    shaft.translate(0, (h * 0.86) / 2, 0);
    // The shoulder wings sit on the middle of two opposite faces — a 4-gon cone's faces face the
    // diagonals — and protrude past the taper, which is the shape's real signature in silhouette.
    const wing = (side: number): THREE.BufferGeometry =>
      box(0.058, h * 0.46, 0.058, h * 0.16).translate(side * 0.104, 0, side * 0.104);
    out.push({
      key: "transamerica",
      at: [pyramid.at[0], surfaceY(pyramid.at), pyramid.at[1]],
      rotY: Math.PI / 4,
      pieces: [
        box(0.62, h * 0.09, 0.62, 0), // podium
        shaft,
        wing(1),
        wing(-1),
        column(0.012, 0.03, h * 0.16, 6, h * 0.86),
      ],
    });
  }

  const coit = find("COIT");
  if (coit) {
    out.push({
      key: "coit",
      at: [coit.at[0], surfaceY(coit.at), coit.at[1]],
      rotY: 0,
      pieces: [column(0.055, 0.08, coit.height * 0.88, 10, 0), column(0.07, 0.055, coit.height * 0.12, 10, coit.height * 0.88)],
    });
  }

  const ferry = find("FERRY BLDG");
  if (ferry) {
    out.push({
      key: "ferry",
      at: [ferry.at[0], surfaceY(ferry.at), ferry.at[1]],
      rotY: -0.32,
      pieces: [box(1.6, 0.16, 0.24, 0), box(0.15, ferry.height * 0.8, 0.15, 0), column(0.02, 0.05, ferry.height * 0.2, 6, ferry.height * 0.8)],
    });
  }

  const hall = find("CITY HALL");
  if (hall) {
    const dome = new THREE.SphereGeometry(0.2, 16, 8, 0, TAU, 0, Math.PI / 2);
    dome.translate(0, 0.3, 0);
    out.push({
      key: "cityhall",
      at: [hall.at[0], surfaceY(hall.at), hall.at[1]],
      rotY: 0,
      pieces: [box(1.05, 0.3, 0.64, 0), dome, column(0.03, 0.05, 0.16, 6, 0.5)],
    });
  }

  return out;
};

/**
 * Sutro Tower: three legs splaying from the ridge into a banded mast, cross-braced the whole way up
 * so it reads as a lattice rather than as three sticks, with the antenna arms near the top.
 */
const buildSutro = (height: number): THREE.BufferGeometry => {
  const pos: number[] = [];
  const col: number[] = [];

  const KNEE = 0.36;
  const radiusAt = (t: number): number =>
    t < KNEE ? 0.5 + (0.11 - 0.5) * (t / KNEE) : 0.11 + (0.028 - 0.11) * ((t - KNEE) / (1 - KNEE));
  const bandAt = (t: number): THREE.Color => (Math.floor(t * 7) % 2 === 0 ? BAND_COOL : BAND_WARM);
  const legs = [Math.PI / 2, (Math.PI * 7) / 6, (Math.PI * 11) / 6];

  const at = (angle: number, t: number): [number, number, number] => {
    const r = radiusAt(t);
    return [Math.cos(angle) * r, t * height, Math.sin(angle) * r];
  };
  const seg = (a: [number, number, number], b: [number, number, number], c: THREE.Color): void => {
    pos.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    col.push(c.r, c.g, c.b, c.r, c.g, c.b);
  };

  // legs and central mast
  const steps = 24;
  for (const angle of legs) {
    for (let s = 0; s < steps; s++) {
      const t0 = s / steps;
      const t1 = (s + 1) / steps;
      seg(at(angle, t0), at(angle, t1), bandAt((t0 + t1) / 2));
    }
  }
  for (let s = 0; s < steps; s++) {
    const t0 = KNEE + (1 - KNEE) * (s / steps);
    const t1 = KNEE + (1 - KNEE) * ((s + 1) / steps);
    seg([0, t0 * height, 0], [0, t1 * height, 0], bandAt((t0 + t1) / 2));
  }

  // horizontal rings plus the X-bracing between them — the lattice
  const rings = [0, 0.07, 0.15, 0.24, KNEE, 0.47, 0.59, 0.71, 0.83, 0.93];
  for (let i = 0; i < rings.length; i++) {
    const t = rings[i];
    const c = bandAt(t);
    for (let k = 0; k < 3; k++) seg(at(legs[k], t), at(legs[(k + 1) % 3], t), c);
    if (i === rings.length - 1) continue;
    const tn = rings[i + 1];
    const cb = bandAt((t + tn) / 2);
    for (let k = 0; k < 3; k++) {
      const a = legs[k];
      const b = legs[(k + 1) % 3];
      seg(at(a, t), at(b, tn), cb);
      seg(at(b, t), at(a, tn), cb);
    }
  }

  // the two sets of antenna arms
  for (const t of [0.68, 0.82]) {
    const y = t * height;
    const r = radiusAt(t);
    for (const angle of legs) {
      const a: [number, number, number] = [Math.cos(angle) * r, y, Math.sin(angle) * r];
      const b: [number, number, number] = [Math.cos(angle) * (r + 0.24), y, Math.sin(angle) * (r + 0.24)];
      seg(a, b, BAND_COOL);
      seg(b, [b[0], y + 0.14, b[2]], BAND_COOL);
      seg(b, [b[0], y - 0.1, b[2]], BAND_COOL);
    }
  }
  seg([0, height, 0], [0, height + 0.34, 0], BAND_COOL);

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return g;
};

const buildBridges = (): THREE.BufferGeometry => {
  const pos: number[] = [];
  const col: number[] = [];
  const seg = (a: [number, number, number], b: [number, number, number], c: THREE.Color): void => {
    pos.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    col.push(c.r, c.g, c.b, c.r, c.g, c.b);
  };

  const span = (points: Vec2[], deckY: number, towerH: number, tA: number, tB: number): void => {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], deckY, p[1])));
    const N = 72;
    const half = 0.17;

    const sample = (t: number): { p: THREE.Vector3; nx: number; nz: number } => {
      const p = curve.getPointAt(t);
      const tan = curve.getTangentAt(t);
      const len = Math.hypot(tan.x, tan.z) || 1;
      return { p, nx: -tan.z / len, nz: tan.x / len };
    };

    const cableY = (t: number): number => {
      if (t <= tA) return towerH * (t / tA);
      if (t >= tB) return towerH * ((1 - t) / (1 - tB));
      const u = (t - tA) / (tB - tA);
      return towerH - (towerH - 0.07) * Math.sin(Math.PI * u);
    };

    for (const side of [-half, half]) {
      let prevDeck: [number, number, number] | null = null;
      let prevCable: [number, number, number] | null = null;
      for (let i = 0; i <= N; i++) {
        const t = i / N;
        const { p, nx, nz } = sample(t);
        const x = p.x + nx * side;
        const z = p.z + nz * side;
        const deck: [number, number, number] = [x, deckY, z];
        const cable: [number, number, number] = [x, deckY + cableY(t), z];
        if (prevDeck) seg(prevDeck, deck, DECK);
        if (prevCable) seg(prevCable, cable, CABLE);
        // hangers, every eighth sample, so the span reads as a suspension bridge
        if (i % 8 === 0 && t > tA && t < tB) seg(deck, cable, CABLE);
        prevDeck = deck;
        prevCable = cable;
      }
    }

    for (const t of [tA, tB]) {
      const { p, nx, nz } = sample(t);
      for (const side of [-half, half]) {
        const x = p.x + nx * side;
        const z = p.z + nz * side;
        seg([x, deckY - 0.5, z], [x, deckY + towerH + 0.12, z], DECK);
      }
      // the tower's cross-beams, so it reads as a portal rather than two sticks
      const ax = p.x + nx * -half;
      const az = p.z + nz * -half;
      const bx = p.x + nx * half;
      const bz = p.z + nz * half;
      for (const f of [0.42, 0.72]) {
        seg([ax, deckY + towerH * f, az], [bx, deckY + towerH * f, bz], DECK);
      }
      seg([ax, deckY + towerH + 0.12, az], [bx, deckY + towerH + 0.12, bz], DECK);
    }
  };

  const gg = BRIDGES.find((b) => b.name === "Golden Gate");
  if (gg) span(gg.points, 0.67, 2.27, 0.16, 0.7);
  const bay = BRIDGES.find((b) => b.name === "Bay Bridge");
  if (bay) span(bay.points, 0.6, 1.4, 0.2, 0.56);

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return g;
};

export default function Landmarks() {
  const built = useMemo(() => {
    const volumes = buildVolumes();
    const outlines = volumes.map((v) => v.pieces.map((p) => new THREE.EdgesGeometry(p, 26)));
    const sutroMark = find("SUTRO");
    return {
      volumes,
      outlines,
      sutro: sutroMark ? buildSutro(sutroMark.height) : null,
      sutroAt: sutroMark ? ([sutroMark.at[0], surfaceY(sutroMark.at), sutroMark.at[1]] as const) : null,
      bridges: buildBridges(),
      // Same surface as the city fabric, so a landmark is a building rather than a decoration.
      bodyMaterial: createSolidMaterial(0, palette.navy700),
      edgeMaterial: new THREE.LineBasicMaterial({ color: EDGE, fog: true }),
      latticeMaterial: new THREE.LineBasicMaterial({ vertexColors: true, fog: true }),
      bridgeMaterial: new THREE.LineBasicMaterial({ vertexColors: true, fog: true }),
    };
  }, []);

  useEffect(
    () => () => {
      for (const v of built.volumes) for (const p of v.pieces) p.dispose();
      for (const set of built.outlines) for (const o of set) o.dispose();
      built.sutro?.dispose();
      built.bridges.dispose();
      built.bodyMaterial.dispose();
      built.edgeMaterial.dispose();
      built.latticeMaterial.dispose();
      built.bridgeMaterial.dispose();
    },
    [built],
  );

  return (
    <group>
      {built.volumes.map((v, i) => (
        <group key={v.key} position={v.at} rotation={[0, v.rotY, 0]}>
          {v.pieces.map((piece, j) => (
            <group key={j}>
              <mesh geometry={piece} material={built.bodyMaterial} />
              <lineSegments geometry={built.outlines[i][j]} material={built.edgeMaterial} />
            </group>
          ))}
        </group>
      ))}

      {built.sutro && built.sutroAt && (
        <lineSegments
          geometry={built.sutro}
          material={built.latticeMaterial}
          position={[built.sutroAt[0], built.sutroAt[1], built.sutroAt[2]]}
        />
      )}

      <lineSegments geometry={built.bridges} material={built.bridgeMaterial} frustumCulled={false} />
    </group>
  );
}
