/**
 * The rig — where the observer actually is, every frame.
 *
 * Nothing here is driven by input. The camera's position is a function of the
 * navigator's leg, the waypoint being flown to, and the orientation the observer
 * has adopted; that is the entire authority over the view.
 *
 * THE LOCAL FRAME
 * ---------------
 * Every station builds an east–north–up basis from its own position on the
 * globe. An orientation is then expressed in that basis — an elevation above
 * the local horizon and a distance in station radii — rather than in world
 * coordinates. This is why the same orientation means the same thing at a
 * waypoint in the Pacific as at one over the pole: "from the earth, looking
 * along the horizon" is a local statement and has to be built locally.
 *
 * WHY THE CAMERA IS NEVER SNAPPED
 * -------------------------------
 * Position, target and field of view are all approached exponentially rather
 * than assigned. Assignment is correct and looks broken: adopting an orientation
 * would cut to the new standpoint, and a cut in a continuous flight reads as a
 * dropped frame, not as a movement. The rate is frame-rate corrected, so the
 * approach takes the same wall time at 60 Hz and at 120 Hz.
 */

import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import { EARTH_RADIUS } from '@/cosmos/Earth';
import { interpolate, toVector } from '@/astro/geo';
import { ORIENTATIONS, type OrientationId } from './orientations';
import { TRANSIT_FRACTION, type NavState } from './AutoNavigator';
import type { Waypoint } from './waypoints';

const DEG = Math.PI / 180;

/**
 * Radius the phenomenon scene occupies at a station, in Earth radii.
 *
 * Chosen against the orientation markers, not by eye: the markers ring the
 * station just outside its silhouette, and if the station is large relative to
 * the camera's distance from it that ring projects outside the viewport. At
 * 0.22 the scene reads clearly against the globe AND every marker stays on
 * screen at the closest standpoint the rig will adopt. The markers are the only
 * controls the application has, so they win the trade.
 */
export const STATION_SCALE = 0.22;
/** The scenes are authored around a core of this radius. */
const SCENE_CORE = 3.2;

/** World position of a station: its coordinate, lifted to its own altitude. */
export function stationPosition(waypoint: Waypoint, target = new THREE.Vector3()): THREE.Vector3 {
  return toVector(waypoint.at, EARTH_RADIUS + waypoint.altitude, target);
}

/**
 * East–north–up at a point on the globe.
 *
 * The degenerate case is a station directly over a pole, where "east" is
 * undefined. It is nudged to the prime meridian rather than left to produce a
 * zero-length cross product, which would collapse the basis and send the camera
 * to NaN for the rest of the session.
 */
function localFrame(position: THREE.Vector3, up: THREE.Vector3, east: THREE.Vector3, north: THREE.Vector3): void {
  up.copy(position).normalize();
  east.set(0, 1, 0).cross(up);
  if (east.lengthSq() < 1e-8) east.set(1, 0, 0);
  east.normalize();
  north.copy(up).cross(east).normalize();
}

export interface RigProps {
  nav: NavState;
  waypoint: Waypoint;
  previous: Waypoint;
  orientation: OrientationId | null;
  /**
   * Hand the field of view to the station's own scene.
   *
   * ضيقاً حرجاً drives the camera's FOV itself — the contraction of the view IS
   * the phenomenon, not a decoration on top of it. If the rig also wrote the FOV
   * the two would fight every frame and the result would be a visible flutter.
   * So while such a scene stands, the rig stops writing it.
   */
  cedeFov?: boolean;
  /** Receives the station's world position each frame, for L4 and the scene mount. */
  onStation?: (position: THREE.Vector3) => void;
}

export function JourneyRig({ nav, waypoint, previous, orientation, cedeFov, onStation }: RigProps) {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;

  const scratch = useMemo(() => ({
    station: new THREE.Vector3(),
    travelling: new THREE.Vector3(),
    ahead: new THREE.Vector3(),
    up: new THREE.Vector3(),
    east: new THREE.Vector3(),
    north: new THREE.Vector3(),
    desired: new THREE.Vector3(),
    look: new THREE.Vector3(),
    offset: new THREE.Vector3(),
  }), []);

  const smoothed = useRef({ look: new THREE.Vector3(0, 0, 0), fov: 55, roll: 0, started: false });

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.1);
    const s = scratch;

    stationPosition(waypoint, s.station);
    onStation?.(s.station);

    const transit = Math.min(1, nav.leg / TRANSIT_FRACTION);
    const arrived = nav.leg >= TRANSIT_FRACTION;

    if (!arrived) {
      // --- in flight: on the great circle, at the navigator's arc altitude ---
      const here = interpolate(previous.at, waypoint.at, transit);
      // A point slightly further along the same arc gives the tangent without
      // differentiating anything — and it is the point the camera looks at, so
      // the view is along the track rather than at the ground under it.
      const soon = interpolate(previous.at, waypoint.at, Math.min(1, transit + 0.035));

      toVector(here, EARTH_RADIUS + nav.altitude * 0.55 + 0.22, s.travelling);
      toVector(soon, EARTH_RADIUS + nav.altitude * 0.55 + 0.22, s.ahead);

      s.desired.copy(s.travelling);
      // Look ahead early in the leg, and swing toward the station as it nears,
      // so arrival is a turn onto the target rather than a cut.
      s.look.copy(s.ahead).lerp(s.station, THREE.MathUtils.smoothstep(transit, 0.55, 1));
    } else {
      // --- on station: the orientation decides where the observer stands -----
      const spec = orientation ? ORIENTATIONS[orientation] : null;
      const distance = (spec?.distance ?? 1.35) * SCENE_CORE * STATION_SCALE + 0.55;
      const elevation = (spec?.elevation ?? 8) * DEG;

      localFrame(s.station, s.up, s.east, s.north);

      // Approach bearing: the direction the traveller arrived from. Standing
      // opposite it means the station is met head-on rather than from behind.
      const from = toVector(previous.at, 1, s.offset).sub(s.station.clone().normalize()).normalize();
      const along = s.east.clone().multiplyScalar(from.dot(s.east))
        .add(s.north.clone().multiplyScalar(from.dot(s.north)));
      if (along.lengthSq() < 1e-8) along.copy(s.east);
      along.normalize();

      s.desired.copy(s.station)
        .addScaledVector(s.up, Math.sin(elevation) * distance)
        .addScaledVector(along, Math.cos(elevation) * distance);

      s.look.copy(s.station);
    }

    // --- approach, never assign ---------------------------------------------
    // 1 − e^(−k·dt) is the frame-rate-correct form of an exponential approach.
    // A bare `lerp(x, 0.1)` moves twice as fast at 120 Hz as at 60.
    const rate = 1 - Math.exp(-(arrived ? 2.4 : 3.6) * dt);
    if (!smoothed.current.started) {
      camera.position.copy(s.desired);
      smoothed.current.look.copy(s.look);
      smoothed.current.started = true;
    } else {
      camera.position.lerp(s.desired, rate);
      smoothed.current.look.lerp(s.look, rate);
    }

    const spec = orientation ? ORIENTATIONS[orientation] : null;
    const targetFov = spec?.fov ?? 58;
    const targetRoll = (spec?.roll ?? 0) * DEG + nav.bank;

    smoothed.current.fov += (targetFov - smoothed.current.fov) * rate;
    smoothed.current.roll += (targetRoll - smoothed.current.roll) * rate;

    // Track the camera's own value while ceding, so that when the scene hands
    // the FOV back the rig resumes from where the scene left it rather than
    // snapping to the value it would have reached on its own.
    if (cedeFov) smoothed.current.fov = camera.fov;
    else if (Math.abs(camera.fov - smoothed.current.fov) > 0.01) {
      camera.fov = smoothed.current.fov;
      camera.updateProjectionMatrix();
    }

    // Up-vector: the local vertical, rolled. Using world-up instead would make
    // the horizon tumble whenever the journey crosses a pole.
    localFrame(camera.position, s.up, s.east, s.north);
    camera.up.copy(s.up).applyAxisAngle(
      s.look.clone().sub(camera.position).normalize(),
      smoothed.current.roll,
    );
    camera.lookAt(smoothed.current.look);
  });

  return null;
}

/**
 * The track — the great circle actually flown, drawn behind and ahead.
 *
 * The flown portion is bright and the portion still to come is faint, so the
 * line reads as a direction of travel rather than as a static arc.
 */
export function Track({ from, to, progress, accent }: {
  from: Waypoint; to: Waypoint; progress: number; accent: string;
}) {
  const geometry = useMemo(() => {
    const SEGMENTS = 96;
    const positions = new Float32Array((SEGMENTS + 1) * 3);
    const fractions = new Float32Array(SEGMENTS + 1);
    const point = new THREE.Vector3();

    for (let index = 0; index <= SEGMENTS; index += 1) {
      const t = index / SEGMENTS;
      // The track is drawn just off the surface, following the arc the vehicle
      // flies rather than lying flat on the globe.
      const lift = Math.sin(Math.PI * t) * 0.06;
      toVector(interpolate(from.at, to.at, t), EARTH_RADIUS + 0.004 + lift, point);
      positions.set([point.x, point.y, point.z], index * 3);
      fractions[index] = t;
    }

    const buffer = new THREE.BufferGeometry();
    buffer.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    buffer.setAttribute('aFraction', new THREE.BufferAttribute(fractions, 1));
    return buffer;
  }, [from, to]);

  const uniforms = useMemo(() => ({
    uAccent: { value: new THREE.Color(accent) },
    uProgress: { value: 0 },
  }), [accent]);

  useFrame(() => { uniforms.uProgress.value = progress; });

  return (
    <line>
      <primitive object={geometry} attach="geometry" />
      <shaderMaterial
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        vertexShader={/* glsl */ `
          attribute float aFraction;
          varying float vFraction;
          void main() {
            vFraction = aFraction;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `}
        fragmentShader={/* glsl */ `
          precision mediump float;
          uniform vec3 uAccent;
          uniform float uProgress;
          varying float vFraction;
          void main() {
            float flown = step(vFraction, uProgress);
            float head = exp(-abs(vFraction - uProgress) * 42.0);
            float alpha = 0.10 + flown * 0.42 + head * 0.9;
            gl_FragColor = vec4(uAccent * (0.7 + head), alpha);
          }
        `}
      />
    </line>
  );
}
