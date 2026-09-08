/**
 * ١٨ — كِسَفاً من السماء
 * Orbital debris cascade. Each fragment integrates its own ballistic trajectory
 * in the vertex shader — launch velocity, constant downward acceleration, and an
 * impact reset — so the fall is a computed arc rather than a scrolling texture.
 */

import { useMemo } from 'react';
import * as THREE from 'three';

import { GLSL_PRELUDE } from '@/shaders/common';
import { useEngineUniforms } from '@/engine/uniforms';
import type { SceneProps } from './types';

const FRAGMENTS = 520;
const GROUND = -1.6;

const vertexShader = /* glsl */ `
${GLSL_PRELUDE}

attribute vec3 aLaunch;
attribute vec3 aVelocity;
attribute float aSeed;
attribute float aSpin;

varying float vImpact;
varying float vHeat;
varying vec3 vNormalW;

void main() {
  float gravity = 1.6 + uSubBass * 3.4 + uIsnaadA.z * 2.0;

  // Time of flight to the ground for this fragment's launch state, solving
  // y0 + v*t - g*t²/2 = GROUND, so each shard recycles on its own period.
  float disc = aVelocity.y * aVelocity.y + 2.0 * gravity * (aLaunch.y - ${GROUND.toFixed(2)});
  float flight = (aVelocity.y + sqrt(max(disc, 0.01))) / gravity;

  float t = mod(uTime * (0.35 + uIsnaadA.x * 0.55) + aSeed * flight, flight);

  vec3 pos = aLaunch + aVelocity * t;
  pos.y = aLaunch.y + aVelocity.y * t - 0.5 * gravity * t * t;

  // Impact flash in the last moments before the shard reaches the floor.
  vImpact = smoothstep(0.88, 1.0, t / flight);
  vHeat = clamp(t / flight, 0.0, 1.0);

  // Tumbling shard.
  vec3 p = position;
  p.xy = rot2(t * aSpin * 2.2 + aSeed * 6.0) * p.xy;
  p.yz = rot2(t * aSpin * 1.4) * p.yz;

  vec3 world = pos + p * (0.06 + aSeed * 0.10);
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
}
`;

const fragmentShader = /* glsl */ `
${GLSL_PRELUDE}
varying float vImpact;
varying float vHeat;
varying vec3 vNormalW;

void main() {
  float lambert = clamp(dot(normalize(vNormalW), normalize(vec3(0.2, 0.9, 0.35))), 0.0, 1.0);

  // Ablation: the shard heats as it descends through the field.
  vec3 cold = vec3(0.22, 0.24, 0.30);
  vec3 hot = mix(vec3(1.0, 0.42, 0.12), uAccent, 0.3);
  vec3 color = mix(cold, hot, pow(vHeat, 1.8)) * (0.30 + lambert * 1.1);
  color += vec3(1.0, 0.8, 0.55) * vImpact * 2.4;

  gl_FragColor = vec4(tonemap(color * uIntensity), 1.0);
}
`;

export function KisafSamaScene({ accent }: SceneProps) {
  const uniforms = useEngineUniforms(accent);

  const geometry = useMemo(() => {
    const base = new THREE.TetrahedronGeometry(1, 0);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.attributes.position = base.attributes.position;
    geo.attributes.normal = base.attributes.normal;
    geo.instanceCount = FRAGMENTS;

    const launches = new Float32Array(FRAGMENTS * 3);
    const velocities = new Float32Array(FRAGMENTS * 3);
    const seeds = new Float32Array(FRAGMENTS);
    const spins = new Float32Array(FRAGMENTS);

    for (let i = 0; i < FRAGMENTS; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const radius = Math.sqrt(Math.random()) * 2.3;
      launches[i * 3] = Math.cos(angle) * radius;
      launches[i * 3 + 1] = 1.9 + Math.random() * 1.4;
      launches[i * 3 + 2] = Math.sin(angle) * radius;

      // Fragments detach with lateral momentum from the shell they broke off.
      velocities[i * 3] = (Math.random() - 0.5) * 0.55;
      velocities[i * 3 + 1] = -0.15 - Math.random() * 0.35;
      velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.55;

      seeds[i] = Math.random();
      spins[i] = 0.5 + Math.random() * 2.4;
    }

    geo.setAttribute('aLaunch', new THREE.InstancedBufferAttribute(launches, 3));
    geo.setAttribute('aVelocity', new THREE.InstancedBufferAttribute(velocities, 3));
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
    geo.setAttribute('aSpin', new THREE.InstancedBufferAttribute(spins, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 8);
    return geo;
  }, []);

  return (
    <group>
      <mesh geometry={geometry} frustumCulled={false}>
        <shaderMaterial uniforms={uniforms} vertexShader={vertexShader} fragmentShader={fragmentShader} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, GROUND, 0]}>
        <circleGeometry args={[2.8, 64]} />
        <meshBasicMaterial color="#0a0e16" transparent opacity={0.7} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}
