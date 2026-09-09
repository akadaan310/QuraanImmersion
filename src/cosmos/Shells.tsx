/**
 * The infinite ladder.
 *
 * A journey across a sphere is finite: 6236 waypoints and the Earth is covered.
 * What makes the navigation endless is the climb — every `SHELL_PERIOD` legs the
 * structure travelled so far recedes and a wider one resolves around it.
 *
 * HOW IT IS INFINITE WITHOUT OVERFLOWING
 * --------------------------------------
 * The naive version multiplies a scale by a constant at each climb and dies:
 * after a few dozen shells the coordinates exceed what a 32-bit float can space
 * apart, vertices start landing on each other, and the whole scene shears. It
 * would take an hour of watching to hit, which is worse than hitting it
 * immediately, because it looks like a corruption rather than a limit.
 *
 * This is a TREADMILL. A fixed number of shells occupy a fixed band of radii.
 * The continuous climb `t` slides all of them inward together; when a shell
 * passes the inner edge it is reused at the outer edge with the next index. No
 * coordinate ever leaves the band, no float ever grows, and the ladder can be
 * climbed for as long as the phone stays awake. `LADDER_RATIO ** DEPTH` is the
 * span of radii on screen at any instant, and that is all the space that is ever
 * allocated.
 *
 * Each shell's index is real and keeps counting — it is what the readout shows —
 * even though its geometry is one of five reused rings.
 */

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import { audioEngine } from '@/audio/AudioEngine';
import { isnaadEngine } from '@/engine/isnaad/IsnaadEngine';

/** How many shells are resident at once. */
const DEPTH = 5;
/** Radius ratio between consecutive shells. */
const LADDER_RATIO = 2.35;
/** Radius of the innermost resident shell, in Earth radii. */
const INNER_RADIUS = 5.5;

const VERTEX = /* glsl */ `
  uniform float uScale;
  varying vec3 vNormal;
  varying vec3 vPosition;

  void main() {
    vNormal = normalize(normal);
    vPosition = position * uScale;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(vPosition, 1.0);
  }
`;

/**
 * The lattice is drawn from the barycentric-free trick of thresholding the
 * icosahedron's own normals against a set of planes, which gives a clean cell
 * boundary without needing a second attribute buffer per shell.
 */
const FRAGMENT = /* glsl */ `
  precision mediump float;

  uniform vec3  uAccent;
  uniform float uOpacity;
  uniform float uLevel;
  uniform float uClosure;
  uniform vec3  uIsnaadB;      // L4, L5, L6

  varying vec3 vNormal;
  varying vec3 vPosition;

  void main() {
    vec3 n = normalize(vNormal);

    // Cell edges: where the normal is equidistant from two lattice axes.
    vec3 a = abs(n);
    float highest = max(a.x, max(a.y, a.z));
    float second  = a.x + a.y + a.z - highest - min(a.x, min(a.y, a.z));
    float edge = 1.0 - smoothstep(0.0, 0.06, highest - second);

    // L6 — the closure sweeps outward through the ladder once per verse, which
    // is the only moment the outer shells are ever fully lit.
    float sweep = exp(-abs(length(vPosition) * 0.02 - uClosure * 3.2) * 2.4);

    float intensity = uOpacity * (0.16 + 0.5 * edge)
                    * (0.55 + 0.9 * uLevel + 1.4 * sweep * uClosure)
                    * (0.6 + 0.8 * uIsnaadB.z);

    gl_FragColor = vec4(uAccent * intensity, intensity);
  }
`;

interface ShellProps {
  accent: string;
  /** Continuous climb through the ladder, in shells. Only its fraction is used. */
  climb: number;
}

export function Shells({ accent, climb }: ShellProps) {
  const group = useRef<THREE.Group>(null);

  const shells = useMemo(
    () =>
      Array.from({ length: DEPTH }, () => ({
        uniforms: {
          uAccent: { value: new THREE.Color(accent) },
          uOpacity: { value: 0 },
          uScale: { value: 1 },
          uLevel: { value: 0 },
          uClosure: { value: 0 },
          uIsnaadB: { value: new THREE.Vector3() },
        },
      })),
    [accent],
  );

  useFrame(() => {
    const frame = audioEngine.frame;
    const isnaad = isnaadEngine.snapshot;
    // Only the fractional part matters: the integer part is the shell index,
    // which is a label, not a coordinate. This is the line that keeps the
    // ladder bounded.
    const phase = climb - Math.floor(climb);

    shells.forEach((shell, index) => {
      const rung = index - phase;
      const scale = INNER_RADIUS * LADDER_RATIO ** rung;
      shell.uniforms.uScale.value = scale;

      // Fade at both ends of the band so a shell neither pops into existence at
      // the horizon nor snaps out of it at the centre.
      const nearEdge = THREE.MathUtils.smoothstep(rung, -0.35, 0.45);
      const farEdge = 1 - THREE.MathUtils.smoothstep(rung, DEPTH - 1.6, DEPTH - 0.4);
      shell.uniforms.uOpacity.value = Math.max(0, nearEdge * farEdge);

      shell.uniforms.uLevel.value = frame.level;
      shell.uniforms.uClosure.value = isnaad.closure;
      (shell.uniforms.uIsnaadB.value as THREE.Vector3).set(isnaad.l4, isnaad.l5, isnaad.l6);
    });
  });

  return (
    <group ref={group}>
      {shells.map((shell, index) => (
        <mesh key={index} frustumCulled={false}>
          {/* Detail 2 is 320 faces: enough for the lattice to read as a
              structure, few enough that five of them cost nothing. */}
          <icosahedronGeometry args={[1, 2]} />
          <shaderMaterial
            vertexShader={VERTEX}
            fragmentShader={FRAGMENT}
            uniforms={shell.uniforms}
            transparent
            side={THREE.BackSide}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      ))}
    </group>
  );
}
