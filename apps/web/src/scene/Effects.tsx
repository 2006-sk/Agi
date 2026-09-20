import { Bloom, EffectComposer, Noise, Vignette } from "@react-three/postprocessing";

export function Effects({ quality }: { quality: number }) {
  return (
    <EffectComposer multisampling={0} enableNormalPass={false}>
      <Bloom mipmapBlur intensity={quality > 1 ? 1.7 : 1.2} luminanceThreshold={0.09} luminanceSmoothing={0.4} radius={0.85} />
      <Vignette eskil={false} offset={0.22} darkness={0.9} />
      <Noise opacity={0.035} />
    </EffectComposer>
  );
}
