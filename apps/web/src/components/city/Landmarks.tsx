"use client";

// The things a San Franciscan checks for: the Transbay/Financial spike, the Pyramid, Coit, the
// Ferry Building, City Hall — and Sutro Tower, which is a three-legged lattice spire, not a box,
// and which happens to stand directly above the demo incident.
// The two bridges leave the landmass as thin light lines with a suspension curve; that silhouette
// places the city faster than any label.
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { BRIDGES, LANDMARKS, type Landmark, type Vec2 } from "@/lib/geo";
import { palette } from "@/lib/palette";
import { surfaceY } from "./Terrain";

const TAU = Math.PI * 2;

const EDGE = new THREE.Color(palette.edge).multiplyScalar(1.55);
/** Aviation banding, deliberately desaturated: a semantic red means "critical", never "landmark". */
const BAND_WARM = new THREE.Color("#94534a");
const BAND_COOL = new THREE.Color("#aebdd2");
const DECK = new THREE.Color("#8aa0c0");
const CABLE = new THREE.Color("#5d7a9c");

type Volume = { key: string; at: [number, number, number]; rotY: number; pieces: THREE.BufferGeometry[] };

const find = (short: string): Landmark | undefined => LANDMARKS.find((l) => l.short === short);

const box = (w: number, h: number, d: number, y: number): THREE.BufferGeometry => {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(0, y + h / 2, 0);
  return g;
};

const buildVolumes = (): Volume[] => {
  const out: Volume[] = [];

  const salesforce = find("SALESFORCE");
  if (salesforce) {
    const g = new THREE.CylinderGeometry(0.15, 0.31, salesforce.height, 8, 1);
    g.translate(0, salesforce.height / 2, 0);
    out.push({
      key: "salesforce",
      at: [salesforce.at[0], surfaceY(salesforce.at), salesforce.at[1]],
      rotY: 0.4,
      pieces: [g],
    });
  }

  const pyramid = find("TRANSAMERICA");
  if (pyramid) {
    const g = new THREE.ConeGeometry(0.34, pyramid.height, 4, 1);
    g.translate(0, pyramid.height / 2, 0);
    out.push({
      key: "transamerica",
      at: [pyramid.at[0], surfaceY(pyramid.at), pyramid.at[1]],
      rotY: Math.PI / 4,
      pieces: [g],
    });
  }

  const coit = find("COIT");
  if (coit) {
    const g = new THREE.CylinderGeometry(0.055, 0.08, coit.height, 8, 1);
    g.translate(0, coit.height / 2, 0);
    out.push({ key: "coit", at: [coit.at[0], surfaceY(coit.at), coit.at[1]], rotY: 0, pieces: [g] });
  }

  const ferry = find("FERRY BLDG");
  if (ferry) {
    out.push({
      key: "ferry",
      at: [ferry.at[0], surfaceY(ferry.at), ferry.at[1]],
      rotY: -0.32,
      pieces: [box(1.6, 0.16, 0.24, 0), box(0.14, ferry.height, 0.14, 0)],
    });
  }

  const hall = find("CITY HALL");
  if (hall) {
    const dome = new THREE.SphereGeometry(0.2, 16, 8, 0, TAU, 0, Math.PI / 2);
    dome.translate(0, 0.3, 0);
    const lantern = new THREE.CylinderGeometry(0.03, 0.05, 0.16, 6, 1);
    lantern.translate(0, 0.54, 0);
    out.push({
      key: "cityhall",
      at: [hall.at[0], surfaceY(hall.at), hall.at[1]],
      rotY: 0,
      pieces: [box(1.05, 0.3, 0.64, 0), dome, lantern],
    });
  }

  return out;
};

/** Sutro Tower: three splayed legs into a banded mast, with the antenna arms near the top. */
const buildSutro = (height: number): THREE.BufferGeometry => {
  const pos: number[] = [];
  const col: number[] = [];

  const radiusAt = (t: number): number =>
    t < 0.38 ? 0.44 + (0.1 - 0.44) * (t / 0.38) : 0.1 + (0.03 - 0.1) * ((t - 0.38) / 0.62);
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

  const steps = 21;
  for (const angle of legs) {
    for (let s = 0; s < steps; s++) {
      const t0 = s / steps;
      const t1 = (s + 1) / steps;
      seg(at(angle, t0), at(angle, t1), bandAt((t0 + t1) / 2));
    }
  }
  for (let s = 0; s < steps; s++) {
    const t0 = 0.38 + (0.62 * s) / steps;
    const t1 = 0.38 + (0.62 * (s + 1)) / steps;
    seg([0, t0 * height, 0], [0, t1 * height, 0], bandAt((t0 + t1) / 2));
  }
  for (const t of [0.04, 0.12, 0.21, 0.3, 0.38, 0.5, 0.62, 0.74, 0.86]) {
    const c = bandAt(t);
    for (let i = 0; i < 3; i++) seg(at(legs[i], t), at(legs[(i + 1) % 3], t), c);
  }
  for (const t of [0.7, 0.84]) {
    const y = t * height;
    const r = radiusAt(t);
    for (const angle of legs) {
      const a: [number, number, number] = [Math.cos(angle) * r, y, Math.sin(angle) * r];
      const b: [number, number, number] = [Math.cos(angle) * (r + 0.2), y, Math.sin(angle) * (r + 0.2)];
      seg(a, b, BAND_COOL);
      seg(b, [b[0], y + 0.11, b[2]], BAND_COOL);
    }
  }
  seg([0, height, 0], [0, height + 0.3, 0], BAND_COOL);

  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return g;
};

const buildBridges = (): THREE.BufferGeometry => {
  const pos: number[] = [];
  const col: number[] = [];
  const seg = (
    a: [number, number, number],
    b: [number, number, number],
    c: THREE.Color,
  ): void => {
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
        prevDeck = deck;
        prevCable = cable;
      }
    }

    for (const t of [tA, tB]) {
      const { p, nx, nz } = sample(t);
      for (const side of [-half, half]) {
        const x = p.x + nx * side;
        const z = p.z + nz * side;
        seg([x, deckY - 0.45, z], [x, deckY + towerH + 0.1, z], CABLE);
      }
      // the tower's cross-beam, so it reads as a portal rather than two sticks
      const ax = p.x + nx * -half;
      const az = p.z + nz * -half;
      const bx = p.x + nx * half;
      const bz = p.z + nz * half;
      seg([ax, deckY + towerH * 0.62, az], [bx, deckY + towerH * 0.62, bz], CABLE);
      seg([ax, deckY + towerH + 0.1, az], [bx, deckY + towerH + 0.1, bz], CABLE);
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
    const outlines = volumes.map((v) => v.pieces.map((p) => new THREE.EdgesGeometry(p, 24)));
    const sutroMark = find("SUTRO");
    return {
      volumes,
      outlines,
      sutro: sutroMark ? buildSutro(sutroMark.height) : null,
      sutroAt: sutroMark ? ([sutroMark.at[0], surfaceY(sutroMark.at), sutroMark.at[1]] as const) : null,
      bridges: buildBridges(),
    };
  }, []);

  const bodyMaterial = useMemo(() => new THREE.MeshLambertMaterial({ color: palette.navy800, fog: true }), []);
  const edgeMaterial = useMemo(() => new THREE.LineBasicMaterial({ color: EDGE, fog: true }), []);
  const latticeMaterial = useMemo(
    () => new THREE.LineBasicMaterial({ vertexColors: true, fog: true }),
    [],
  );
  const bridgeMaterial = useMemo(
    () => new THREE.LineBasicMaterial({ vertexColors: true, fog: true }),
    [],
  );

  useEffect(
    () => () => {
      for (const v of built.volumes) for (const p of v.pieces) p.dispose();
      for (const set of built.outlines) for (const o of set) o.dispose();
      built.sutro?.dispose();
      built.bridges.dispose();
      bodyMaterial.dispose();
      edgeMaterial.dispose();
      latticeMaterial.dispose();
      bridgeMaterial.dispose();
    },
    [built, bodyMaterial, edgeMaterial, latticeMaterial, bridgeMaterial],
  );

  return (
    <group>
      {built.volumes.map((v, i) => (
        <group key={v.key} position={v.at} rotation={[0, v.rotY, 0]}>
          {v.pieces.map((piece, j) => (
            <group key={j}>
              <mesh geometry={piece} material={bodyMaterial} />
              <lineSegments geometry={built.outlines[i][j]} material={edgeMaterial} />
            </group>
          ))}
        </group>
      ))}

      {built.sutro && built.sutroAt && (
        <lineSegments
          geometry={built.sutro}
          material={latticeMaterial}
          position={[built.sutroAt[0], built.sutroAt[1], built.sutroAt[2]]}
        />
      )}

      <lineSegments geometry={built.bridges} material={bridgeMaterial} frustumCulled={false} />
    </group>
  );
}
