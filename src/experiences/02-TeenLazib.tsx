/**
 * ٢ — طين لازب
 * A viscous clay matrix. Particle cohesion is weighted by L3 (the target subject
 * being materialised) against L5 (the unseen listener): high L3 draws the mass
 * together into sticky, resistant form, high L5 lets it disperse into suspension.
 */

import { useMemo } from 'react';
import * as THREE from 'three';

import { GLSL_PRELUDE } from '@/shaders/common';
import { useEngineUniforms } from '@/engine/uniforms';
import type { SceneProps } from './types';

const COUNT = 9000;

const vertexShader = /* glsl */ `
${GLSL_PRELUDE}

attribute vec3 aSeed;
attribute float aRank;

varying float vCohesion;
varying float vDepth;

void main() {
  // L3 is mass and stickiness; L5 pulls the same matter into suspension.
  float cohesion = clamp(uIsnaadA.z * 1.25 - uIsnaadB.y * 0.45 + 0.15, 0.0, 1.0);
  vCohesion = cohesion;

  float t = uTime * 0.28;
  vec3 p = aSeed;

  // Slow, high-viscosity churn: the field advects far slower than the audio.
  vec3 flow = vec3(
    fbm(p * 1.15 + vec3(t, 0.0, 0.0), 3),
    fbm(p * 1.15 + vec3(0.0, t * 0.8, 5.0), 3),
    fbm(p * 1.15 + vec3(9.0, 0.0, t * 0.9), 3)
  );

  // Settling: cohesive clay collapses toward a lens, loose clay stays a cloud.
  vec3 settled = vec3(p.x * 1.15, p.y * (0.32 - cohesion * 0.16), p.z * 1.15);
  vec3 suspended = p * 1.35 + flow * 0.75;

  vec3 pos = mix(suspended, settled, cohesion);
  pos += flow * (0.35 - cohesion * 0.26) * (0.4 + uLowMid * 1.2);

  // Sticky threads: the recitation drags strands upward out of the mass.
  float pull = uIsnaadA.y * uTransient * (1.0 - aRank);
  pos.y += pull * 0.9 * smoothstep(0.0, 0.6, cohesion);

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  vDepth = -mv.z;
  gl_PointSize = (14.0 + cohesion * 16.0) * (1.0 / max(vDepth, 0.1));
  gl_Position = projectionMatrix * mv;
}
`;

const fragmentShader = /* glsl */ `
${GLSL_PRELUDE}

varying float vCohesion;
varying float vDepth;

void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d);
  if (r > 0.5) discard;

  // A cohesive grain reads as a dense wet droplet, a loose one as dust.
  float body = smoothstep(0.5, 0.5 - (0.22 + vCohesion * 0.24), r);

  vec3 wet = vec3(0.42, 0.24, 0.11);
  vec3 dry = vec3(0.20, 0.17, 0.16);
  vec3 color = mix(dry, wet, vCohesion);
  color += uAccent * 0.30 * uIsnaadA.y;
  color *= 1.0 - clamp(vDepth * 0.06, 0.0, 0.55);

  gl_FragColor = vec4(tonemap(color * uIntensity), body * (0.25 + vCohesion * 0.7));
}
`;

export function TeenLazibScene({ accent }: SceneProps) {
  const uniforms = useEngineUniforms(accent);

  const geometry = useMemo(() => {
    const seeds = new Float32Array(COUNT * 3);
    const ranks = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i += 1) {
      const dir = new THREE.Vector3().randomDirection().multiplyScalar(Math.cbrt(Math.random()) * 1.35);
      seeds[i * 3] = dir.x;
      seeds[i * 3 + 1] = dir.y;
      seeds[i * 3 + 2] = dir.z;
      ranks[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(COUNT * 3), 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
    geo.setAttribute('aRank', new THREE.BufferAttribute(ranks, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 4);
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
      />
    </points>
  );
}
