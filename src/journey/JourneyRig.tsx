/**
 * The rig — the vehicle, flown.
 *
 * WHY THIS IS NOT A LERP
 * ----------------------
 * The first version computed a desired camera position each frame and moved the
 * camera a fraction of the way toward it. That is the standard approach and it
 * felt exactly like what it was: a camera being dragged along a rail. There was
 * no momentum, so nothing ever overshot, settled, or leaned; at a station it
 * reached its target and stopped dead, and a scene with a perfectly motionless
 * camera reads as a photograph of space rather than a position in it.
 *
 * So the vehicle now has a STATE and the rig applies forces to it:
 *
 *   · a steering acceleration toward where it should be,
 *   · damping proportional to velocity, so it settles instead of oscillating,
 *   · integration, so it carries momentum through a turn and drifts past a
 *     target before easing back.
 *
 * Everything that follows falls out of having a real velocity: the nose points
 * along it, the vehicle banks into the lateral component of its own
 * acceleration the way anything that flies does, the field of view opens with
 * speed, and the dust field has a direction to streak along.
 *
 * NOTHING EVER COMES TO REST
 * --------------------------
 * On station the destination is not a point but a slow orbit around it, so there
 * is always parallax and the phenomenon is always being seen from a slightly new
 * angle. Standing still is what made it feel like a harness.
 */

import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import { EARTH_RADIUS } from '@/cosmos/Earth';
import { interpolate, toVector } from '@/astro/geo';
import { ORIENTATIONS, type OrientationId } from './orientations';
import { TRANSIT_FRACTION, type NavState } from './AutoNavigator';
import { CRUISE_SPEED, flight } from './flight';
import type { Waypoint } from './waypoints';

const DEG = Math.PI / 180;

/**
 * Radius the phenomenon scene occupies at a station, in Earth radii.
 *
 * Large enough to be flown around rather than looked at from outside: at 0.55
 * the scene is a structure the vehicle moves through the neighbourhood of, and
 * the parallax across one orbit is substantial.
 */
export const STATION_SCALE = 0.55;
/** The scenes are authored around a core of this radius. */
const SCENE_CORE = 3.2;

/** Steering stiffness, per second². Higher chases harder. */
const STEER = 2.6;
/** Damping, per second. Under-damped on purpose: it is what produces the drift. */
const DAMP = 1.55;
/** Speed beyond which the vehicle stops accelerating, in Earth radii per second. */
const SPEED_LIMIT = 9.0;

/** How fast the station orbit sweeps, radians per second. */
const ORBIT_RATE = 0.16;

/** World position of a station: its coordinate, lifted to its own altitude. */
export function stationPosition(waypoint: Waypoint, target = new THREE.Vector3()): THREE.Vector3 {
  return toVector(waypoint.at, EARTH_RADIUS + waypoint.altitude, target);
}

/**
 * East–north–up at a point on the globe.
 *
 * The degenerate case is a station directly over a pole, where "east" is
 * undefined. It is nudged rather than left to produce a zero-length cross
 * product, which would collapse the basis and send the vehicle to NaN for the
 * rest of the session.
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
   * the phenomenon. If the rig also wrote it the two would fight every frame and
   * the result would be a visible flutter.
   */
  cedeFov?: boolean;
  /** Receives the station's world position each frame, for L4 and the scene mount. */
  onStation?: (position: THREE.Vector3) => void;
}

export function JourneyRig({ nav, waypoint, previous, orientation, cedeFov, onStation }: RigProps) {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;

  const scratch = useMemo(() => ({
    station: new THREE.Vector3(),
    desired: new THREE.Vector3(),
    look: new THREE.Vector3(),
    steer: new THREE.Vector3(),
    lateral: new THREE.Vector3(),
    up: new THREE.Vector3(),
    east: new THREE.Vector3(),
    north: new THREE.Vector3(),
    along: new THREE.Vector3(),
    previousVelocity: new THREE.Vector3(),
    lead: new THREE.Vector3(),
  }), []);

  const state = useRef({ orbit: Math.random() * Math.PI * 2, fov: 62, started: false });

  useFrame((_, delta) => {
    // A backgrounded tab returns with a delta of seconds; integrating it would
    // fire the vehicle out of the solar system.
    const dt = Math.min(delta, 1 / 20);
    const s = scratch;

    stationPosition(waypoint, s.station);
    onStation?.(s.station);

    const transit = Math.min(1, nav.leg / TRANSIT_FRACTION);
    const arrived = nav.leg >= TRANSIT_FRACTION;
    const spec = orientation ? ORIENTATIONS[orientation] : null;

    if (!arrived) {
      // ---- in flight -------------------------------------------------------
      // On the great circle, at the navigator's arc altitude. The destination
      // runs ahead of the vehicle rather than sitting on it, so the steering
      // force is always forward and the flight never decelerates into its own
      // target mid-leg.
      const ahead = Math.min(1, transit + 0.10);
      const altitude = EARTH_RADIUS + nav.altitude * 0.85 + 0.30;
      toVector(interpolate(previous.at, waypoint.at, ahead), altitude, s.desired);

      // Look further ahead still, and swing onto the station as it nears, so
      // arrival is a turn rather than a cut.
      toVector(interpolate(previous.at, waypoint.at, Math.min(1, transit + 0.22)), altitude, s.look);
      s.look.lerp(s.station, THREE.MathUtils.smoothstep(transit, 0.6, 1));
    } else {
      // ---- on station ------------------------------------------------------
      // A slow orbit, not a fixed offset. The orbit is what keeps parallax
      // alive while the ayah plays out; a stationary camera here was the single
      // biggest reason the whole thing felt like a rig rather than a flight.
      state.current.orbit += dt * ORBIT_RATE;

      const distance = (spec?.distance ?? 1.6) * SCENE_CORE * STATION_SCALE + 0.9;
      const elevation = (spec?.elevation ?? 10) * DEG;

      localFrame(s.station, s.up, s.east, s.north);
      const swing = state.current.orbit;

      s.desired.copy(s.station)
        .addScaledVector(s.up, Math.sin(elevation) * distance)
        .addScaledVector(s.east, Math.cos(elevation) * Math.cos(swing) * distance)
        .addScaledVector(s.north, Math.cos(elevation) * Math.sin(swing) * distance);

      // Look slightly past the station along the orbit, so the head leads the
      // body through the turn instead of staring rigidly at the centre.
      s.look.copy(s.station).addScaledVector(
        s.east.clone().multiplyScalar(-Math.sin(swing)).add(s.north.clone().multiplyScalar(Math.cos(swing))),
        distance * 0.18,
      );
    }

    // ---- integrate ---------------------------------------------------------
    if (!state.current.started) {
      flight.position.copy(s.desired);
      flight.target.copy(s.look);
      flight.velocity.set(0, 0, 0);
      state.current.started = true;
    }

    s.previousVelocity.copy(flight.velocity);

    // Spring toward the destination, damped by the current velocity. Critical
    // damping would be 2·√STEER ≈ 3.2; at 1.55 the vehicle is deliberately
    // under-damped, which is what makes it drift past and ease back rather than
    // arrive and stop.
    s.steer.copy(s.desired).sub(flight.position).multiplyScalar(STEER)
      .addScaledVector(flight.velocity, -DAMP);

    flight.velocity.addScaledVector(s.steer, dt);
    if (flight.velocity.length() > SPEED_LIMIT) flight.velocity.setLength(SPEED_LIMIT);
    flight.position.addScaledVector(flight.velocity, dt);

    flight.speed = flight.velocity.length();
    // ~1 s time constant, frame-rate corrected.
    flight.smoothSpeed += (flight.speed - flight.smoothSpeed) * (1 - Math.exp(-dt));

    if (flight.speed > 1e-4) flight.heading.copy(flight.velocity).divideScalar(flight.speed);

    // The look target eases rather than snapping, so a change of destination is
    // a turn of the head and not a cut.
    flight.target.lerp(s.look, 1 - Math.exp(-3.2 * dt));

    // ---- bank --------------------------------------------------------------
    // Roll into the lateral component of acceleration: the part of the velocity
    // change that is perpendicular to where the nose points. This is why a turn
    // reads as a turn and not as a sideways slide.
    s.lateral.copy(flight.velocity).sub(s.previousVelocity);
    if (dt > 0) s.lateral.divideScalar(dt);
    s.lateral.addScaledVector(flight.heading, -s.lateral.dot(flight.heading));

    localFrame(flight.position, s.up, s.east, s.north);
    const rightward = s.lateral.dot(s.up.clone().cross(flight.heading).normalize());
    const bank = THREE.MathUtils.clamp(rightward * 0.055, -0.5, 0.5) + nav.bank * 0.4
      + (spec?.roll ?? 0) * DEG;
    flight.roll += (bank - flight.roll) * (1 - Math.exp(-2.2 * dt));

    // ---- apply to the camera ----------------------------------------------
    camera.position.copy(flight.position);

    // Up is the local vertical, rolled about the view axis. World-up instead
    // would tumble the horizon every time the journey crosses a pole.
    localFrame(camera.position, s.up, s.east, s.north);
    s.lead.copy(flight.target).sub(camera.position);
    if (s.lead.lengthSq() < 1e-8) s.lead.copy(flight.heading);
    s.lead.normalize();
    camera.up.copy(s.up).applyAxisAngle(s.lead, flight.roll);
    camera.lookAt(flight.target);

    // ---- field of view -----------------------------------------------------
    // Opens with speed. This is the oldest trick for conveying velocity and it
    // works because it is what a real widening field does to peripheral flow —
    // the edges of the frame accelerate more than the centre.
    if (!cedeFov) {
      const base = spec?.fov ?? 62;
      const target = base + THREE.MathUtils.clamp(flight.smoothSpeed / CRUISE_SPEED, 0, 1.6) * 16;
      state.current.fov += (target - state.current.fov) * (1 - Math.exp(-1.8 * dt));
      if (Math.abs(camera.fov - state.current.fov) > 0.02) {
        camera.fov = state.current.fov;
        camera.updateProjectionMatrix();
      }
    } else {
      // Track what the scene is doing, so the rig resumes from there.
      state.current.fov = camera.fov;
    }
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
      // The track follows the arc the vehicle flies rather than lying flat on
      // the globe.
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
            float alpha = 0.08 + flown * 0.34 + head * 0.9;
            gl_FragColor = vec4(uAccent * (0.7 + head), alpha);
          }
        `}
      />
    </line>
  );
}
