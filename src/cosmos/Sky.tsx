/**
 * ٱلسَّمَآء — the sky the vehicle is under.
 *
 * The frame is Earth-fixed, so the sky is what moves. The entire celestial
 * sphere is one object rotated by −GMST about the polar axis: at that single
 * rotation every star in the catalogue is over the meridian it is actually over,
 * and the whole field turns once per sidereal day because that is how long it
 * takes.
 *
 * Three populations, kept honestly distinct:
 *
 *   1. `BRIGHT_STARS` — real stars, real J2000 coordinates, real magnitudes.
 *      Sized through the flux relation, coloured where the colour is famous.
 *   2. A procedural deep field — explicitly invented, and drawn dimmer than the
 *      faintest real star in the catalogue so it can never be mistaken for one.
 *      It exists to give the sky depth, and it says so here rather than
 *      pretending to be a survey.
 *   3. The Sun and the Moon, at their computed positions, the Moon carrying its
 *      real illuminated fraction.
 */

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import { audioEngine } from '@/audio/AudioEngine';
import {
  greenwichMeanSiderealTime, julianDay, moonPhase, moonPosition, sunPosition,
} from '@/astro/ephemeris';
import { BRIGHT_STARS, magnitudeFlux, starColour } from '@/astro/stars';
import { toVector } from '@/astro/geo';

/** Radius the celestial sphere is drawn at. Far outside every station. */
const SKY_RADIUS = 640;
const DEG = Math.PI / 180;

const STAR_VERTEX = /* glsl */ `
  attribute float aSize;
  attribute vec3  aColour;
  attribute float aPhase;

  uniform float uPixelRatio;
  uniform float uTreble;
  uniform float uLevel;

  varying vec3  vColour;
  varying float vIntensity;

  void main() {
    vColour = aColour;

    // Scintillation. Driven by the analyser's treble band rather than by a
    // clock: the sky answers the voice, like everything else in this engine.
    float twinkle = 0.82 + 0.18 * sin(aPhase * 12.9898 + uTreble * 26.0);
    vIntensity = twinkle * (0.72 + 0.42 * uLevel);

    vec4 view = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * view;
    gl_PointSize = clamp(aSize * uPixelRatio * twinkle, 1.0, 34.0);
  }
`;

const STAR_FRAGMENT = /* glsl */ `
  precision mediump float;
  varying vec3  vColour;
  varying float vIntensity;

  void main() {
    // A round, soft point. A square star is the giveaway of an untreated
    // gl_PointCoord, and at these sizes it is very visible.
    vec2 offset = gl_PointCoord - 0.5;
    float radius = length(offset);
    if (radius > 0.5) discard;

    float core = 1.0 - smoothstep(0.0, 0.5, radius);
    float halo = pow(core, 3.0);
    gl_FragColor = vec4(vColour * vIntensity * (halo * 0.85 + core * 0.35), core);
  }
`;

/**
 * A deterministic hash, so the invented deep field is the same sky on every
 * launch and on every device. A random field that reshuffles each reload makes
 * the universe feel like a screensaver.
 */
function hash(n: number): number {
  const x = Math.sin(n * 127.1) * 43758.5453;
  return x - Math.floor(x);
}

function StarField() {
  const points = useRef<THREE.Points>(null);

  const { geometry, uniforms } = useMemo(() => {
    const DEEP = 2600;
    const total = BRIGHT_STARS.length + DEEP;

    const positions = new Float32Array(total * 3);
    const colours = new Float32Array(total * 3);
    const sizes = new Float32Array(total);
    const phases = new Float32Array(total);
    const vector = new THREE.Vector3();

    BRIGHT_STARS.forEach((star, index) => {
      // Celestial frame: declination as latitude, right ascension as longitude.
      // The parent group's −GMST rotation is what carries it to Earth-fixed.
      toVector({ lat: star.dec, lon: star.ra }, SKY_RADIUS, vector);
      positions.set([vector.x, vector.y, vector.z], index * 3);
      colours.set(starColour(star), index * 3);
      // Fourth root of the flux: the eye's response is closer to this than to
      // either the flux itself (Sirius would swallow the screen) or the
      // magnitude (the field would be flat).
      sizes[index] = 2.6 + 13.0 * magnitudeFlux(star.mag) ** 0.25;
      phases[index] = index * 0.618;
    });

    for (let index = 0; index < DEEP; index += 1) {
      const at = BRIGHT_STARS.length + index;
      // Uniform on the sphere: z drawn uniformly, not the latitude, or the
      // invented field would band at the poles the way a naive one always does.
      const z = 1 - 2 * hash(index + 1);
      const radius = Math.sqrt(Math.max(0, 1 - z * z));
      const theta = hash(index + 9999) * Math.PI * 2;
      positions.set([
        SKY_RADIUS * radius * Math.cos(theta),
        SKY_RADIUS * z,
        SKY_RADIUS * radius * Math.sin(theta),
      ], at * 3);

      const tint = 0.72 + hash(index + 4242) * 0.28;
      colours.set([tint * 0.8, tint * 0.86, tint], at * 3);
      sizes[at] = 0.9 + hash(index + 777) * 1.5;   // dimmer than any catalogued star
      phases[at] = hash(index + 31) * 6.283;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aColour', new THREE.BufferAttribute(colours, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));

    return {
      geometry,
      uniforms: {
        uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
        uTreble: { value: 0 },
        uLevel: { value: 0 },
      },
    };
  }, []);

  useFrame(() => {
    const frame = audioEngine.frame;
    uniforms.uTreble.value = frame.treble;
    uniforms.uLevel.value = frame.level;
    if (points.current) {
      // The one rotation that carries the whole celestial sphere into the
      // Earth-fixed frame. Recomputed each frame because it is three
      // multiplications, and because a stale value would show as a sky that
      // stutters once a second.
      points.current.rotation.y = -greenwichMeanSiderealTime(julianDay()) * DEG;
    }
  });

  return (
    <points ref={points} geometry={geometry} frustumCulled={false}>
      <shaderMaterial
        vertexShader={STAR_VERTEX}
        fragmentShader={STAR_FRAGMENT}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

const MOON_FRAGMENT = /* glsl */ `
  precision mediump float;
  uniform vec3  uSun;
  uniform float uIllumination;
  varying vec3  vNormal;

  void main() {
    vec3 n = normalize(vNormal);
    float lit = smoothstep(-0.04, 0.06, dot(n, normalize(uSun)));
    // Earthshine: the unlit limb is not black, and it is brightest when the
    // crescent is thinnest, because that is when the Earth above it is full.
    float earthshine = 0.05 * (1.0 - uIllumination);
    vec3 surface = vec3(0.88, 0.87, 0.82);
    gl_FragColor = vec4(surface * (lit * 0.95 + earthshine), 1.0);
  }
`;

const BODY_VERTEX = /* glsl */ `
  varying vec3 vNormal;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/** ٱلشَّمْس وَٱلْقَمَر — both at their computed directions, updated twice a second. */
function Luminaries() {
  const sun = useRef<THREE.Mesh>(null);
  const moon = useRef<THREE.Mesh>(null);
  const glow = useRef<THREE.PointLight>(null);
  const next = useRef(0);

  const moonUniforms = useMemo(() => ({
    uSun: { value: new THREE.Vector3(1, 0, 0) },
    uIllumination: { value: 0.5 },
  }), []);

  useFrame(({ clock }) => {
    if (clock.elapsedTime < next.current) return;
    next.current = clock.elapsedTime + 0.5;

    const jd = julianDay();
    const gmst = greenwichMeanSiderealTime(jd);

    const sunAt = sunPosition(jd);
    const sunDirection = toVector({ lat: sunAt.dec, lon: sunAt.ra - gmst }, 1);
    if (sun.current) sun.current.position.copy(sunDirection).multiplyScalar(SKY_RADIUS * 0.92);
    if (glow.current) glow.current.position.copy(sunDirection).multiplyScalar(24);

    const moonAt = moonPosition(jd);
    const moonDirection = toVector({ lat: moonAt.dec, lon: moonAt.ra - gmst }, 1);
    if (moon.current) moon.current.position.copy(moonDirection).multiplyScalar(SKY_RADIUS * 0.55);

    // The Moon is lit by the real Sun direction, so the phase drawn is the phase
    // the geometry gives — never a value dialled in to look good.
    (moonUniforms.uSun.value as THREE.Vector3).copy(sunDirection);
    moonUniforms.uIllumination.value = moonPhase(jd).illumination;
  });

  return (
    <>
      <pointLight ref={glow} intensity={2.4} distance={200} decay={1.6} color="#fff2d8" />
      <mesh ref={sun}>
        {/* Angular size is about half a degree; at this radius that is ~2.8
            units. Drawn a little larger so the glare reads on a small screen. */}
        <sphereGeometry args={[5.2, 32, 24]} />
        <meshBasicMaterial color="#fff3d0" toneMapped={false} />
      </mesh>
      <mesh ref={moon}>
        <sphereGeometry args={[2.0, 48, 32]} />
        <shaderMaterial
          vertexShader={BODY_VERTEX}
          fragmentShader={MOON_FRAGMENT}
          uniforms={moonUniforms}
        />
      </mesh>
    </>
  );
}

export function Sky() {
  return (
    <>
      <StarField />
      <Luminaries />
    </>
  );
}
