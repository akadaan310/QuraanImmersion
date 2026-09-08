/**
 * ٥ — البحر المسجور
 * A volumetric water surface displaced by the mid band, sitting directly on a
 * glowing lava grid. The heat below is read THROUGH the water body: depth
 * attenuates it, and the low band stokes it.
 */

import * as THREE from 'three';
import { GLSL_PRELUDE } from '@/shaders/common';
import { useEngineUniforms } from '@/engine/uniforms';
import type { SceneProps } from './types';

const vertexShader = /* glsl */ `
${GLSL_PRELUDE}

varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vViewW;
varying float vHeight;

void main() {
  vUv = uv;
  vec3 p = position;

  float t = uTime * 0.55;
  float swell = fbm(vec3(p.xy * 1.1, t * 0.4), 4) * (0.10 + uMid * 0.35 + uIsnaadA.y * 0.30);
  float chop = snoise(vec3(p.xy * 4.4, t)) * (0.02 + uHighMid * 0.10);

  float height = swell + chop;
  vHeight = height;
  p.z += height;

  // Analytic-ish normal from two offset samples of the same field.
  float e = 0.06;
  float hx = fbm(vec3((p.x + e) * 1.1, p.y * 1.1, t * 0.4), 3) * (0.10 + uMid * 0.35);
  float hy = fbm(vec3(p.x * 1.1, (p.y + e) * 1.1, t * 0.4), 3) * (0.10 + uMid * 0.35);
  vec3 nrm = normalize(vec3(height - hx, height - hy, e * 1.6));

  vec4 world = modelMatrix * vec4(p, 1.0);
  vNormalW = normalize(mat3(modelMatrix) * nrm);
  vViewW = normalize(cameraPosition - world.xyz);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const fragmentShader = /* glsl */ `
${GLSL_PRELUDE}

varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vViewW;
varying float vHeight;

void main() {
  // The lava grid beneath: fixed cells, breathing with the sub-bass.
  vec2 grid = fract(vUv * 26.0) - 0.5;
  float seam = 1.0 - smoothstep(0.02, 0.10, min(abs(grid.x), abs(grid.y)));
  float ember = fbm(vec3(vUv * 7.0, uTime * 0.16), 3) * 0.5 + 0.5;

  float heat = (seam * 0.85 + ember * 0.35)
             * (0.25 + uSubBass * 1.6 + uBass * 1.0 + uIsnaadA.z * 0.8);

  // Water column: crest thins the column, trough deepens it and hides the fire.
  float depth = clamp(0.55 - vHeight * 1.4, 0.05, 1.0);
  float transmitted = heat * exp(-depth * 2.6);

  vec3 lava = mix(vec3(1.0, 0.32, 0.06), vec3(1.0, 0.78, 0.25), clamp(heat * 0.6, 0.0, 1.0));
  vec3 water = mix(vec3(0.01, 0.06, 0.11), uAccent * 0.55, clamp(vHeight * 2.0 + 0.4, 0.0, 1.0));

  float rim = fresnel(vNormalW, vViewW, 3.0);
  vec3 color = water + lava * transmitted * 1.4 + uAccent * rim * 0.5;
  color += vec3(1.0, 0.6, 0.25) * uTransient * transmitted * 0.9;

  gl_FragColor = vec4(tonemap(color * uIntensity), 1.0);
}
`;

export function BahrMasjoorScene({ accent }: SceneProps) {
  const uniforms = useEngineUniforms(accent);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.7, 0]}>
      <planeGeometry args={[5, 5, 220, 220]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
