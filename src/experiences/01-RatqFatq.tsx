/**
 * ١ — الرتق والفتق
 * A sealed singularity whose vertices inflate outward under sub-bass pressure.
 * Below the threshold the surface is smooth and closed (رتق); as the low band
 * loads, seams open across it and the interior light escapes (فتق).
 */

import * as THREE from 'three';
import { GLSL_PRELUDE } from '@/shaders/common';
import { useEngineUniforms } from '@/engine/uniforms';
import type { SceneProps } from './types';

const vertexShader = /* glsl */ `
${GLSL_PRELUDE}

varying vec3 vNormalW;
varying vec3 vViewW;
varying float vSeam;
varying float vExpansion;

void main() {
  vec3 dir = normalize(position);

  // Inflation is driven by the sub-bass, gated by the command vector: without a
  // trigger the singularity stays sealed no matter how loud the field is.
  float pressure = uSubBass * 0.55 + uBass * 0.35;
  float expansion = uIsnaadA.x * (0.25 + pressure * 1.35) + uClosure * 0.4;
  vExpansion = expansion;

  // Seams: a noise field that only crosses the fracture threshold once inflated.
  float seam = fbm(dir * 2.6 + vec3(0.0, uTime * 0.07, 0.0), 4);
  float open = smoothstep(0.55 - expansion * 0.75, 0.9 - expansion * 0.5, abs(seam));
  vSeam = open;

  float radius = 1.0 + expansion * 0.55 + open * expansion * 0.45
               + snoise(dir * 4.0 + vec3(uTime * 0.2)) * uIsnaadA.y * 0.06;

  vec3 displaced = dir * radius;

  vec4 world = modelMatrix * vec4(displaced, 1.0);
  vNormalW = normalize(mat3(modelMatrix) * dir);
  vViewW = normalize(cameraPosition - world.xyz);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const fragmentShader = /* glsl */ `
${GLSL_PRELUDE}

varying vec3 vNormalW;
varying vec3 vViewW;
varying float vSeam;
varying float vExpansion;

void main() {
  float rim = fresnel(vNormalW, vViewW, 2.2);

  vec3 sealed = vec3(0.03, 0.05, 0.09);
  vec3 core = uAccent * (1.4 + vExpansion * 2.2);

  // Light only reaches the surface where the seam has actually opened.
  vec3 color = mix(sealed, core, vSeam * clamp(vExpansion * 1.6, 0.0, 1.0));
  color += uAccent * rim * (0.35 + vExpansion);
  color += vec3(1.0, 0.86, 0.62) * uTransient * vSeam * 0.9;

  gl_FragColor = vec4(tonemap(color * uIntensity), 1.0);
}
`;

export function RatqFatqScene({ accent }: SceneProps) {
  const uniforms = useEngineUniforms(accent);
  return (
    <mesh scale={1.55}>
      <icosahedronGeometry args={[1, 128]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        side={THREE.FrontSide}
      />
    </mesh>
  );
}
