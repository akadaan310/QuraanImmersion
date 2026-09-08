/**
 * ١٩ — حجراً محجوراً
 * An impermeable separation. Two incompatible particle populations are driven
 * toward each other; the barrier is enforced per particle in the vertex shader by
 * reflecting any position that would cross the plane, so no particle can ever be
 * on the wrong side — the separation is a hard invariant, not a soft force.
 */

import { useMemo } from 'react';
import * as THREE from 'three';

import { GLSL_PRELUDE } from '@/shaders/common';
import { useEngineUniforms } from '@/engine/uniforms';
import type { SceneProps } from './types';

const PER_ZONE = 3500;
const TOTAL = PER_ZONE * 2;

const vertexShader = /* glsl */ `
${GLSL_PRELUDE}

attribute vec3 aSeed;
attribute float aZone;   // -1 or +1
attribute float aRank;

varying float vZone;
varying float vPressed;

void main() {
  float t = uTime * 0.4;

  vec3 drift = vec3(
    snoise(aSeed * 1.6 + vec3(t, 0.0, 0.0)),
    snoise(aSeed * 1.6 + vec3(0.0, t, 5.0)),
    snoise(aSeed * 1.6 + vec3(9.0, 0.0, t))
  );

  vec3 pos = aSeed * 1.7 + drift * (0.28 + uMid * 0.5);

  // Each population is pushed toward the interface by the recitation.
  float push = (0.35 + uLevel * 1.2 + uIsnaadA.y * 0.8) * aRank;
  pos.x -= aZone * push * 0.8;

  // The barrier: an invariant, applied after every force has been summed.
  float gap = 0.05 + 0.10 * (1.0 - uIsnaadA.x);
  float wall = aZone * gap;
  if (aZone > 0.0) {
    pos.x = max(pos.x, wall);
  } else {
    pos.x = min(pos.x, wall);
  }

  // How hard this particle is pressed against the interface.
  vPressed = 1.0 - smoothstep(gap, gap + 0.55, abs(pos.x));
  vZone = aZone;

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = (7.0 + vPressed * 10.0) * (1.0 / max(-mv.z, 0.1));
  gl_Position = projectionMatrix * mv;
}
`;

const fragmentShader = /* glsl */ `
${GLSL_PRELUDE}
varying float vZone;
varying float vPressed;

void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d);
  if (r > 0.5) discard;
  float core = smoothstep(0.5, 0.1, r);

  vec3 left = mix(vec3(0.15, 0.35, 0.85), uAccent, 0.25);
  vec3 right = vec3(0.85, 0.30, 0.42);
  vec3 color = vZone > 0.0 ? right : left;

  // Rejection glow: contact with the barrier is refused, and the refusal shows.
  color += vec3(1.0) * vPressed * (0.4 + uTransient * 1.6) * 0.8;

  gl_FragColor = vec4(tonemap(color * (0.5 + vPressed * 1.6) * uIntensity), core * (0.3 + vPressed * 0.6));
}
`;

const barrierFragment = /* glsl */ `
${GLSL_PRELUDE}
varying vec2 vUv;

void main() {
  // The barrier is visible only as interference where it is being tested.
  vec2 p = vUv * 2.0 - 1.0;
  float mesh = max(
    abs(fract(vUv.x * 46.0) - 0.5),
    abs(fract(vUv.y * 46.0) - 0.5)
  );
  float lattice = smoothstep(0.42, 0.5, mesh);
  float falloff = 1.0 - smoothstep(0.4, 1.0, length(p));

  float charge = 0.10 + uIsnaadA.x * 0.5 + uTransient * 0.9;
  vec3 color = mix(uAccent, vec3(1.0), 0.3) * lattice * charge;

  float alpha = lattice * falloff * (0.12 + charge * 0.55);
  if (alpha < 0.005) discard;
  gl_FragColor = vec4(tonemap(color), alpha);
}
`;

const barrierVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export function HijrMahjoorScene({ accent }: SceneProps) {
  const particleUniforms = useEngineUniforms(accent);
  const barrierUniforms = useEngineUniforms(accent);

  const geometry = useMemo(() => {
    const seeds = new Float32Array(TOTAL * 3);
    const zones = new Float32Array(TOTAL);
    const ranks = new Float32Array(TOTAL);

    for (let i = 0; i < TOTAL; i += 1) {
      const zone = i < PER_ZONE ? -1 : 1;
      seeds[i * 3] = (Math.random() * 0.9 + 0.1) * zone;
      seeds[i * 3 + 1] = (Math.random() - 0.5) * 1.6;
      seeds[i * 3 + 2] = (Math.random() - 0.5) * 1.6;
      zones[i] = zone;
      ranks[i] = Math.random();
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TOTAL * 3), 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
    geo.setAttribute('aZone', new THREE.BufferAttribute(zones, 1));
    geo.setAttribute('aRank', new THREE.BufferAttribute(ranks, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 5);
    return geo;
  }, []);

  return (
    <group>
      <points geometry={geometry} frustumCulled={false}>
        <shaderMaterial
          uniforms={particleUniforms}
          vertexShader={vertexShader}
          fragmentShader={fragmentShader}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
      <mesh rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[3.4, 3.4]} />
        <shaderMaterial
          uniforms={barrierUniforms}
          vertexShader={barrierVertex}
          fragmentShader={barrierFragment}
          transparent
          depthWrite={false}
          side={THREE.DoubleSide}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
    </group>
  );
}
