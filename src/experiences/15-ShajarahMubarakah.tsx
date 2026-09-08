/**
 * ١٥ — الشجرة المباركة والزيت
 * A self-luminous fluid. There is no light source in this scene and no lambert
 * term anywhere in the shader: radiance is generated inside the volume and
 * escapes outward, so the body glows without combustion.
 */

import * as THREE from 'three';
import { GLSL_PRELUDE, GLSL_SCREEN_VERT } from '@/shaders/common';
import { useEngineUniforms } from '@/engine/uniforms';
import type { SceneProps } from './types';

const fragmentShader = /* glsl */ `
${GLSL_PRELUDE}

varying vec3 vLocalPosition;

// Signed distance to the oil body — a slowly deforming droplet.
float body(vec3 p) {
  float wobble = fbm(p * 1.7 + vec3(0.0, uTime * 0.22, 0.0), 4) * (0.14 + uIsnaadA.y * 0.22);
  return length(p) - (0.95 + wobble);
}

void main() {
  // The back face of the containing shell is the ray's entry point; march it
  // back toward the observer so every step stays inside the volume.
  vec3 ro = vLocalPosition;
  vec3 rd = normalize(cameraPosition - vLocalPosition);

  float emitted = 0.0;
  vec3 tint = vec3(0.0);
  float t = 0.0;

  for (int i = 0; i < 42; i++) {
    vec3 p = ro + rd * t;
    float d = body(p);

    // Inside the fluid every sample emits: زيتها يضيء من داخله.
    if (d < 0.0) {
      float depth = clamp(-d * 1.6, 0.0, 1.0);
      float cell = fbm(p * 3.4 + vec3(uTime * 0.3), 4) * 0.5 + 0.5;
      float glow = pow(cell, 2.4) * (0.10 + uIsnaadA.y * 0.9 + uLevel * 0.6);
      emitted += glow * depth * 0.16;
      tint += mix(vec3(1.0, 0.78, 0.32), uAccent, 0.35) * glow * 0.16;
    }

    t += max(abs(d) * 0.6, 0.035);
    if (t > 3.2) break;
  }

  // No combustion term: brightness never depends on an external ignition.
  vec3 color = tint * 2.2 + vec3(0.02, 0.02, 0.05);
  color += uAccent * uClosure * 0.5;

  float alpha = clamp(emitted * 2.4, 0.0, 1.0);
  gl_FragColor = vec4(tonemap(color * uIntensity), alpha);
}
`;

export function ShajarahMubarakahScene({ accent }: SceneProps) {
  const uniforms = useEngineUniforms(accent);
  return (
    <mesh>
      <sphereGeometry args={[1.6, 64, 64]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={GLSL_SCREEN_VERT}
        fragmentShader={fragmentShader}
        transparent
        depthWrite={false}
        side={THREE.BackSide}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
}
