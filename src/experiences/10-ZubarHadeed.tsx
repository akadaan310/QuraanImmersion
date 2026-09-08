/**
 * ١٠ — زُبَر الحديد والصدفين
 * Structural assembly between two cliff faces. Iron blocks fly in and seat
 * themselves course by course as the verse progresses; molten copper is then
 * poured into the remaining seams. Assembly order is deterministic per instance,
 * so the wall builds bottom-up rather than at random.
 */

import { useMemo } from 'react';
import * as THREE from 'three';

import { GLSL_PRELUDE } from '@/shaders/common';
import { useEngineUniforms } from '@/engine/uniforms';
import type { SceneProps } from './types';

const COLUMNS = 14;
const COURSES = 16;
const BLOCKS = COLUMNS * COURSES;

const vertexShader = /* glsl */ `
${GLSL_PRELUDE}

attribute vec3 aTarget;
attribute vec3 aOrigin;
attribute float aOrder;
attribute float aSeed;

varying float vSeated;
varying float vMolten;
varying vec3 vNormalW;

void main() {
  // Assembly front: driven by L3 with the verse's own progress underneath it.
  float front = clamp(uIsnaadA.z * 0.55 + uProgress * 0.65 + uLevel * 0.25, 0.0, 1.0);
  float seated = smoothstep(aOrder - 0.10, aOrder + 0.06, front);
  vSeated = seated;

  // Copper is poured only after the block above has seated.
  vMolten = smoothstep(aOrder + 0.02, aOrder + 0.22, front) * (0.4 + uBass * 1.1);

  vec3 flight = mix(aOrigin, aTarget, seated);
  // A block still in flight tumbles; a seated one is rigid.
  float tumble = (1.0 - seated) * (0.6 + aSeed);
  vec3 p = position;
  p.xy = rot2(uTime * tumble * 1.6 + aSeed * 6.0) * p.xy;
  p.yz = rot2(uTime * tumble * 1.1) * p.yz;

  vec3 world = flight + p * (0.22 + seated * 0.04);
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
}
`;

const fragmentShader = /* glsl */ `
${GLSL_PRELUDE}
varying float vSeated;
varying float vMolten;
varying vec3 vNormalW;

void main() {
  float lambert = clamp(dot(normalize(vNormalW), normalize(vec3(0.4, 0.8, 0.5))), 0.0, 1.0);

  vec3 iron = vec3(0.30, 0.32, 0.36) * (0.35 + lambert * 0.9);
  vec3 copper = mix(vec3(0.85, 0.35, 0.08), vec3(1.0, 0.72, 0.28), clamp(vMolten, 0.0, 1.0));

  vec3 color = mix(iron * 0.4, iron, vSeated);
  color += copper * vMolten * 0.9;
  color += uAccent * uTransient * vSeated * 0.4;

  gl_FragColor = vec4(tonemap(color * uIntensity), 0.35 + vSeated * 0.65);
}
`;

export function ZubarHadeedScene({ accent }: SceneProps) {
  const uniforms = useEngineUniforms(accent);

  const geometry = useMemo(() => {
    const base = new THREE.BoxGeometry(1, 0.62, 0.5);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.attributes.position = base.attributes.position;
    geo.attributes.normal = base.attributes.normal;
    geo.attributes.uv = base.attributes.uv;
    geo.instanceCount = BLOCKS;

    const targets = new Float32Array(BLOCKS * 3);
    const origins = new Float32Array(BLOCKS * 3);
    const orders = new Float32Array(BLOCKS);
    const seeds = new Float32Array(BLOCKS);

    let i = 0;
    for (let course = 0; course < COURSES; course += 1) {
      for (let column = 0; column < COLUMNS; column += 1) {
        // Running bond: alternate courses are offset by half a block.
        const offset = course % 2 === 0 ? 0 : 0.5;
        const x = (column - (COLUMNS - 1) / 2 + offset) * 0.245;
        const y = -1.1 + course * 0.145;

        targets[i * 3] = x;
        targets[i * 3 + 1] = y;
        targets[i * 3 + 2] = 0;

        const origin = new THREE.Vector3().randomDirection().multiplyScalar(3.4 + Math.random() * 1.6);
        origins[i * 3] = origin.x;
        origins[i * 3 + 1] = Math.abs(origin.y) + 1.2;
        origins[i * 3 + 2] = origin.z;

        // Bottom-up, with a slight per-column stagger so courses do not snap flat.
        orders[i] = (course + column / COLUMNS * 0.6) / (COURSES + 1);
        seeds[i] = Math.random();
        i += 1;
      }
    }

    geo.setAttribute('aTarget', new THREE.InstancedBufferAttribute(targets, 3));
    geo.setAttribute('aOrigin', new THREE.InstancedBufferAttribute(origins, 3));
    geo.setAttribute('aOrder', new THREE.InstancedBufferAttribute(orders, 1));
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 7);
    return geo;
  }, []);

  return (
    <group scale={1.35}>
      {/* الصدفان — the two cliff faces the wall is seated between. */}
      {[-1, 1].map((side) => (
        <mesh key={side} position={[side * 1.85, -0.35, 0]}>
          <boxGeometry args={[0.5, 2.6, 1.1]} />
          <meshBasicMaterial color="#161c27" />
        </mesh>
      ))}
      <mesh geometry={geometry} frustumCulled={false}>
        <shaderMaterial
          uniforms={uniforms}
          vertexShader={vertexShader}
          fragmentShader={fragmentShader}
          transparent
        />
      </mesh>
    </group>
  );
}
