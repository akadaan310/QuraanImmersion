/**
 * ٧ — الحديد فيه بأس شديد
 * Metallic particles snap onto the field lines of a dipole. The clustering force
 * is L3 (materialisation) — under a strong target vector the iron is extracted
 * from suspension and locked to the core; released, it drifts back to dust.
 */

import { useMemo } from 'react';
import * as THREE from 'three';

import { GLSL_PRELUDE } from '@/shaders/common';
import { useEngineUniforms } from '@/engine/uniforms';
import type { SceneProps } from './types';

const COUNT = 12000;

const vertexShader = /* glsl */ `
${GLSL_PRELUDE}

attribute vec3 aSeed;
attribute float aShell;
attribute float aPhase;

varying float vLocked;
varying float vSpeed;

// Dipole field line: parameterised by shell L and polar angle.
vec3 fieldLine(float shell, float theta, float phi) {
  float r = shell * sin(theta) * sin(theta);
  return vec3(
    r * sin(theta) * cos(phi),
    r * cos(theta),
    r * sin(theta) * sin(phi)
  );
}

void main() {
  float grip = clamp(uIsnaadA.z * 1.15 + uBass * 0.4, 0.0, 1.0);
  vLocked = grip;

  float theta = 0.12 + aSeed.x * (PI - 0.24);
  float phi = aSeed.y * TAU;

  // Locked particles travel ALONG the line; loose ones tumble in free space.
  float travel = uTime * (0.25 + uIsnaadA.y * 0.9) + aPhase;
  float along = fract(travel * 0.12 + aSeed.z);
  float lineTheta = mix(theta, 0.12 + along * (PI - 0.24), grip);

  vec3 onLine = fieldLine(aShell, lineTheta, phi);
  vec3 loose = aSeed * 2.4 - vec3(1.2) + vec3(
    snoise(aSeed * 2.0 + vec3(uTime * 0.2, 0.0, 0.0)),
    snoise(aSeed * 2.0 + vec3(0.0, uTime * 0.2, 4.0)),
    snoise(aSeed * 2.0 + vec3(3.0, 0.0, uTime * 0.2))
  ) * 0.5;

  vec3 pos = mix(loose, onLine, grip);

  // A sharp transient hammers the assembly inward — بأس شديد.
  pos *= 1.0 - uTransient * 0.16 * grip;

  vSpeed = grip * (0.3 + uIsnaadA.y);

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = (3.5 + grip * 6.0) * (1.0 / max(-mv.z, 0.1)) * 2.4;
  gl_Position = projectionMatrix * mv;
}
`;

const fragmentShader = /* glsl */ `
${GLSL_PRELUDE}
varying float vLocked;
varying float vSpeed;

void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d);
  if (r > 0.5) discard;

  float core = smoothstep(0.5, 0.05, r);

  // Cold grey filings; the accent only appears where the field has taken hold.
  vec3 iron = vec3(0.52, 0.55, 0.60);
  vec3 charged = mix(iron, uAccent, vLocked * 0.75);
  vec3 color = charged * (0.35 + vSpeed * 1.9 + uTransient * vLocked * 1.6);

  gl_FragColor = vec4(tonemap(color * uIntensity), core * (0.18 + vLocked * 0.72));
}
`;

export function HadeedBasScene({ accent }: SceneProps) {
  const uniforms = useEngineUniforms(accent);

  const geometry = useMemo(() => {
    const seeds = new Float32Array(COUNT * 3);
    const shells = new Float32Array(COUNT);
    const phases = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i += 1) {
      seeds[i * 3] = Math.random();
      seeds[i * 3 + 1] = Math.random();
      seeds[i * 3 + 2] = Math.random();
      shells[i] = 0.7 + Math.random() * 1.6;
      phases[i] = Math.random() * 100;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(COUNT * 3), 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
    geo.setAttribute('aShell', new THREE.BufferAttribute(shells, 1));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 5);
    return geo;
  }, []);

  return (
    <points geometry={geometry} frustumCulled={false}>
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}
