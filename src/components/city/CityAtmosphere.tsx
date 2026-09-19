'use client';

import { Stars } from '@react-three/drei';

import { COLOR } from '@/lib/tokens';
import { useAuraStore } from '@/state/auraStore';

const STAR_COUNT = { high: 260, medium: 140, low: 0 } as const;

/**
 * The void the city sits in: near-black navy, exponential fog, one cool key light
 * and a violet rim so the skyline separates from the dark.
 */
export function CityAtmosphere() {
  const quality = useAuraStore((s) => s.quality);
  const still = useAuraStore((s) => s.reducedMotion || s.degraded);
  const stars = STAR_COUNT[quality];

  return (
    <>
      <color attach="background" args={[COLOR.fog]} />
      <fogExp2 attach="fog" args={[COLOR.fog, 0.0058]} />

      <ambientLight intensity={0.85} color="#1b3358" />
      <directionalLight position={[52, 84, 34]} intensity={1.15} color="#9fc6ff" />
      <directionalLight position={[-64, 30, -46]} intensity={0.42} color={COLOR.violet} />
      {/* Downtown reads warmer than the outskirts. */}
      <pointLight position={[0, 26, 0]} intensity={620} distance={150} decay={2} color="#2f6fa8" />

      {stars > 0 && (
        <Stars
          radius={300}
          depth={80}
          count={stars}
          factor={6}
          saturation={0}
          fade
          speed={still ? 0 : 0.35}
        />
      )}
    </>
  );
}
