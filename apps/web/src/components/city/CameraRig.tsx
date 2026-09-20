"use client";

// Two framings, one rig. At rest it is a calm 3/4 aerial from over the bay looking west-north-west,
// which is the shot that has to say "San Francisco" on its own. When an incident is located the
// camera flies to it — damped, delta-time, ~1.4s — swinging onto the Twin Peaks → Financial District
// axis so the incident sits foreground with the skyline behind it. The orbit controls stay live the
// entire time and any manual input cancels the flight immediately.
// Reduced motion / low quality cuts instead of flying (DESIGN.md §6).
import { OrbitControls } from "@react-three/drei";
import { useFrame } from "@react-three/fiber";
import { useReducedMotion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { project } from "@/lib/geo";
import { damp } from "@/lib/motion";
import { useAura } from "@/state/auraStore";
import { useActiveCall } from "@/state/selectors";
import { surfaceY } from "./Terrain";

/** Structural view of drei's OrbitControls instance — everything the rig needs, nothing it doesn't. */
type ControlsLike = { target: THREE.Vector3; update: () => unknown };

/** Compass bearing the camera looks along → unit direction. 0° = north (-z), 90° = east (+x). */
const axis = (deg: number): THREE.Vector3 => {
  const a = (deg * Math.PI) / 180;
  return new THREE.Vector3(Math.sin(a), 0, -Math.cos(a)).normalize();
};

/**
 * The establishing view: camera out over the bay to the east-south-east, looking west-north-west
 * across the city. This is the angle SF is actually photographed from, and it is chosen for three
 * reasons the old south-west axis could not satisfy at once:
 *
 *   · the camera stands on WATER instead of on the peninsula. Looking north-east from the south-west
 *     put it on Ocean Beach, so it was aimed *along* the landmass and the near half of the frame was
 *     undifferentiated Sunset fabric with the western coastline a full screen-height below the view.
 *   · the densest, most legible part of the model — the Financial District, the Ferry Building, the
 *     Bay Bridge — is now the CLOSEST thing in frame rather than a smudge at 136 units.
 *   · Market Street sits 67° off the view axis instead of 5°, so the seam and the rotated SoMa grid
 *     read as a diagonal instead of collapsing into a corridor running away from the camera.
 */
const HOME_VIEW = axis(288);

/**
 * The incident view. This used to be the Twin Peaks → Financial District line (az 48.5) on the
 * reasoning that it stacks the skyline up directly behind the incident — but the approval modal
 * opens in the same moment the camera arrives, and the projector showed downtown landing at
 * (960, 391), which is dead centre behind that card. The skyline was being drawn and then covered.
 *
 * Swinging the axis north to 22° keeps the incident centred under the modal but rotates the rest of
 * the city out into the two strips the card leaves open: the Golden Gate at (473, 475) on the left,
 * downtown and the Bay Bridge at (1264, 444) and (1372, 434) on the right. Same incident framing,
 * but the frame around it is no longer empty fabric.
 */
const FOCUS_VIEW = axis(22);

/**
 * Framing. Two things are in tension: the camera needs real altitude for the coastline to separate
 * from the vanishing point (fly too low and the whole peninsula compresses into the fog band), but
 * it needs a shallow *pitch* for sky to stay in the top of the frame and for buildings to read as
 * mass rather than as a floor plan.
 *
 * They are separable, because the pitch is set by where the camera aims, not by how high it is. So
 * the rig aims at a point lifted well above the ground — proportional to the viewing distance, so
 * the composition holds at any range — and keeps the camera high behind it.
 */
const AIM_RATIO = 0.22;

/**
 * Ground point the home view is built around. Solved against a projector that replicates this exact
 * transform (.shots/aim.mjs), not eyeballed: it puts downtown around (1205, 807) at 91 units, the
 * incident ridge and Sutro at (610, 672), the Golden Gate at (1187, 530) and Ocean Beach's straight
 * western edge on screen at (407, 564), with the horizon at y≈199 and open bay across the bottom.
 */
const HOME_GROUND = new THREE.Vector3(30, 0, -20);
const HOME_DH = 78;
const HOME_H = 27;

/** Focused on an incident: it lands around (961, 790), just clear of the modal's bottom edge. */
const FOCUS_DH = 44;
const FOCUS_H = 17;

/** Ground point + viewing distance → the lifted point the camera actually aims at. */
const aimAt = (groundX: number, groundY: number, groundZ: number, dh: number, out: THREE.Vector3): THREE.Vector3 =>
  out.set(groundX, groundY + dh * AIM_RATIO, groundZ);

const placeCamera = (
  target: THREE.Vector3,
  view: THREE.Vector3,
  dh: number,
  h: number,
  out: THREE.Vector3,
): THREE.Vector3 => {
  out.copy(target).addScaledVector(view, -dh);
  out.y = target.y + h;
  return out;
};

export default function CameraRig() {
  const controls = useRef<ControlsLike | null>(null);
  const quality = useAura((s) => s.quality);
  const reduced = useReducedMotion() === true;
  const instant = reduced || quality === "low";

  const call = useActiveCall();
  const location = call?.incident?.location;
  const lat = location?.latitude ?? null;
  const lon = location?.longitude ?? null;

  const goalPos = useMemo(() => new THREE.Vector3(), []);
  const goalTarget = useMemo(() => new THREE.Vector3(), []);
  const flying = useRef(false);
  const started = useRef(false);

  useEffect(() => {
    if (lat === null || lon === null) return;
    const [x, z] = project(lat, lon);
    const next = aimAt(x, surfaceY([x, z]) + 0.35, z, FOCUS_DH, new THREE.Vector3());
    // Ignore jitter from repeated incident snapshots carrying the same coordinates.
    if (goalTarget.distanceTo(next) < 0.4 && started.current) return;
    goalTarget.copy(next);
    placeCamera(goalTarget, FOCUS_VIEW, FOCUS_DH, FOCUS_H, goalPos);
    flying.current = true;
  }, [lat, lon, goalPos, goalTarget]);

  useFrame((state, delta) => {
    const c = controls.current;
    if (!c) return;

    if (!started.current) {
      started.current = true;
      aimAt(HOME_GROUND.x, HOME_GROUND.y, HOME_GROUND.z, HOME_DH, c.target);
      placeCamera(c.target, HOME_VIEW, HOME_DH, HOME_H, state.camera.position);
      c.update();
    }

    if (!flying.current) return;

    if (instant) {
      state.camera.position.copy(goalPos);
      c.target.copy(goalTarget);
      flying.current = false;
      c.update();
      return;
    }

    const k = damp(2.2, Math.min(delta, 0.1));
    state.camera.position.lerp(goalPos, k);
    c.target.lerp(goalTarget, k);
    if (state.camera.position.distanceTo(goalPos) < 0.08) flying.current = false;
    c.update();
  });

  // Stable identities: this component re-renders on every store event, and drei re-binds listeners
  // whenever these change.
  const attach = useCallback((instance: ControlsLike | null) => {
    controls.current = instance;
  }, []);
  const cancelFlight = useCallback(() => {
    // The dispatcher grabbed the city. Their input wins over the flight, instantly.
    flying.current = false;
  }, []);

  return (
    <OrbitControls
      ref={attach}
      makeDefault
      enableDamping
      dampingFactor={0.07}
      rotateSpeed={0.5}
      zoomSpeed={0.7}
      minDistance={6}
      maxDistance={200}
      minPolarAngle={0.12}
      maxPolarAngle={1.45}
      onStart={cancelFlight}
    />
  );
}
