/**
 * ٱلْأَرْض — السيارة.
 *
 * The vehicle, not the subject. The observer is aboard it for the whole journey;
 * it is never framed as an object being inspected from outside.
 *
 * EVERYTHING GEOMETRIC HERE IS REAL
 * ---------------------------------
 * The frame is Earth-fixed (ECEF): the globe and its graticule do not move, and
 * the Sun, the Moon and the stars move across it — which is what actually
 * happens, and it means a waypoint's coordinates stay put while its local time
 * of day changes as the journey holds there.
 *
 * The terminator is not a painted band. It is the great circle where the real
 * subsolar direction — computed from the machine's clock by `subsolarPoint` —
 * grazes the surface, and the twilight either side of it is the falloff of the
 * same dot product. Leave the app open at dawn and the line moves.
 *
 * NO FICTIONAL GEOGRAPHY
 * ----------------------
 * There are no continents. A procedural landmass would be an invented Earth
 * presented as the real one, in an application whose entire premise is that what
 * is shown is measured. What is drawn instead is what is actually known here:
 * the graticule, the terminator, the subsolar point, the track flown, and the
 * bearing to the Kaaba. Each of those is a fact.
 */

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import { syncEngineUniforms, createEngineUniforms } from '@/engine/uniforms';
import { julianDay, subsolarPoint } from '@/astro/ephemeris';
import { QIBLA, toVector } from '@/astro/geo';

export const EARTH_RADIUS = 1;

const VERTEX = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;

  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 world = modelViewMatrix * vec4(position, 1.0);
    vView = normalize(-world.xyz);
    gl_Position = projectionMatrix * world;
  }
`;

/**
 * The graticule is drawn from the surface normal rather than from a texture, so
 * it is exact at every zoom level: the line through 45°N is at 45°N to the
 * precision of the float, not to the resolution of an image. `fwidth` keeps it
 * one pixel wide however close the camera comes, which is the only way a
 * coordinate grid on a sphere stays legible on a phone.
 */
const FRAGMENT = /* glsl */ `
  precision highp float;

  uniform vec3  uSun;          // subsolar direction, Earth-fixed, unit
  uniform vec3  uQibla;        // direction of the Kaaba, Earth-fixed, unit
  uniform vec3  uAccent;
  uniform float uLevel;
  uniform float uSubBass;
  uniform float uCentroid;
  uniform float uClosure;
  uniform vec3  uIsnaadA;
  uniform vec3  uIsnaadB;

  varying vec3 vNormal;
  varying vec3 vView;

  const float PI = 3.14159265359;

  /** One antialiased line wherever 'value' crosses a multiple of 'spacing'. */
  float grid(float value, float spacing, float weight) {
    float scaled = value / spacing;
    float distance = abs(fract(scaled - 0.5) - 0.5) / fwidth(scaled);
    return 1.0 - smoothstep(0.0, weight, distance);
  }

  void main() {
    vec3 n = normalize(vNormal);

    float lat = asin(clamp(n.y, -1.0, 1.0)) * 180.0 / PI;
    float lon = atan(n.z, n.x) * 180.0 / PI;

    // --- daylight --------------------------------------------------------
    // The cosine of the solar zenith angle. Twilight is its falloff, widened a
    // little because the real atmosphere scatters light past the geometric
    // terminator — civil twilight reaches about 6° below the horizon.
    float sun = dot(n, uSun);
    float day = smoothstep(-0.105, 0.12, sun);
    float twilight = exp(-abs(sun) * 26.0);

    // --- graticule -------------------------------------------------------
    float parallels = grid(lat, 15.0, 1.1);
    float meridians = grid(lon, 15.0, 1.1);
    // The equator, the prime meridian and the two tropics carry more weight;
    // they are the lines an observer orients by.
    float equator = grid(lat, 180.0, 2.2);
    float prime   = grid(lon, 180.0, 2.2);
    float tropics = grid(abs(lat) - 23.43666, 1000.0, 2.0);

    float lattice = max(max(parallels, meridians) * 0.5, max(max(equator, prime), tropics * 0.8));

    // --- the two faces ---------------------------------------------------
    // The night side is not black: it carries the lattice at low level, so the
    // vehicle's shape stays readable while the traveller is over the dark half.
    vec3 nightColour = uAccent * (0.16 + 0.34 * uSubBass);
    vec3 dayColour   = mix(uAccent, vec3(0.86, 0.93, 1.0), 0.55 + 0.25 * uCentroid);

    vec3 colour = mix(nightColour * (0.10 + lattice * 0.55),
                      dayColour   * (0.14 + lattice * 0.80),
                      day);

    // Twilight ring, warm, sitting exactly on the terminator.
    colour += vec3(1.0, 0.56, 0.28) * twilight * (0.35 + 0.45 * uLevel);

    // --- the subsolar point ----------------------------------------------
    // A small disc where the Sun is precisely overhead — the one point of the
    // surface with zero solar zenith angle right now.
    float overhead = smoothstep(0.9985, 0.99985, sun);
    colour += vec3(1.0, 0.86, 0.62) * overhead * 1.4;

    // --- the qibla -------------------------------------------------------
    // ٱلْكَعْبَة marked where it stands, and the great circle of L6's closure
    // sweeping out from it once per verse.
    float toQibla = dot(n, uQibla);
    colour += uAccent * smoothstep(0.99965, 0.99997, toQibla) * 2.2;
    float ring = 1.0 - smoothstep(0.0, 0.06, abs(acos(clamp(toQibla, -1.0, 1.0)) - uClosure * PI));
    colour += uAccent * ring * uClosure * 0.7;

    // --- atmosphere ------------------------------------------------------
    // Fresnel rim. It brightens with L2 (the voice) and thins with L4 (the
    // witness drawing close), so the limb of the vehicle carries the two
    // vectors the observer is between.
    float fresnel = pow(1.0 - max(dot(n, normalize(vView)), 0.0), 3.0);
    vec3 atmosphere = mix(vec3(0.24, 0.52, 1.0), uAccent, 0.35);
    colour += atmosphere * fresnel * (0.55 + 0.9 * uIsnaadA.y - 0.25 * uIsnaadB.x)
              * (0.35 + 0.65 * day);

    gl_FragColor = vec4(colour, 1.0);
  }
`;

export function Earth({ accent }: { accent: string }) {
  const material = useRef<THREE.ShaderMaterial>(null);

  const uniforms = useMemo(
    () => createEngineUniforms(accent, {
      uSun: { value: new THREE.Vector3(1, 0, 0) },
      uQibla: { value: toVector(QIBLA) },
    }),
    [accent],
  );

  // The Sun moves about 0.004° per second across the surface. Recomputing the
  // ephemeris every frame would be sixty evaluations a second of a series whose
  // answer has not changed; twice a second is already finer than the pixel it
  // lands on.
  const nextEphemeris = useRef(0);

  useFrame(({ clock }) => {
    syncEngineUniforms(uniforms);
    if (clock.elapsedTime >= nextEphemeris.current) {
      nextEphemeris.current = clock.elapsedTime + 0.5;
      toVector(subsolarPoint(julianDay()), 1, uniforms.uSun.value as THREE.Vector3);
    }
  });

  return (
    <mesh>
      {/* 128 segments: the terminator is a smooth curve at this radius on a
          phone-sized viewport, and the graticule comes from the shader rather
          than from the tessellation, so more would buy nothing. */}
      <sphereGeometry args={[EARTH_RADIUS, 128, 96]} />
      <shaderMaterial
        ref={material}
        vertexShader={VERTEX}
        fragmentShader={FRAGMENT}
        uniforms={uniforms}
      />
    </mesh>
  );
}
