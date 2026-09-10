/**
 * The medium — what makes the flight legible.
 *
 * A star field cannot convey speed. Stars are effectively at infinity, so they
 * do not move relative to the observer no matter how fast the vehicle goes, and
 * a scene containing only stars and a distant globe is indistinguishable from a
 * scene that is standing still. That is precisely what the journey looked like
 * before this layer existed.
 *
 * Motion is only visible against something NEAR. So this is a field of motes at
 * the vehicle's own scale, streaming past it, each drawn as a segment stretched
 * along the velocity vector — short dots at rest, long streaks at speed. It is
 * the same reason a car at night feels fast because of the road surface and not
 * because of the horizon.
 *
 * THE WRAP IS ON THE GPU
 * ----------------------
 * Recycling motes as they fall behind is the obvious CPU loop and it is a
 * per-frame pass over thousands of vectors. Instead the motes sit at fixed
 * positions and the SHADER wraps them into a box centred on the camera:
 *
 *     rel = mod(p − cam + half, box) − half
 *
 * The field is therefore infinite, perfectly uniform, allocation-free, and costs
 * nothing on the CPU — the whole layer is four uniforms written per frame. The
 * motes are at fixed world positions, so flying back over the same region shows
 * the same motes, which is what makes the space feel like a place rather than a
 * screensaver.
 */

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import { audioEngine } from '@/audio/AudioEngine';
import { CRUISE_SPEED, flight } from '@/journey/flight';

/** Edge of the wrap box, in Earth radii. The motes live within ± half of this. */
const BOX = 9.0;
/** How many. Two vertices each; a line segment per mote. */
const MOTES = 3400;

const VERTEX = /* glsl */ `
  attribute float aEnd;      // 0 = head, 1 = tail
  attribute float aSeed;

  uniform vec3  uCam;
  uniform vec3  uVelocity;   // world units per second
  uniform float uSpeed;
  uniform float uBox;
  uniform float uStretch;
  uniform float uLevel;

  varying float vFade;
  varying float vEnd;

  void main() {
    vEnd = aEnd;

    // Wrap the mote into the box centred on the camera. 'mod' on a negative
    // value returns a positive result in GLSL, so this needs no sign handling.
    vec3 rel = mod(position - uCam + uBox * 0.5, uBox) - uBox * 0.5;
    vec3 world = uCam + rel;

    // The tail trails BEHIND along the velocity, so the streak points the way
    // the vehicle came from — which is what a motion streak actually is.
    world -= uVelocity * aEnd * uStretch;

    float distance = length(rel);

    // Fade at the box edge, or motes would pop into existence on a hard plane.
    float edge = 1.0 - smoothstep(uBox * 0.30, uBox * 0.48, distance);
    // And fade very close in, where a mote would otherwise fill the screen and
    // read as a flaw rather than as dust.
    float near = smoothstep(0.04, 0.35, distance);

    // The medium answers the recitation like everything else in the engine.
    vFade = edge * near * (0.35 + 0.65 * uLevel) * (0.55 + 0.45 * aSeed);

    gl_Position = projectionMatrix * modelViewMatrix * vec4(world, 1.0);
  }
`;

const FRAGMENT = /* glsl */ `
  precision mediump float;
  uniform vec3  uAccent;
  uniform float uSpeed;
  varying float vFade;
  varying float vEnd;

  void main() {
    // The head of a streak is bright and the tail falls away, so the segment
    // reads as directional rather than as a floating stick.
    float taper = 1.0 - vEnd;
    // At speed the medium takes the accent of the phenomenon being flown
    // toward; at rest it is nearly neutral.
    vec3 tint = mix(vec3(0.72, 0.80, 0.95), uAccent, clamp(uSpeed * 0.5, 0.0, 0.8));
    float alpha = vFade * (0.18 + 0.82 * taper);
    if (alpha < 0.004) discard;
    gl_FragColor = vec4(tint * (0.5 + 0.9 * taper), alpha);
  }
`;

export function Dust({ accent }: { accent: string }) {
  const lines = useRef<THREE.LineSegments>(null);

  const { geometry, uniforms } = useMemo(() => {
    const positions = new Float32Array(MOTES * 2 * 3);
    const ends = new Float32Array(MOTES * 2);
    const seeds = new Float32Array(MOTES * 2);

    // A deterministic hash rather than Math.random: the medium is then the same
    // on every launch and on every device, so a region of space looks like
    // itself when the journey returns to it.
    const hash = (n: number) => {
      const x = Math.sin(n * 78.233) * 43758.5453;
      return x - Math.floor(x);
    };

    for (let index = 0; index < MOTES; index += 1) {
      const x = (hash(index + 1) - 0.5) * BOX;
      const y = (hash(index + 977) - 0.5) * BOX;
      const z = (hash(index + 4231) - 0.5) * BOX;
      const seed = hash(index + 15013);

      positions.set([x, y, z, x, y, z], index * 6);
      ends.set([0, 1], index * 2);
      seeds.set([seed, seed], index * 2);
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aEnd', new THREE.BufferAttribute(ends, 1));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));

    return {
      geometry,
      uniforms: {
        uCam: { value: new THREE.Vector3() },
        uVelocity: { value: new THREE.Vector3() },
        uSpeed: { value: 0 },
        uBox: { value: BOX },
        uStretch: { value: 0 },
        uLevel: { value: 0 },
        uAccent: { value: new THREE.Color(accent) },
      },
    };
  }, [accent]);

  useFrame(() => {
    (uniforms.uCam.value as THREE.Vector3).copy(flight.position);
    (uniforms.uVelocity.value as THREE.Vector3).copy(flight.velocity);

    const ratio = flight.smoothSpeed / CRUISE_SPEED;
    uniforms.uSpeed.value = ratio;
    uniforms.uLevel.value = audioEngine.frame.level;

    // Streak length in SECONDS of travel. A fixed length in world units would
    // be invisible at low speed and would run off the screen at high speed;
    // expressing it as time means the streak is always about the same fraction
    // of the frame, which is what actually reads as speed.
    uniforms.uStretch.value = THREE.MathUtils.clamp(0.012 + ratio * 0.055, 0, 0.12);
  });

  return (
    <lineSegments ref={lines} geometry={geometry} frustumCulled={false}>
      <shaderMaterial
        vertexShader={VERTEX}
        fragmentShader={FRAGMENT}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </lineSegments>
  );
}
