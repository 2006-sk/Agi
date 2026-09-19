'use client';

import { Suspense, useCallback, useRef } from 'react';
import { AdaptiveDpr, AdaptiveEvents, PerformanceMonitor } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { Bloom, EffectComposer, Vignette } from '@react-three/postprocessing';

import { AuraCity } from '@/components/city/AuraCity';
import { CameraRig } from '@/components/city/CameraRig';
import { CityAtmosphere } from '@/components/city/CityAtmosphere';
import { IncidentBeacon } from '@/components/city/IncidentBeacon';
import { ResponderRoute } from '@/components/city/ResponderRoute';
import { ResponderUnit } from '@/components/city/ResponderUnit';
import { useAuraStore, type Quality } from '@/state/auraStore';

/** The whole scene. The Canvas owner renders this and nothing else. */
export function CityScene() {
  const quality = useAuraStore((s) => s.quality);

  return (
    <>
      <PerformanceGovernor />
      <AdaptiveDpr pixelated={false} />
      <AdaptiveEvents />

      <CityAtmosphere />

      <Suspense fallback={null}>
        <AuraCity />
        <IncidentBeacon />
        <ResponderRoute />
        <ResponderUnit />
      </Suspense>

      <CameraRig />
      <Effects quality={quality} />
    </>
  );
}

/**
 * Four steps down, one step at a time: resolution first, then effects, then
 * motion. Step 3 is the degraded floor — a static, fully legible city — and only
 * three consecutive declines reach it: a shader-compile stutter on load must not
 * strand the whole app there, so giving up settles at medium instead.
 */
function PerformanceGovernor() {
  const setDpr = useThree((s) => s.setDpr);
  const initialDpr = useThree((s) => s.viewport.initialDpr);
  const setQuality = useAuraStore((s) => s.setQuality);
  const setDegraded = useAuraStore((s) => s.setDegraded);
  const step = useRef(0);

  const apply = useCallback(
    (next: number) => {
      const s = next < 0 ? 0 : next > 3 ? 3 : next;
      if (s === step.current) return;
      step.current = s;
      switch (s) {
        case 0:
          setDpr(initialDpr);
          setQuality('high');
          setDegraded(false);
          break;
        case 1:
          setDpr(Math.min(1, initialDpr));
          setQuality('high');
          setDegraded(false);
          break;
        case 2:
          setDpr(Math.min(1, initialDpr));
          setQuality('medium');
          setDegraded(false);
          break;
        default:
          setDpr(Math.min(0.85, initialDpr));
          setQuality('low');
          setDegraded(true);
          break;
      }
    },
    [initialDpr, setDegraded, setDpr, setQuality],
  );

  return (
    <PerformanceMonitor
      flipflops={3}
      onDecline={() => apply(step.current + 1)}
      onIncline={() => apply(step.current - 1)}
      onFallback={() => apply(2)}
    />
  );
}

function Effects({ quality }: { quality: Quality }) {
  if (quality === 'low') return null;

  if (quality === 'medium') {
    return (
      <EffectComposer multisampling={0}>
        <Bloom
          mipmapBlur
          luminanceThreshold={0.21}
          luminanceSmoothing={0.24}
          intensity={0.72}
          radius={0.62}
        />
      </EffectComposer>
    );
  }

  return (
    <EffectComposer multisampling={0}>
      <Bloom
        mipmapBlur
        luminanceThreshold={0.18}
        luminanceSmoothing={0.3}
        intensity={0.95}
        radius={0.72}
      />
      <Vignette offset={0.26} darkness={0.82} eskil={false} />
    </EffectComposer>
  );
}
