'use client';

import { Canvas, type RootState } from '@react-three/fiber';
import { Suspense, lazy, useCallback, useEffect, useState } from 'react';

import { CityFallback } from '@/components/shell/CityFallback';
import { useAuraStore } from '@/state/auraStore';

// Deferred so nothing in the 3D dependency graph is evaluated on the server or
// before the WebGL probe has answered.
const CityScene = lazy(() =>
  import('@/components/city/CityScene').then((m) => ({ default: m.CityScene })),
);

type Mode = 'probing' | 'webgl' | 'fallback';

function probeWebGL(): boolean {
  try {
    const probe = document.createElement('canvas');
    const ctx =
      probe.getContext('webgl2') ??
      probe.getContext('webgl') ??
      probe.getContext('experimental-webgl');
    if (!ctx) return false;
    // Release the probe context immediately — some drivers only allow a handful.
    const lose = (ctx as WebGLRenderingContext).getExtension('WEBGL_lose_context');
    (lose as { loseContext?: () => void } | null)?.loseContext?.();
    return true;
  } catch {
    return false;
  }
}

/**
 * The only place an R3F canvas exists. Full-bleed, behind every panel.
 *
 * The canvas is never mounted speculatively: WebGL is probed first, and a lost
 * context later on drops straight to the 2D city rather than leaving a dead black
 * rectangle under the deck.
 */
export function SceneCanvas() {
  const [mode, setMode] = useState<Mode>('probing');
  const setDegraded = useAuraStore((s) => s.setDegraded);
  const degraded = useAuraStore((s) => s.degraded);

  useEffect(() => {
    if (probeWebGL()) {
      setMode('webgl');
      return;
    }
    setMode('fallback');
    setDegraded(true);
  }, [setDegraded]);

  const onCreated = useCallback(
    ({ gl }: RootState) => {
      gl.domElement.addEventListener(
        'webglcontextlost',
        () => {
          setMode('fallback');
          setDegraded(true);
        },
        { once: true },
      );
    },
    [setDegraded],
  );

  return (
    <div className="absolute inset-0 z-0">
      {mode === 'fallback' && <CityFallback />}
      {mode === 'webgl' && (
        <Canvas
          dpr={degraded ? 1 : [1, 1.5]}
          gl={{ antialias: false, powerPreference: 'high-performance' }}
          camera={{ position: [0, 78, 118], fov: 42, near: 0.5, far: 600 }}
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
