'use client';

import { Canvas, type RootState } from '@react-three/fiber';
import { Suspense, lazy, useCallback, useEffect, useState, useSyncExternalStore } from 'react';

import { CityFallback } from '@/components/shell/CityFallback';
import { useAuraStore } from '@/state/auraStore';

// Deferred so nothing in the 3D dependency graph is evaluated on the server or
// before the WebGL probe has answered.
const CityScene = lazy(() =>
  import('@/components/city/CityScene').then((m) => ({ default: m.CityScene })),
);

let probed: boolean | null = null;

function probeWebGL(): boolean {
  try {
    const probe = document.createElement('canvas');
    const ctx = probe.getContext('webgl2') ?? probe.getContext('webgl');
    if (!ctx) return false;
    // Release the probe context immediately — drivers only allow a handful.
    ctx.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

/** Cached: the answer cannot change for the lifetime of the document. */
function readSupport(): boolean {
  if (probed === null) probed = probeWebGL();
  return probed;
}

/** Unknown on the server, so the first paint commits neither branch. */
function serverSupport(): null {
  return null;
}

const noSubscribe = () => () => {};

/**
 * The only place an R3F canvas exists. Full-bleed, behind every panel.
 *
 * The canvas is never mounted speculatively: WebGL is probed first, and a context
 * lost later on drops to the 2D city rather than leaving a dead black rectangle
 * under the deck.
 *
 * `dpr` is the initial range only. Once mounted, the scene's own performance
 * governor owns resolution imperatively, so this prop must never change.
 */
export function SceneCanvas() {
  const support = useSyncExternalStore(noSubscribe, readSupport, serverSupport);
  const [lost, setLost] = useState(false);
  const setDegraded = useAuraStore((s) => s.setDegraded);

  const fallback = lost || support === false;

  // No renderer is itself a degraded renderer: globals.css drops backdrop-filter and
  // every component collapses its motion to match.
  useEffect(() => {
    if (fallback) setDegraded(true);
  }, [fallback, setDegraded]);

  const onCreated = useCallback(
    ({ gl }: RootState) => {
      gl.domElement.addEventListener(
        'webglcontextlost',
        () => {
          setLost(true);
          setDegraded(true);
        },
        { once: true },
      );
    },
    [setDegraded],
  );

  return (
    <div className="absolute inset-0 z-0">
      {fallback && <CityFallback />}
      {!fallback && support === true && (
        <Canvas
          dpr={[1, 1.5]}
          gl={{ antialias: false, powerPreference: 'high-performance' }}
          camera={{ position: [0, 122, 122], fov: 40, near: 0.5, far: 600 }}
          shadows={false}
          flat
          onCreated={onCreated}
        >
          <Suspense fallback={null}>
            <CityScene />
          </Suspense>
        </Canvas>
      )}
    </div>
  );
}
