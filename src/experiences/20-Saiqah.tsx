/**
 * ٢٠ — الصاعقة
 * Acoustic shockwave disruption. On an audio peak the mesh topology fails: every
 * face separates along its own normal and tumbles. Faces are addressed
 * individually via a per-face centroid attribute baked at mount, so the collapse
 * is a real topological break rather than a displacement of a continuous surface.
 */

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import { GLSL_PRELUDE } from '@/shaders/common';
import { useEngineUniforms } from '@/engine/uniforms';
import { audioEngine } from '@/audio/AudioEngine';
import type { SceneProps } from './types';

const vertexShader = /* glsl */ `
${GLSL_PRELUDE}
uniform float uShock;

attribute vec3 aCentroid;
attribute float aSeed;

varying float vShatter;
varying vec3 vNormalW;
varying float vSeed;

void main() {
  vSeed = aSeed;
  float shatter = clamp(uShock * (0.5 + aSeed), 0.0, 1.6);
  vShatter = shatter;

  // Separate the face from the body: translate along its own outward normal and
  // rotate about its centroid, so adjacent faces tear apart rather than stretch.
  vec3 local = position - aCentroid;
  float spin = shatter * (1.4 + aSeed * 3.2);
  local.xy = rot2(spin) * local.xy;
  local.yz = rot2(spin * 0.7) * local.yz;

  vec3 blast = normalize(aCentroid + vec3(0.0001));
  vec3 world = aCentroid + local + blast * shatter * (0.7 + aSeed * 0.9);

  // Between strikes the surface reconverges — the topology heals.
  world += blast * uSubBass * 0.06;

  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
}
`;

const fragmentShader = /* glsl */ `
${GLSL_PRELUDE}
uniform float uShock;

varying float vShatter;
varying vec3 vNormalW;
varying float vSeed;

void main() {
  float lambert = clamp(dot(normalize(vNormalW), normalize(vec3(0.3, 0.8, 0.5))), 0.0, 1.0);

  vec3 intact = mix(vec3(0.05, 0.08, 0.14), uAccent * 0.6, lambert);
  // The fracture face is incandescent at the instant of separation.
  vec3 fracture = mix(vec3(1.0, 0.95, 0.85), uAccent, 0.35);

  vec3 color = mix(intact, fracture, clamp(vShatter * 1.4, 0.0, 1.0));
  color += uAccent * uShock * hash11(vSeed) * 0.8;

  gl_FragColor = vec4(tonemap(color * uIntensity), 1.0);
}
`;

export function SaiqahScene({ accent }: SceneProps) {
  const shock = useRef(0);
  const armed = useRef(true);
  const uniforms = useEngineUniforms(accent, () => ({ uShock: { value: 0 } }));

  const geometry = useMemo(() => {
    // Non-indexed: each face owns its three vertices, which is what allows the
    // faces to be pulled apart independently.
    const source = new THREE.IcosahedronGeometry(1.35, 4).toNonIndexed();
    const position = source.getAttribute('position') as THREE.BufferAttribute;
    const faces = position.count / 3;

    const centroids = new Float32Array(position.count * 3);
    const seeds = new Float32Array(position.count);

    for (let face = 0; face < faces; face += 1) {
      const i0 = face * 3;
      let cx = 0;
      let cy = 0;
      let cz = 0;
      for (let v = 0; v < 3; v += 1) {
        cx += position.getX(i0 + v);
        cy += position.getY(i0 + v);
        cz += position.getZ(i0 + v);
      }
      cx /= 3;
      cy /= 3;
      cz /= 3;
      const seed = Math.random();
      for (let v = 0; v < 3; v += 1) {
        centroids[(i0 + v) * 3] = cx;
        centroids[(i0 + v) * 3 + 1] = cy;
        centroids[(i0 + v) * 3 + 2] = cz;
        seeds[i0 + v] = seed;
      }
    }

    source.setAttribute('aCentroid', new THREE.BufferAttribute(centroids, 3));
    source.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    return source;
  }, []);

  useFrame((_, delta) => {
    const frame = audioEngine.frame;

    // Schmitt trigger: fire once per peak, re-arm only after the level falls back.
    const strike = frame.peak > 0.62 && frame.transient > 0.35;
    if (strike && armed.current) {
      shock.current = 1;
      armed.current = false;
    }
    if (frame.peak < 0.38) armed.current = true;

    shock.current = Math.max(0, shock.current - delta * 0.85);
    uniforms.uShock.value = shock.current;
  });

  return (
    <mesh geometry={geometry}>
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}
