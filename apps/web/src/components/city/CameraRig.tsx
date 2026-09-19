'use client';

import { useEffect, useRef, type ComponentRef } from 'react';
import { OrbitControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import { useAuraStore } from '@/state/auraStore';

type Controls = ComponentRef<typeof OrbitControls>;

const HOME = new THREE.Vector3(58, 74, 104);
const MIN_DIST = 42;
const MAX_DIST = 300;
/** Where a fly-to settles: close enough to read the street, far enough to see the city. */
const VIEW_MIN = 56;
const VIEW_MAX = 130;

const offset = new THREE.Vector3();
const wantTarget = new THREE.Vector3();
const wantPos = new THREE.Vector3();

/**
 * Fly-to that always yields to the operator. The camera moves when the store asks
 * it to, and the instant a hand touches the mouse the flight is over.
 */
export function CameraRig() {
  const controls = useRef<Controls>(null);
  const camera = useThree((s) => s.camera);
  const cam = useAuraStore((s) => s.camera);
  const still = useAuraStore((s) => s.reducedMotion || s.degraded);
  const flying = useRef(false);

  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    c.target.set(0, 0, 0);
    // The Canvas owner frames the city; only rescue a camera that is inside it.
    if (camera.position.length() < MIN_DIST) camera.position.copy(HOME);
    c.update();
  }, [camera]);

  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    const onStart = () => {
      flying.current = false;
    };
    c.addEventListener('start', onStart);
    return () => c.removeEventListener('start', onStart);
  }, []);

  useEffect(() => {
    const c = controls.current;
    if (!c || !cam.target) return;

    wantTarget.set(cam.target.x, 0, cam.target.z);
    // Keep the operator's own angle; only close the distance if it is unreasonable.
    offset.copy(camera.position).sub(c.target);
    const dist = offset.length();
    if (dist < 1e-3) offset.copy(HOME);
    offset.setLength(THREE.MathUtils.clamp(dist, VIEW_MIN, VIEW_MAX));
    if (offset.y < 26) offset.setY(26);
    wantPos.copy(wantTarget).add(offset);

    if (still) {
      c.target.copy(wantTarget);
      camera.position.copy(wantPos);
      c.update();
      flying.current = false;
      return;
    }
    flying.current = true;
  }, [cam, camera, still]);

  // Ahead of OrbitControls (-1) so its update() sees this frame's values.
  useFrame((_, delta) => {
    const c = controls.current;
    if (!c || !flying.current) return;

    const k = 1 - Math.exp(-2.6 * Math.min(delta, 0.05));
    c.target.lerp(wantTarget, k);
    camera.position.lerp(wantPos, k);

    if (
      c.target.distanceToSquared(wantTarget) < 0.12 &&
      camera.position.distanceToSquared(wantPos) < 0.35
    ) {
      c.target.copy(wantTarget);
      camera.position.copy(wantPos);
      flying.current = false;
    }
  }, -2);

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.075}
      screenSpacePanning={false}
      minDistance={MIN_DIST}
      maxDistance={MAX_DIST}
      minPolarAngle={0.12}
      maxPolarAngle={Math.PI / 2 - 0.08}
      zoomSpeed={0.8}
      rotateSpeed={0.55}
      panSpeed={0.7}
    />
  );
}
