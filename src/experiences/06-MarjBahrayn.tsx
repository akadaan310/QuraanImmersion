/**
 * ٦ — مرج البحرين يلتقيان
 * Two fluids of different density meet along a barrier and do not mix. The
 * barrier is not painted on: each body is advected by its OWN flow field and the
 * shader hard-clips every sample to its side of the salinity boundary, so no
 * amount of agitation can transport matter across.
 */

import * as THREE from 'three';
import { GLSL_PRELUDE } from '@/shaders/common';
import { useEngineUniforms } from '@/engine/uniforms';
import type { SceneProps } from './types';

const vertexShader = /* glsl */ `
${GLSL_PRELUDE}

varying vec2 vUv;
varying float vSide;
varying float vHeight;

void main() {
  vUv = uv;
  vec3 p = position;

  // Barrier meanders with the recitation but stays a single-valued boundary.
  float boundary = sin(p.y * 2.1 + uTime * 0.35) * (0.10 + uIsnaadA.y * 0.16);
  float side = p.x - boundary;
  vSide = side;

  float t = uTime * 0.5;
  // Dense body: short wavelength, low amplitude. Light body: the opposite.
  float dense = fbm(vec3(p.xy * 3.1, t * 0.6), 3) * (0.035 + uLowMid * 0.10);
  float light = fbm(vec3(p.xy * 1.2 + 40.0, t * 0.35), 3) * (0.10 + uMid * 0.26);

  float h = side < 0.0 ? dense : light;
  vHeight = h;
  p.z += h;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const fragmentShader = /* glsl */ `
${GLSL_PRELUDE}

varying vec2 vUv;
varying float vSide;
varying float vHeight;

void main() {
  float t = uTime * 0.4;

  // Each body samples its own field; neither term can read across the boundary.
  float saline = fbm(vec3(vUv * 9.0, t), 4) * 0.5 + 0.5;
  float fresh  = fbm(vec3(vUv * 4.0 + 21.0, t * 0.7), 4) * 0.5 + 0.5;

  vec3 salineColor = mix(vec3(0.01, 0.09, 0.16), vec3(0.05, 0.42, 0.48), saline);
  vec3 freshColor  = mix(vec3(0.02, 0.05, 0.14), vec3(0.24, 0.30, 0.66), fresh);

  // البرزخ: a hard gate, not a blend. Width shrinks as the command vector holds.
  float gate = 0.006 + 0.010 * (1.0 - uIsnaadA.x);
  float mask = step(0.0, vSide);
  vec3 color = mix(salineColor, freshColor, mask);

  float seam = 1.0 - smoothstep(0.0, gate * 6.0, abs(vSide));
  color += uAccent * seam * (0.35 + uIsnaadA.y * 1.5 + uTransient * 0.8);

  // Surface relief keeps the two bodies readable as different substances.
  color *= 0.75 + vHeight * 2.2;

  gl_FragColor = vec4(tonemap(color * uIntensity), 1.0);
}
`;

export function MarjBahraynScene({ accent }: SceneProps) {
  const uniforms = useEngineUniforms(accent);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]}>
      <planeGeometry args={[4.6, 4.6, 200, 200]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
