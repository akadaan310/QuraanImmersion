/**
 * ١٧ — ضيقاً حرجاً
 * Atmospheric compression. Ascent is the independent variable: the observer's
 * altitude drives a genuine camera FOV contraction while the surrounding shaft
 * narrows, so the constriction is felt in the projection matrix, not faked with
 * a vignette texture.
 */

import { useEffect, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import { GLSL_PRELUDE } from '@/shaders/common';
import { useEngineUniforms } from '@/engine/uniforms';
import { audioEngine } from '@/audio/AudioEngine';
import type { SceneProps } from './types';

const BASE_FOV = 55;
const MIN_FOV = 26;

const vertexShader = /* glsl */ `
${GLSL_PRELUDE}
uniform float uAltitude;

varying vec2 vUv;
varying float vSqueeze;

void main() {
  vUv = uv;
  vec3 p = position;

  // Altitude measured along the shaft; the bore closes as it rises.
  float h = (p.y + 3.0) / 6.0;
  float squeeze = clamp(uAltitude * h, 0.0, 1.0);
  vSqueeze = squeeze;

  float bore = 1.0 - squeeze * 0.72;
  p.xz *= bore;

  // The walls flutter under pressure — the air itself is labouring.
  p.xz *= 1.0 + snoise(vec3(p.xz * 2.0, uTime * 1.6)) * squeeze * 0.05;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
`;

const fragmentShader = /* glsl */ `
${GLSL_PRELUDE}
uniform float uAltitude;

varying vec2 vUv;
varying float vSqueeze;

void main() {
  // Pressure banding: rings crowd together as the column compresses.
  float rings = sin(vUv.y * (30.0 + vSqueeze * 90.0) - uTime * 0.9) * 0.5 + 0.5;
  float band = pow(rings, 3.0);

  vec3 open = vec3(0.05, 0.10, 0.16);
  vec3 crushed = vec3(0.16, 0.05, 0.06);
  vec3 color = mix(open, crushed, vSqueeze);
  color += mix(uAccent, vec3(1.0, 0.45, 0.35), vSqueeze) * band * (0.15 + uLevel * 0.8);

  // Breath cost: the field pulses harder the higher the observer has climbed.
  color *= 0.55 + 0.45 * sin(uTime * (1.2 + uAltitude * 4.0)) * vSqueeze + 0.45;

  float alpha = 0.20 + vSqueeze * 0.55 + band * 0.25;
  gl_FragColor = vec4(tonemap(color * uIntensity), clamp(alpha, 0.0, 1.0));
}
`;

export function DayyiqHarajScene({ accent }: SceneProps) {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const altitude = useRef(0);
  const uniforms = useEngineUniforms(accent, () => ({ uAltitude: { value: 0 } }));

  // Restore the shared camera when the observer leaves this phenomenon.
  useEffect(() => {
    const restore = camera.fov;
    return () => {
      camera.fov = restore;
      camera.updateProjectionMatrix();
    };
  }, [camera]);

  useFrame((_, delta) => {
    const frame = audioEngine.frame;

    // Altitude climbs while the recitation ascends and relaxes in silence.
    const climb = frame.playing ? frame.level * 0.55 + frame.highMid * 0.35 : -0.35;
    altitude.current = THREE.MathUtils.clamp(altitude.current + climb * delta * 0.7, 0, 1);

    uniforms.uAltitude.value = altitude.current;

    const target = THREE.MathUtils.lerp(BASE_FOV, MIN_FOV, altitude.current);
    if (Math.abs(camera.fov - target) > 0.01) {
      camera.fov = THREE.MathUtils.lerp(camera.fov, target, Math.min(delta * 2.5, 1));
      camera.updateProjectionMatrix();
    }
  });

  return (
    <mesh>
      <cylinderGeometry args={[1.5, 1.5, 6, 64, 60, true]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={vertexShader}
        fragmentShader={fragmentShader}
        transparent
        side={THREE.BackSide}
        depthWrite={false}
      />
    </mesh>
  );
}
