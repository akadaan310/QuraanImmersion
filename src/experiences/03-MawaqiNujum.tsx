/**
 * ٣ — مواقع النجوم
 * A stellar coordinate network: nodes hold fixed positions while the links
 * between them carry the recitation. Adjacency is computed once on the CPU at
 * mount; per frame only the transmitted energy changes.
 */

import { useMemo } from 'react';
import * as THREE from 'three';

import { GLSL_PRELUDE } from '@/shaders/common';
import { useEngineUniforms } from '@/engine/uniforms';
import type { SceneProps } from './types';

const NODES = 260;
const LINK_RADIUS = 0.72;
const MAX_LINKS_PER_NODE = 3;

const nodeVertex = /* glsl */ `
${GLSL_PRELUDE}

attribute float aSeed;
attribute float aMagnitude;

varying float vSeed;
varying float vMagnitude;

void main() {
  vSeed = aSeed;
  vMagnitude = aMagnitude;

  // Positions are fixed — مواقع. Only the apparent size responds.
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float twinkle = 0.6 + 0.4 * sin(uTime * (0.8 + aSeed * 2.4) + aSeed * 40.0);
  float drive = 0.35 + uIsnaadA.y * 1.5 + uTreble * 0.9 + uTransient * 1.2;
  gl_PointSize = (5.0 + aMagnitude * 26.0) * drive * twinkle * (1.0 / max(-mv.z, 0.1));
  gl_Position = projectionMatrix * mv;
}
`;

const nodeFragment = /* glsl */ `
${GLSL_PRELUDE}

varying float vSeed;
varying float vMagnitude;

void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d);
  if (r > 0.5) discard;

  float core = smoothstep(0.5, 0.0, r);
  float halo = pow(core, 3.0);
  // Four-point diffraction spike, the visual signature of a stellar coordinate.
  float spike = pow(max(0.0, 1.0 - abs(d.x) * 14.0), 3.0) + pow(max(0.0, 1.0 - abs(d.y) * 14.0), 3.0);

  vec3 tint = mix(uAccent, vec3(1.0, 0.94, 0.82), fract(vSeed * 7.3));
  vec3 color = tint * (halo * 2.2 + spike * 0.5 * vMagnitude);

  gl_FragColor = vec4(tonemap(color * uIntensity), clamp(halo + spike * 0.35, 0.0, 1.0));
}
`;

const linkVertex = /* glsl */ `
${GLSL_PRELUDE}

attribute float aT;
attribute float aSeed;
varying float vT;
varying float vSeed;

void main() {
  vT = aT;
  vSeed = aSeed;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const linkFragment = /* glsl */ `
${GLSL_PRELUDE}

varying float vT;
varying float vSeed;

void main() {
  // A packet crosses each link; link phase is decorrelated by its seed.
  float packet = fract(uTime * (0.18 + uIsnaadA.y * 0.5) + vSeed);
  float pulse = smoothstep(0.10, 0.0, abs(fract(vT - packet + 0.5) - 0.5));

  float base = 0.06 + uIsnaadA.y * 0.22;
  float alpha = (base + pulse * 0.75) * (0.2 + 0.8 * uIsnaadA.x);

  vec3 color = uAccent * (0.6 + pulse * 2.0);
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(tonemap(color * uIntensity), alpha);
}
`;

export function MawaqiNujumScene({ accent }: SceneProps) {
  const nodeUniforms = useEngineUniforms(accent);
  const linkUniforms = useEngineUniforms(accent);

  const { nodeGeometry, linkGeometry } = useMemo(() => {
    const points: THREE.Vector3[] = [];
    const magnitudes = new Float32Array(NODES);
    const seeds = new Float32Array(NODES);

    for (let i = 0; i < NODES; i += 1) {
      // A shell-biased distribution: the network is a sky, not a solid ball.
      const dir = new THREE.Vector3().randomDirection();
      points.push(dir.multiplyScalar(1.05 + Math.pow(Math.random(), 0.4) * 1.05));
      magnitudes[i] = Math.pow(Math.random(), 2.2);
      seeds[i] = Math.random();
    }

    const positions = new Float32Array(NODES * 3);
    points.forEach((point, i) => {
      positions[i * 3] = point.x;
      positions[i * 3 + 1] = point.y;
      positions[i * 3 + 2] = point.z;
    });

    const nodeGeo = new THREE.BufferGeometry();
    nodeGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    nodeGeo.setAttribute('aMagnitude', new THREE.BufferAttribute(magnitudes, 1));
    nodeGeo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));

    // Adjacency: nearest neighbours within a radius, capped so the graph stays legible.
    const linkPositions: number[] = [];
    const linkTs: number[] = [];
    const linkSeeds: number[] = [];

    for (let i = 0; i < NODES; i += 1) {
      let made = 0;
      for (let j = i + 1; j < NODES && made < MAX_LINKS_PER_NODE; j += 1) {
        if (points[i].distanceTo(points[j]) > LINK_RADIUS) continue;
        const seed = Math.random();
        const steps = 10;
        for (let s = 0; s < steps; s += 1) {
          const t0 = s / steps;
          const t1 = (s + 1) / steps;
          for (const t of [t0, t1]) {
            const p = points[i].clone().lerp(points[j], t);
            linkPositions.push(p.x, p.y, p.z);
            linkTs.push(t);
            linkSeeds.push(seed);
          }
        }
        made += 1;
      }
    }

    const linkGeo = new THREE.BufferGeometry();
    linkGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(linkPositions), 3));
    linkGeo.setAttribute('aT', new THREE.BufferAttribute(new Float32Array(linkTs), 1));
    linkGeo.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(linkSeeds), 1));

    return { nodeGeometry: nodeGeo, linkGeometry: linkGeo };
  }, []);

  return (
    <group>
      <lineSegments geometry={linkGeometry} frustumCulled={false}>
        <shaderMaterial
          uniforms={linkUniforms}
          vertexShader={linkVertex}
          fragmentShader={linkFragment}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </lineSegments>
      <points geometry={nodeGeometry} frustumCulled={false}>
        <shaderMaterial
          uniforms={nodeUniforms}
          vertexShader={nodeVertex}
          fragmentShader={nodeFragment}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
    </group>
  );
}
