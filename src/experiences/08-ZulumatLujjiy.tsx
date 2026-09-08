/**
 * ٨ — ظلمات في بحر لُجّي
 * Layered darkness. A ray is marched down through stacked absorbing strata;
 * each layer attenuates what the one above transmitted, so the darkness is
 * cumulative rather than painted. Only a weak internal scatter survives.
 */

import * as THREE from 'three';
import { GLSL_PRELUDE, GLSL_SCREEN_VERT } from '@/shaders/common';
import { useEngineUniforms } from '@/engine/uniforms';
import type { SceneProps } from './types';

const fragmentShader = /* glsl */ `
${GLSL_PRELUDE}

varying vec2 vUv;

const int LAYERS = 7;

void main() {
  vec3 ro = vec3(vUv * 2.0 - 1.0, 0.0);
  float t = uTime * 0.12;

  // Transmittance starts at 1 above the surface and is consumed layer by layer.
  float transmittance = 1.0;
  vec3 tint = vec3(0.0);

  for (int i = 0; i < LAYERS; i++) {
    float depth = float(i) / float(LAYERS);

    // Wave sheet for this stratum — slower and denser the deeper it sits.
    float sheet = fbm(vec3(ro.xy * (2.4 - depth * 1.3), t + depth * 3.0), 4) * 0.5 + 0.5;

    // Density grows with depth and with the low band: the sea thickens on bass.
    float density = (0.22 + depth * 0.9) * (0.6 + uBass * 0.9 + uIsnaadA.z * 0.5);
    float absorbed = density * (0.55 + sheet * 0.9);

    // Beer-Lambert: each layer only removes what the layers above left behind.
    float layerTransmit = exp(-absorbed * 1.35);

    // Faint internal scatter — light that never reaches the eye directly.
    float glim = pow(sheet, 6.0) * transmittance * (0.15 + uIsnaadA.y * 0.9);
    tint += mix(vec3(0.02, 0.06, 0.16), uAccent, depth) * glim;

    transmittance *= layerTransmit;
  }

  // موج من فوقه موج: the crest layer shows a residual surface relief.
  float crest = fbm(vec3(ro.xy * 3.0, t * 1.6), 3) * 0.5 + 0.5;
  float surface = pow(crest, 9.0) * transmittance * (0.4 + uHighMid * 1.2);

  vec3 color = tint * 1.6 + vec3(0.01, 0.02, 0.05) * transmittance * 3.0;
  color += uAccent * surface * 0.8;
  color += uAccent * uClosure * 0.35 * transmittance;

  // The observer's own coupling (L4) is what little light gets through at all.
  color *= 0.35 + uIsnaadB.x * 0.9;

  gl_FragColor = vec4(tonemap(color * uIntensity), 1.0);
}
`;

export function ZulumatLujjiyScene({ accent }: SceneProps) {
  const uniforms = useEngineUniforms(accent);
  return (
    <mesh>
      <sphereGeometry args={[2.3, 64, 64]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={GLSL_SCREEN_VERT}
        fragmentShader={fragmentShader}
        side={THREE.BackSide}
      />
    </mesh>
  );
}
