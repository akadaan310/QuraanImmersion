/**
 * حبالهم — Star-Tree Ropes.
 *
 * Energetic tethers strung between sky coordinate nodes (مواقع النجوم, points on
 * the outer shell) and terrestrial network anchors (الشجر, points on the ground
 * disc). Each rope is a strip of vertices carrying its endpoints as attributes;
 * the VERTEX shader — not the CPU — resolves the curve every frame, so tension and
 * resonance can track the analyser at full frame rate for thousands of segments.
 */

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import { GLSL_ENGINE_UNIFORMS, GLSL_UTILS } from '@/shaders/common';
import { syncEngineUniforms, createEngineUniforms } from '@/engine/uniforms';

const ROPE_COUNT = 120;
const SEGMENTS = 42;

const vertexShader = /* glsl */ `
${GLSL_ENGINE_UNIFORMS}
${GLSL_UTILS}

attribute vec3 aSky;
attribute vec3 aRoot;
attribute float aT;
attribute float aSeed;

varying float vT;
varying float vSeed;
varying float vTension;

void main() {
  vT = aT;
  vSeed = aSeed;

  // Resonance: the rope is a standing wave whose amplitude is the vocal anchor
  // and whose harmonic count rises with spectral brightness (L2 → mode order).
  float harmonics = 2.0 + floor(uCentroid * 6.0 + uIsnaadA.y * 4.0);
  float drive = uIsnaadA.y * 0.9 + uLevel * 0.5 + uTransient * 0.6;
  float envelope = sin(aT * PI);

  vec3 base = mix(aRoot, aSky, aT);

  // Sag toward the ground when the command vector is idle: an untriggered rope
  // hangs slack, a triggered one pulls taut.
  float slack = (1.0 - uIsnaadA.x) * 0.9;
  base.y -= envelope * slack * 1.4;

  vec3 axis = normalize(aSky - aRoot);
  vec3 side = normalize(cross(axis, vec3(0.0, 1.0, 0.0)) + vec3(0.0001));
  vec3 up = normalize(cross(axis, side));

  float phase = uTime * (1.4 + aSeed * 1.6) + aSeed * TAU;
  float wave = sin(aT * PI * harmonics + phase);
  float twist = cos(aT * PI * (harmonics * 0.6) - phase * 0.7);

  float amplitude = envelope * drive * (0.18 + aSeed * 0.22);
  vec3 displaced = base + side * wave * amplitude + up * twist * amplitude * 0.7;

  // The unseen listener (L5) breathes the ropes outward from the world axis.
  displaced += normalize(vec3(displaced.x, 0.0, displaced.z) + vec3(0.0001))
             * uIsnaadB.y * envelope * 0.35;

  vTension = amplitude * 4.0 + uIsnaadA.x * 0.3;

  vec4 mvPosition = modelViewMatrix * vec4(displaced, 1.0);
  gl_Position = projectionMatrix * mvPosition;
}
`;

const fragmentShader = /* glsl */ `
${GLSL_ENGINE_UNIFORMS}
${GLSL_UTILS}

varying float vT;
varying float vSeed;
varying float vTension;

void main() {
  // Energy travels root → sky: a bright packet runs the rope on every transient.
  float packet = fract(vSeed + uTime * (0.25 + uIsnaadA.y * 0.6));
  float pulse = smoothstep(0.06, 0.0, abs(fract(vT - packet + 0.5) - 0.5));

  float ends = smoothstep(0.0, 0.16, vT) * smoothstep(1.0, 0.84, vT);
  float glow = ends * (0.14 + vTension * 0.5) + pulse * (0.5 + uTransient * 0.9);

  vec3 sky = uAccent;
  vec3 root = vec3(0.16, 0.42, 0.32);
  vec3 color = mix(root, sky, pow(vT, 0.7)) + pulse * 0.6;

  float alpha = clamp(glow * uIntensity, 0.0, 1.0) * (0.25 + 0.75 * uIsnaadA.x);
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(tonemap(color * (0.6 + vTension)), alpha);
}
`;

export function StarTreeRopes({ accent = '#22d3ee', radius = 2.9 }: { accent?: string; radius?: number }) {
  const material = useRef<THREE.ShaderMaterial>(null);

  const uniforms = useMemo(() => createEngineUniforms(accent), [accent]);

  const geometry = useMemo(() => {
    const positions = new Float32Array(ROPE_COUNT * SEGMENTS * 2 * 3);
    const sky = new Float32Array(ROPE_COUNT * SEGMENTS * 2 * 3);
    const root = new Float32Array(ROPE_COUNT * SEGMENTS * 2 * 3);
    const ts = new Float32Array(ROPE_COUNT * SEGMENTS * 2);
    const seeds = new Float32Array(ROPE_COUNT * SEGMENTS * 2);

    let vertex = 0;
    for (let rope = 0; rope < ROPE_COUNT; rope += 1) {
      // Sky node — a coordinate on the upper shell (موقع نجم).
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(THREE.MathUtils.lerp(0.15, 1, Math.random()));
      const skyPoint = new THREE.Vector3(
        radius * Math.sin(phi) * Math.cos(theta),
        radius * Math.cos(phi) * 0.85 + 0.35,
        radius * Math.sin(phi) * Math.sin(theta),
      );

      // Terrestrial anchor — a network node on the ground disc (شجرة).
      const groundAngle = theta + (Math.random() - 0.5) * 1.1;
      const groundRadius = radius * (0.25 + Math.random() * 0.7);
      const rootPoint = new THREE.Vector3(
        Math.cos(groundAngle) * groundRadius,
        -radius * 0.72,
        Math.sin(groundAngle) * groundRadius,
      );

      const seed = Math.random();

      for (let segment = 0; segment < SEGMENTS; segment += 1) {
        const t0 = segment / SEGMENTS;
        const t1 = (segment + 1) / SEGMENTS;
        for (const t of [t0, t1]) {
          const base = vertex * 3;
          positions[base] = 0;
          positions[base + 1] = 0;
          positions[base + 2] = 0;
          sky[base] = skyPoint.x;
          sky[base + 1] = skyPoint.y;
          sky[base + 2] = skyPoint.z;
          root[base] = rootPoint.x;
          root[base + 1] = rootPoint.y;
          root[base + 2] = rootPoint.z;
          ts[vertex] = t;
          seeds[vertex] = seed;
          vertex += 1;
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('aSky', new THREE.BufferAttribute(sky, 3));
    geo.setAttribute('aRoot', new THREE.BufferAttribute(root, 3));
    geo.setAttribute('aT', new THREE.BufferAttribute(ts, 1));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), radius * 2);
    return geo;
  }, [radius]);

  useFrame(() => {
    if (material.current) syncEngineUniforms(material.current.uniforms);
  });

  return (
    <lineSegments geometry={geometry} frustumCulled={false}>
      <shaderMaterial
        ref={material}
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </lineSegments>
  );
}
