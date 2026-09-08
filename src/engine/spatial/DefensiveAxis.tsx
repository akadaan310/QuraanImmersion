/**
 * دار القرار — The Defensive Axis.
 *
 * A stabilising vector matrix seated inside the crystal. Counter-broadcasting
 * distortions (الشياطين / السامري) are modelled as intruder particles carrying
 * incoherent, non-harmonic motion; the axis measures their deviation from the
 * structural lattice and clamps them outward, holding the viewport in equilibrium.
 *
 * Both populations are one InstancedMesh: the shader decides per instance whether
 * a point is lattice or intruder, so the isolation loop costs no CPU per frame.
 */

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import { GLSL_ENGINE_UNIFORMS, GLSL_NOISE, GLSL_UTILS } from '@/shaders/common';
import { createEngineUniforms, syncEngineUniforms } from '@/engine/uniforms';

const LATTICE_POINTS = 420;
const INTRUDERS = 140;
const TOTAL = LATTICE_POINTS + INTRUDERS;

const vertexShader = /* glsl */ `
${GLSL_ENGINE_UNIFORMS}
${GLSL_UTILS}
${GLSL_NOISE}

attribute vec3 aAnchor;
attribute float aSeed;
attribute float aIntruder;

varying float vIntruder;
varying float vContained;
varying float vCharge;

void main() {
  vIntruder = aIntruder;

  // Lattice points hold station, breathing only with the command vector.
  vec3 lattice = aAnchor * (1.0 + uIsnaadA.x * 0.06 + uSubBass * 0.10);

  // Intruders broadcast incoherent drift sampled from an unrelated noise field.
  float t = uTime * (0.35 + aSeed * 0.5);
  vec3 chaos = vec3(
    snoise(aAnchor * 1.7 + vec3(t, 0.0, 0.0)),
    snoise(aAnchor * 1.7 + vec3(0.0, t, 11.0)),
    snoise(aAnchor * 1.7 + vec3(7.0, 0.0, t))
  );

  // Containment: the axis strength is the stabilised half of the Isnaad array —
  // command (L1) plus witnessed closure (L4·L6). Strong containment collapses the
  // intruder onto the shell and strips its amplitude.
  float axis = clamp(uIsnaadA.x * 0.6 + uIsnaadB.x * 0.25 + uIsnaadB.z * 0.35, 0.0, 1.0);
  vContained = axis;

  vec3 intruder = aAnchor + chaos * (0.9 - axis * 0.75);
  intruder = normalize(intruder + vec3(0.0001)) * mix(length(aAnchor), 2.75, axis * 0.7);

  vec3 world = mix(lattice, intruder, aIntruder);

  vCharge = aIntruder > 0.5
    ? (1.0 - axis) * (0.4 + uFlux * 0.8)
    : (0.25 + uIsnaadA.y * 0.9);

  float size = mix(0.020 + uIsnaadA.y * 0.012, 0.016 + (1.0 - axis) * 0.02, aIntruder);

  vec4 mv = modelViewMatrix * vec4(world, 1.0);
  mv.xyz += position * size;
  gl_Position = projectionMatrix * mv;
}
`;

const fragmentShader = /* glsl */ `
${GLSL_ENGINE_UNIFORMS}
${GLSL_UTILS}

varying float vIntruder;
varying float vContained;
varying float vCharge;

void main() {
  vec3 stable = uAccent;
  vec3 hostile = vec3(0.92, 0.24, 0.32);

  vec3 color = mix(stable, hostile, vIntruder);
  // A contained intruder is drained toward the stabilising accent.
  color = mix(color, stable * 0.5, vIntruder * vContained * 0.8);

  float alpha = clamp(vCharge * (vIntruder > 0.5 ? (1.0 - vContained * 0.65) : 1.0), 0.0, 1.0);
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(tonemap(color * (0.6 + vCharge * 1.6)), alpha);
}
`;

export function DefensiveAxis({ accent = '#22d3ee', radius = 2.4 }: { accent?: string; radius?: number }) {
  const material = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(() => createEngineUniforms(accent), [accent]);

  const geometry = useMemo(() => {
    const base = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.attributes.position = base.attributes.position;
    geo.attributes.uv = base.attributes.uv;
    geo.instanceCount = TOTAL;

    const anchors = new Float32Array(TOTAL * 3);
    const seeds = new Float32Array(TOTAL);
    const intruder = new Float32Array(TOTAL);

    for (let i = 0; i < TOTAL; i += 1) {
      const isIntruder = i >= LATTICE_POINTS;
      let point: THREE.Vector3;

      if (isIntruder) {
        // Intruders enter from the periphery of the containment volume.
        const dir = new THREE.Vector3().randomDirection();
        point = dir.multiplyScalar(radius * (0.55 + Math.random() * 0.45));
      } else {
        // The lattice is three orthogonal rings plus a stabilising shell cloud —
        // the structural frame the axis defends.
        const mode = i % 4;
        if (mode < 3) {
          const angle = (i / LATTICE_POINTS) * Math.PI * 2 * 7;
          const r = radius * (0.35 + ((i % 97) / 97) * 0.5);
          const a = Math.cos(angle) * r;
          const b = Math.sin(angle) * r;
          point = mode === 0 ? new THREE.Vector3(a, b, 0) : mode === 1 ? new THREE.Vector3(a, 0, b) : new THREE.Vector3(0, a, b);
        } else {
          point = new THREE.Vector3().randomDirection().multiplyScalar(radius * 0.9);
        }
      }

      anchors[i * 3] = point.x;
      anchors[i * 3 + 1] = point.y;
      anchors[i * 3 + 2] = point.z;
      seeds[i] = Math.random();
      intruder[i] = isIntruder ? 1 : 0;
    }

    geo.setAttribute('aAnchor', new THREE.InstancedBufferAttribute(anchors, 3));
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
    geo.setAttribute('aIntruder', new THREE.InstancedBufferAttribute(intruder, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), radius * 2);
    return geo;
  }, [radius]);

  useFrame(() => {
    if (material.current) syncEngineUniforms(material.current.uniforms);
  });

  return (
    <mesh geometry={geometry} frustumCulled={false} renderOrder={2}>
      <shaderMaterial
        ref={material}
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
}
