"use client";

// A calm 3/4 aerial looking north-east: the incident sits foreground, the downtown skyline behind
// it. When a new incident is located the camera flies to it — damped, delta-time, ~1.4s — but the
// orbit controls stay live the entire time and any manual input cancels the flight immediately.
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

/** The city is always read along one axis: south-west camera, north-east view, downtown behind. */
const VIEW = new THREE.Vector3(0.748, 0, -0.662).normalize();

const HOME_TARGET = new THREE.Vector3(9, 0.6, -7);
const HOME_DH = 65;
const HOME_H = 47;

const FOCUS_DH = 26;
const FOCUS_H = 19;

const placeCamera = (target: THREE.Vector3, dh: number, h: number, out: THREE.Vector3): THREE.Vector3 => {
  out.copy(target).addScaledVector(VIEW, -dh);
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
    const next = new THREE.Vector3(x, surfaceY([x, z]) + 0.35, z);
    // Ignore jitter from repeated incident snapshots carrying the same coordinates.
    if (goalTarget.distanceTo(next) < 0.4 && started.current) return;
    goalTarget.copy(next);
    placeCamera(goalTarget, FOCUS_DH, FOCUS_H, goalPos);
    flying.current = true;
  }, [lat, lon, goalPos, goalTarget]);

  useFrame((state, delta) => {
    const c = controls.current;
    if (!c) return;

    if (!started.current) {
      started.current = true;
      c.target.copy(HOME_TARGET);
      placeCamera(HOME_TARGET, HOME_DH, HOME_H, state.camera.position);
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
