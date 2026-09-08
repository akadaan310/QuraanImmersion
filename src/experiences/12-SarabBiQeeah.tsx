/**
 * ١٢ — سراباً بقيعة
 * A mirage over an endless salt flat. The shimmer is a refraction of the horizon
 * band into the ground plane; the closer the observer's coupling (L4) gets, the
 * more the water it promises evaporates — the image is strongest at a distance.
 */

import * as THREE from 'three';
import { GLSL_PRELUDE } from '@/shaders/common';
import { useEngineUniforms } from '@/engine/uniforms';
import type { SceneProps } from './types';

const vertexShader = /* glsl */ `
${GLSL_PRELUDE}
varying vec2 vUv;
varying vec3 vWorld;

void main() {
  vUv = uv;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const fragmentShader = /* glsl */ `
${GLSL_PRELUDE}
varying vec2 vUv;
varying vec3 vWorld;

void main() {
  // Distance from the observer along the plane sets the shimmer band.
  float dist = length(vWorld.xz);
  float horizon = smoothstep(0.6, 3.4, dist);

  // Heat shimmer: a fast, thin, horizontally stretched distortion field.
  vec2 warp = vec2(
    snoise(vec3(vUv * vec2(3.0, 26.0), uTime * 1.4)),
    snoise(vec3(vUv * vec2(3.0, 26.0) + 31.0, uTime * 1.1))
  );
  float heat = (0.15 + uMid * 0.7 + uIsnaadA.y * 0.6);
  vec2 uv = vUv + warp * heat * 0.035 * horizon;

  // Cracked salt crust.
  float crust = fbm(vec3(uv * 22.0, 0.0), 4);
  float cracks = smoothstep(0.02, 0.0, abs(crust)) * 0.8;
  vec3 salt = mix(vec3(0.62, 0.60, 0.55), vec3(0.86, 0.85, 0.80), crust * 0.5 + 0.5);
  salt -= cracks * 0.35;

  // The false water: a reflected sky band that only exists in the far field and
  // recedes as the observer closes in (L4 high ⇒ the image is spent).
  float water = horizon * (1.0 - uIsnaadB.x * 0.65);
  float ripple = sin(uv.y * 90.0 + uTime * 2.0 + warp.x * 4.0) * 0.5 + 0.5;
  vec3 illusion = mix(vec3(0.35, 0.55, 0.72), uAccent, 0.35) * (0.5 + ripple * 0.6);

  vec3 color = mix(salt * 0.35, illusion, water * 0.85);

  // At full closure nothing is found there at all.
  color = mix(color, salt * 0.32, uClosure * 0.7);

  gl_FragColor = vec4(tonemap(color * uIntensity), 1.0);
}
`;

export function SarabScene({ accent }: SceneProps) {
  const uniforms = useEngineUniforms(accent);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.1, 0]}>
      <planeGeometry args={[9, 9, 2, 2]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
