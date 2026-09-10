/**
 * The vehicle's own state — position, velocity, and how fast it is going.
 *
 * A module singleton, like the audio and Isnaad engines, and for the same
 * reason: it changes every frame and several unrelated layers need it within
 * that frame. The dust field stretches its motes along `velocity`; the rig
 * integrates it; the readout samples `speed` twice a second. Routing that
 * through React would re-render the tree sixty times a second to move a
 * particle.
 *
 * Mutated in place. Nothing here is ever reallocated per frame.
 */

import * as THREE from 'three';

export interface FlightState {
  /** Where the observer is, world space. */
  position: THREE.Vector3;
  /** Metres — Earth radii, here — per second. */
  velocity: THREE.Vector3;
  /** |velocity|, cached because three layers want it and it costs a sqrt. */
  speed: number;
  /**
   * Speed smoothed over about a second.
   *
   * The raw magnitude jitters frame to frame, and anything driven by it
   * directly — the field of view, the dust's streak length — jitters with it.
   * Every visual consumer reads this one instead.
   */
  smoothSpeed: number;
  /** Unit vector the nose is pointing along. */
  heading: THREE.Vector3;
  /** Roll about the view axis, radians. Positive banks right. */
  roll: number;
  /** What the camera is looking at. */
  target: THREE.Vector3;
}

export const flight: FlightState = {
  position: new THREE.Vector3(0, 0, 6),
  velocity: new THREE.Vector3(),
  speed: 0,
  smoothSpeed: 0,
  heading: new THREE.Vector3(0, 0, -1),
  roll: 0,
  target: new THREE.Vector3(),
};

/**
 * The speed at which the flight is considered to be cruising rather than
 * manoeuvring, in Earth radii per second.
 *
 * Used to normalise every speed-driven effect, so they all agree on what "fast"
 * means. A transit crosses several Earth radii in a few seconds; a station orbit
 * moves at a small fraction of that.
 */
export const CRUISE_SPEED = 2.2;

/** 0 at rest, 1 at cruise, above 1 in a hard transit. */
export function speedRatio(): number {
  return flight.smoothSpeed / CRUISE_SPEED;
}
