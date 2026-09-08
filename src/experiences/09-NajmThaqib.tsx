/**
 * ٩ — النجم الثاقب
 * A pulsar. The high band is the drive: every treble transient fires a
 * directional beam that pierces the surrounding dark, and the beam's sweep rate
 * follows spectral brightness rather than wall-clock time.
 */

import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import { GLSL_PRELUDE } from '@/shaders/common';
import { useEngineUniforms } from '@/engine/uniforms';
import { audioEngine } from '@/audio/AudioEngine';
import type { SceneProps } from './types';

const beamVertex = /* glsl */ `
${GLSL_PRELUDE}
varying vec2 vUv;
varying vec3 vLocal;

void main() {
  vUv = uv;
  vLocal = position;

  vec3 p = position;
  // The cone lengthens on treble and thins as the pulse leaves the star.
  float reach = 0.6 + uTreble * 2.6 + uTransient * 1.8;
  p.y *= reach;
  p.xz *= 0.35 + uHighMid * 0.7;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const beamFragment = /* glsl */ `
${GLSL_PRELUDE}
varying vec2 vUv;
varying vec3 vLocal;

void main() {
  // Distance from the beam axis and along it.
  float axial = clamp(vUv.y, 0.0, 1.0);
  float radial = length(vLocal.xz) / 0.6;

  float taper = pow(1.0 - axial, 1.4);
  float core = exp(-radial * radial * 7.0);

  // Pulse packets travelling outward at the rate set by spectral centroid.
  float packet = fract(axial * 3.0 - uTime * (1.2 + uCentroid * 5.0));
  float ripple = smoothstep(0.75, 1.0, packet);

  float energy = core * taper * (0.25 + uTreble * 2.2 + uTransient * 2.6) + ripple * core * 0.6;

  vec3 color = mix(uAccent, vec3(1.0), 0.45) * energy;
  float alpha = clamp(energy * (0.3 + 0.7 * uIsnaadA.x), 0.0, 1.0);
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(tonemap(color * uIntensity), alpha);
}
`;

const starVertex = /* glsl */ `
${GLSL_PRELUDE}
varying vec3 vNormalW;
varying vec3 vViewW;

void main() {
  vec3 p = position * (1.0 + uTreble * 0.22 + uTransient * 0.35);
  vec4 world = modelMatrix * vec4(p, 1.0);
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vViewW = normalize(cameraPosition - world.xyz);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const starFragment = /* glsl */ `
${GLSL_PRELUDE}
varying vec3 vNormalW;
varying vec3 vViewW;

void main() {
  float rim = fresnel(vNormalW, vViewW, 1.6);
  float heat = 0.5 + uTreble * 2.6 + uTransient * 3.0;
  vec3 color = mix(uAccent, vec3(1.0, 0.98, 0.92), 0.6) * heat + rim * uAccent * 1.4;
  gl_FragColor = vec4(tonemap(color * uIntensity), 1.0);
}
`;

export function NajmThaqibScene({ accent }: SceneProps) {
  const beamUniforms = useEngineUniforms(accent);
  const starUniforms = useEngineUniforms(accent);
  const beams = useRef<THREE.Group>(null);

  useFrame((_, delta) => {
    if (!beams.current) return;
    // Sweep rate tracks brightness: a bright passage spins the lighthouse faster.
    const frame = audioEngine.frame;
    beams.current.rotation.y += delta * (0.35 + frame.centroid * 3.4);
    beams.current.rotation.z += delta * (0.12 + frame.treble * 0.9);
  });

  return (
    <group>
      <mesh>
        <icosahedronGeometry args={[0.34, 4]} />
        <shaderMaterial uniforms={starUniforms} vertexShader={starVertex} fragmentShader={starFragment} />
      </mesh>

      <group ref={beams}>
        {[0, 1].map((index) => (
          <mesh key={index} rotation={[index === 0 ? 0 : Math.PI, 0, 0]} position={[0, index === 0 ? 0.9 : -0.9, 0]}>
            <coneGeometry args={[0.6, 1.8, 40, 1, true]} />
            <shaderMaterial
              uniforms={beamUniforms}
              vertexShader={beamVertex}
              fragmentShader={beamFragment}
              transparent
              depthWrite={false}
              side={THREE.DoubleSide}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
        ))}
      </group>
    </group>
  );
}
