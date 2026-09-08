/**
 * ١٤ — سحاب ثقال
 * Heavy vapour. Droplets accumulate mass until the cloud can no longer carry it,
 * at which point the charge discharges as an arc. Mass is integrated on the CPU
 * across frames — the discharge is a consequence of accumulated history, not a
 * direct mapping of the current sample.
 */

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import { GLSL_PRELUDE } from '@/shaders/common';
import { useEngineUniforms } from '@/engine/uniforms';
import { audioEngine } from '@/audio/AudioEngine';
import type { SceneProps } from './types';

const DROPLETS = 14000;
const ARCS = 10;

const vertexShader = /* glsl */ `
${GLSL_PRELUDE}
uniform float uMass;

attribute vec3 aSeed;
attribute float aRank;

varying float vLoad;
varying float vHeight;

void main() {
  float t = uTime * 0.14;
  vec3 p = aSeed;

  vec3 churn = vec3(
    fbm(p * 1.4 + vec3(t, 0.0, 0.0), 3),
    fbm(p * 1.4 + vec3(0.0, t, 7.0), 3),
    fbm(p * 1.4 + vec3(3.0, 0.0, t), 3)
  );

  // Heavy cloud: mass compresses the column vertically and thickens the base.
  float load = clamp(uMass, 0.0, 1.0);
  vLoad = load;

  vec3 pos = vec3(p.x * 2.0, p.y * (0.85 - load * 0.35) - load * 0.30, p.z * 2.0);
  pos += churn * (0.45 + uMid * 0.35);

  vHeight = pos.y;

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = (16.0 + load * 22.0) * (1.0 / max(-mv.z, 0.1)) * (0.7 + aRank * 0.6);
  gl_Position = projectionMatrix * mv;
}
`;

const fragmentShader = /* glsl */ `
${GLSL_PRELUDE}
varying float vLoad;
varying float vHeight;

void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d);
  if (r > 0.5) discard;
  float puff = smoothstep(0.5, 0.0, r);

  // Loaded vapour darkens from below: the underside carries the water.
  float underside = smoothstep(0.4, -0.9, vHeight);
  vec3 light = vec3(0.62, 0.68, 0.78);
  vec3 heavy = vec3(0.10, 0.12, 0.18);
  vec3 color = mix(light, heavy, clamp(underside * (0.4 + vLoad), 0.0, 1.0));

  color += uAccent * uTransient * vLoad * 0.7;

  gl_FragColor = vec4(tonemap(color * uIntensity), puff * (0.05 + vLoad * 0.14));
}
`;

const arcVertex = /* glsl */ `
${GLSL_PRELUDE}
uniform float uDischarge;

attribute float aT;
attribute float aSeed;
varying float vT;
varying float vSeed;

void main() {
  vT = aT;
  vSeed = aSeed;

  vec3 p = position;
  // Branching jitter, frozen per discharge event so the bolt holds its shape.
  float event = floor(uTime * 0.5 + aSeed * 13.0);
  vec3 jitter = (hash33(vec3(aT * 40.0, aSeed * 17.0, event)) - 0.5);
  p.xz += jitter.xz * 0.34 * sin(aT * PI) * (0.4 + uDischarge);

  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const arcFragment = /* glsl */ `
${GLSL_PRELUDE}
uniform float uDischarge;

varying float vT;
varying float vSeed;

void main() {
  float head = smoothstep(uDischarge + 0.15, uDischarge - 0.05, vT);
  float alpha = head * uDischarge * (0.4 + hash11(vSeed) * 0.6);
  if (alpha < 0.01) discard;
  vec3 color = mix(uAccent, vec3(1.0), 0.7) * (1.0 + uDischarge * 3.0);
  gl_FragColor = vec4(tonemap(color), alpha);
}
`;

export function SahabThiqalScene({ accent }: SceneProps) {
  const mass = useRef(0);
  const discharge = useRef(0);

  const cloudUniforms = useEngineUniforms(accent, () => ({ uMass: { value: 0 } }));
  const arcUniforms = useEngineUniforms(accent, () => ({ uDischarge: { value: 0 } }));

  const cloudGeometry = useMemo(() => {
    const seeds = new Float32Array(DROPLETS * 3);
    const ranks = new Float32Array(DROPLETS);
    for (let i = 0; i < DROPLETS; i += 1) {
      seeds[i * 3] = (Math.random() - 0.5) * 2;
      seeds[i * 3 + 1] = (Math.random() - 0.5) * 2;
      seeds[i * 3 + 2] = (Math.random() - 0.5) * 2;
      ranks[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DROPLETS * 3), 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
    geo.setAttribute('aRank', new THREE.BufferAttribute(ranks, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 6);
    return geo;
  }, []);

  const arcGeometry = useMemo(() => {
    const positions: number[] = [];
    const ts: number[] = [];
    const seeds: number[] = [];
    for (let arc = 0; arc < ARCS; arc += 1) {
      const seed = Math.random();
      const x = (Math.random() - 0.5) * 2.6;
      const z = (Math.random() - 0.5) * 2.6;
      const steps = 22;
      for (let s = 0; s < steps; s += 1) {
        for (const t of [s / steps, (s + 1) / steps]) {
          positions.push(x, -0.35 - t * 2.0, z);
          ts.push(t);
          seeds.push(seed);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
    geo.setAttribute('aT', new THREE.BufferAttribute(new Float32Array(ts), 1));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(seeds), 1));
    return geo;
  }, []);

  useFrame((_, delta) => {
    const frame = audioEngine.frame;

    // Accumulate: the cloud gains water for as long as the recitation carries it.
    mass.current += frame.level * delta * 0.42;
    discharge.current = Math.max(0, discharge.current - delta * 1.9);

    // Threshold crossing — the load is released and the cloud starts over.
    if (mass.current > 1) {
      mass.current = 0.18;
      discharge.current = 1;
    }
    // Bleed off slowly during silence so a paused session does not stay loaded.
    if (!frame.playing) mass.current = Math.max(0, mass.current - delta * 0.12);

    cloudUniforms.uMass.value = Math.min(mass.current, 1);
    arcUniforms.uDischarge.value = discharge.current;
  });

  return (
    <group>
      <points geometry={cloudGeometry} frustumCulled={false}>
        <shaderMaterial
          uniforms={cloudUniforms}
          vertexShader={vertexShader}
          fragmentShader={fragmentShader}
          transparent
          depthWrite={false}
        />
      </points>
      <lineSegments geometry={arcGeometry} frustumCulled={false}>
        <shaderMaterial
          uniforms={arcUniforms}
          vertexShader={arcVertex}
          fragmentShader={arcFragment}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </lineSegments>
    </group>
  );
}
