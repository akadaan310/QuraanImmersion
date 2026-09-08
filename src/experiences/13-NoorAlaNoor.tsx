/**
 * ١٣ — نور على نور
 * Layered photonic interference. Three nested glass shells each refract the one
 * inside them; the outer layers are drawn additively so their contributions
 * genuinely stack — light upon light — rather than replacing one another.
 */

import * as THREE from 'three';
import { GLSL_PRELUDE } from '@/shaders/common';
import { useEngineUniforms } from '@/engine/uniforms';
import type { SceneProps } from './types';

const vertexShader = /* glsl */ `
${GLSL_PRELUDE}
uniform float uShell;

varying vec3 vNormalW;
varying vec3 vViewW;
varying vec3 vLocal;

void main() {
  vec3 p = position;
  // Each shell breathes on a different band, so the interference pattern moves.
  float band = uShell < 0.5 ? uBass : (uShell < 1.5 ? uMid : uTreble);
  p *= 1.0 + band * 0.10 + uIsnaadA.y * 0.05;

  vLocal = p;
  vec4 world = modelMatrix * vec4(p, 1.0);
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vViewW = normalize(cameraPosition - world.xyz);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const fragmentShader = /* glsl */ `
${GLSL_PRELUDE}
uniform float uShell;

varying vec3 vNormalW;
varying vec3 vViewW;
varying vec3 vLocal;

void main() {
  vec3 n = normalize(vNormalW);
  vec3 v = normalize(vViewW);
  float rim = fresnel(n, v, 1.6 + uShell * 0.8);

  // Thin-film interference: optical path length modulates channel phase. The
  // sampling frequency is kept low — a high-frequency film speckles under
  // additive blending instead of banding.
  float thickness = 0.5 + 0.5 * snoise(vLocal * (1.1 + uShell * 0.45) + vec3(uTime * 0.12));
  float path = thickness * (4.0 + uShell * 2.4) + rim * 3.0 + uTime * 0.3;

  vec3 interference = vec3(
    sin(path) * 0.5 + 0.5,
    sin(path + 2.094) * 0.5 + 0.5,
    sin(path + 4.188) * 0.5 + 0.5
  );

  // Refraction through the shell picks up a second, offset light source.
  vec3 refracted = refract(-v, n, 0.82);
  float caustic = pow(max(0.0, dot(normalize(refracted), normalize(vec3(0.3, 1.0, 0.2)))), 12.0);

  // Three shells blend additively, so each one carries a third of the budget.
  float lamp = (0.16 + uIsnaadA.y * 1.0 + uIsnaadB.z * 0.4) * 0.8;
  vec3 color = mix(uAccent, interference, 0.5) * rim * lamp * 1.6;
  color += vec3(1.0, 0.93, 0.72) * caustic * lamp * 1.1;
  color += uAccent * uClosure * rim * 0.7;

  float alpha = clamp(rim * (0.26 + lamp * 0.45) + caustic * 0.35, 0.0, 0.85);
  gl_FragColor = vec4(tonemap(color * uIntensity), alpha);
}
`;

function Shell({ accent, index, radius }: { accent: string; index: number; radius: number }) {
  const uniforms = useEngineUniforms(accent, () => ({ uShell: { value: index } }));
  return (
    <mesh renderOrder={index}>
      <torusKnotGeometry args={[radius, radius * 0.30, 220, 32, 2, 3]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        transparent
        depthWrite={false}
        side={THREE.DoubleSide}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
}

export function NoorAlaNoorScene({ accent }: SceneProps) {
  return (
    <group>
      <Shell accent={accent} index={0} radius={0.72} />
      <Shell accent={accent} index={1} radius={1.02} />
      <Shell accent={accent} index={2} radius={1.34} />
    </group>
  );
}
