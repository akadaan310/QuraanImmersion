/**
 * ١٦ — أوتاداً
 * Mountains as pegs. The visible relief above the datum is a fraction of the
 * root driven beneath it; each peg's root depth is proportional to its height,
 * and the anchoring is what damps the plate's oscillation — release the anchor
 * and the crust visibly rings.
 */

import { useMemo } from 'react';
import * as THREE from 'three';

import { GLSL_PRELUDE } from '@/shaders/common';
import { useEngineUniforms } from '@/engine/uniforms';
import type { SceneProps } from './types';

const PEGS = 34;

const pegVertex = /* glsl */ `
${GLSL_PRELUDE}

attribute vec3 aBase;
attribute float aHeight;
attribute float aSeed;

varying float vDepth;
varying float vAnchor;
varying vec3 vNormalW;

void main() {
  // Anchoring strength: L3 seats the pegs, and the crust rings without it.
  float anchor = clamp(uIsnaadA.z * 1.1 + uIsnaadA.x * 0.35, 0.0, 1.0);
  vAnchor = anchor;

  vec3 p = position;
  // The cone spans the full peg: +1 is the summit, -1 the root tip.
  float root = aHeight * 3.1;
  p.y = p.y > 0.0 ? p.y * aHeight : p.y * root;

  vec3 world = aBase + p;

  // Unanchored crust oscillates; anchored crust is quiet.
  float ring = (1.0 - anchor) * sin(uTime * 3.4 + aSeed * 9.0) * 0.10;
  world.y += ring * (1.0 - clamp(world.y, 0.0, 1.0));

  vDepth = world.y;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
}
`;

const pegFragment = /* glsl */ `
${GLSL_PRELUDE}
varying float vDepth;
varying float vAnchor;
varying vec3 vNormalW;

void main() {
  float lambert = clamp(dot(normalize(vNormalW), normalize(vec3(0.3, 0.9, 0.4))), 0.0, 1.0);

  // Above the datum: rock. Below it: the mantle-embedded root, seen in section.
  float subsurface = smoothstep(0.05, -0.4, vDepth);

  vec3 crust = vec3(0.26, 0.27, 0.30) * (0.35 + lambert * 0.95);
  vec3 rootColor = mix(vec3(0.30, 0.12, 0.05), uAccent * 0.7, vAnchor * 0.6);

  vec3 color = mix(crust, rootColor, subsurface);
  color += uAccent * vAnchor * subsurface * (0.15 + uSubBass * 0.9);

  float alpha = mix(1.0, 0.42 + vAnchor * 0.4, subsurface);
  gl_FragColor = vec4(tonemap(color * uIntensity), alpha);
}
`;

export function AwtadScene({ accent }: SceneProps) {
  const uniforms = useEngineUniforms(accent);

  const geometry = useMemo(() => {
    const base = new THREE.ConeGeometry(0.30, 2, 18, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.attributes.position = base.attributes.position;
    geo.attributes.normal = base.attributes.normal;
    geo.attributes.uv = base.attributes.uv;
    geo.instanceCount = PEGS;

    const bases = new Float32Array(PEGS * 3);
    const heights = new Float32Array(PEGS);
    const seeds = new Float32Array(PEGS);

    for (let i = 0; i < PEGS; i += 1) {
      // Poisson-ish scatter across the plate via a golden-angle spiral.
      const angle = i * 2.399963;
      const radius = Math.sqrt(i / PEGS) * 2.1;
      bases[i * 3] = Math.cos(angle) * radius;
      bases[i * 3 + 1] = 0;
      bases[i * 3 + 2] = Math.sin(angle) * radius;
      heights[i] = 0.28 + Math.random() * 0.55;
      seeds[i] = Math.random();
    }

    geo.setAttribute('aBase', new THREE.InstancedBufferAttribute(bases, 3));
    geo.setAttribute('aHeight', new THREE.InstancedBufferAttribute(heights, 1));
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 6);
    return geo;
  }, []);

  return (
    <group position={[0, -0.3, 0]}>
      {/* The datum plane — the crust the pegs are driven through. */}
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[2.6, 64]} />
        <meshBasicMaterial color="#0e131c" transparent opacity={0.55} side={THREE.DoubleSide} />
      </mesh>
      <mesh geometry={geometry} frustumCulled={false}>
        <shaderMaterial
          uniforms={uniforms}
          vertexShader={pegVertex}
          fragmentShader={pegFragment}
          transparent
          side={THREE.DoubleSide}
        />
      </mesh>
    </group>
  );
}
