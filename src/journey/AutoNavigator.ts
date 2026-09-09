/**
 * The navigator — automatic, and it does not stop.
 *
 * Nothing in the interface steers. There is no orbit control, no drag-to-look,
 * no zoom. The journey moves because the recitation moves, and when the
 * recitation is silent it still moves, slowly, because a journey that halts
 * whenever audio does is not a journey — it is a paused video.
 *
 * TWO CLOCKS, AND WHY THEY ARE SEPARATE
 * -------------------------------------
 * The project's hard constraint is that no SCENE animates on wall-clock time:
 * every shader parameter is a function of what the analyser measured this frame.
 * That constraint is about the phenomena, and it still holds — nothing here
 * touches a uniform.
 *
 * Navigation is a different quantity and needs its own clock, stated plainly:
 *
 *   · while a verse is executing, the leg advances on VERSE PROGRESS, so the
 *     arrival at a station coincides with the ayah, not with a stopwatch;
 *   · while nothing is sounding, the leg advances on the SAYR RATE — a slow
 *     constant drift — so the universe keeps opening while the observer decides
 *     whether to touch anything at all.
 *
 * The two are blended rather than switched between, because a hard switch at
 * verse-start produced a visible jolt in the camera every single ayah.
 *
 * THE PHASES OF A LEG
 * -------------------
 *   departure  the station just left recedes; the track lifts off the surface
 *   transit    the great circle is flown; altitude arcs up and back down
 *   arrival    the next station resolves ahead and the arc settles
 *   station    the phenomenon stands; the camera holds and the orientations show
 *   ascent     L6 discharges, the field expands once, and the shell may climb
 *
 * INFINITY, HONESTLY
 * ------------------
 * Every `SHELL_PERIOD` legs the journey climbs a shell. The climb is rendered as
 * a recession — the structure travelled so far becomes a mote inside a wider
 * one — but the world is RECENTRED at each climb rather than scaled up. No
 * coordinate grows. A journey left running for a week is at the same float
 * precision as one started a minute ago, which is the only way "infinite" can be
 * true of a 32-bit renderer.
 */

import { SHELL_PERIOD, shellProgress } from './waypoints';

export type NavPhase = 'departure' | 'transit' | 'arrival' | 'station' | 'ascent';

export interface NavInput {
  /** Seconds since the previous step. */
  dt: number;
  /** Verse progress, 0..1, from the audio frame. */
  progress: number;
  /** True between verse-start and verse-end. */
  executing: boolean;
  /** L6 closure impulse, 0..1, non-zero only just after a verse closes. */
  closure: number;
  /** Absolute ayah index of the leg being flown. */
  index: number;
}

export interface NavState {
  phase: NavPhase;
  /** Position along the great circle from the previous waypoint to this one, 0..1. */
  leg: number;
  /**
   * Height above the surface in Earth radii. Arcs during transit and settles at
   * the station's own altitude on arrival.
   */
  altitude: number;
  /** Accumulated roll of the vehicle about its track, radians. */
  bank: number;
  /** How far into the current shell the journey is, 0..1. */
  shell: number;
  /** Discharge of the last closure, decaying — drives the one field expansion. */
  discharge: number;
  /** Total legs completed since the navigator was created. */
  legsFlown: number;
}

/**
 * Fraction of a leg spent in transit before the station is reached.
 *
 * At 0.45 the observer arrives a little under halfway through the ayah, which
 * leaves the majority of the recitation standing at the phenomenon rather than
 * watching the approach. Arriving later than this and the scene barely resolves
 * before the verse closes.
 */
export const TRANSIT_FRACTION = 0.45;

/** Legs per minute while nothing is sounding. Slow enough to be a drift. */
const SAYR_RATE = 1 / 90;

/** Peak height of the transit arc, in Earth radii above the surface. */
const ARC_HEIGHT = 2.6;

export interface Navigator {
  readonly state: NavState;
  /** Advance one frame. Returns the same object — it is mutated in place. */
  step(input: NavInput): NavState;
  /** Begin a new leg. Called on verse-start, once per ayah. */
  beginLeg(index: number): void;
  reset(): void;
}

/**
 * Smoothstep. Used for every ease in this file so acceleration is continuous:
 * a linear leg makes the camera start and stop with a visible snap, and on a
 * 120 Hz panel that snap is the most noticeable thing on screen.
 */
function ease(t: number): number {
  const clamped = Math.max(0, Math.min(1, t));
  return clamped * clamped * (3 - 2 * clamped);
}

export function createNavigator(): Navigator {
  const state: NavState = {
    phase: 'departure',
    leg: 0,
    altitude: ARC_HEIGHT,
    bank: 0,
    shell: 0,
    discharge: 0,
    legsFlown: 0,
  };

  /** Drift accumulated while silent, in leg fractions. Reset at each verse. */
  let drift = 0;
  let lastIndex = -1;

  function beginLeg(index: number): void {
    if (index === lastIndex) return;
    lastIndex = index;
    drift = 0;
    state.leg = 0;
    state.phase = 'departure';
    state.legsFlown += 1;
  }

  function step(input: NavInput): NavState {
    const dt = Math.max(0, Math.min(input.dt || 0, 0.1));   // a stalled tab must not teleport

    if (input.index !== lastIndex) beginLeg(input.index);

    // --- the two clocks -----------------------------------------------------
    // Silent drift accumulates always; verse progress overrides it once it is
    // ahead. Taking the maximum blends them without a switch: at verse-start
    // progress is 0 and the drift carries, and within a second or two progress
    // has overtaken it and is driving.
    drift += dt * SAYR_RATE;
    const driven = input.executing ? Math.max(input.progress, drift) : drift;
    // Wrapping rather than clamping is what makes the journey endless: a leg
    // that runs past its end simply becomes the next leg's departure.
    state.leg = driven % 1;

    // --- phase --------------------------------------------------------------
    const closing = input.closure > 0.02;
    if (closing) state.phase = 'ascent';
    else if (state.leg < 0.12) state.phase = 'departure';
    else if (state.leg < TRANSIT_FRACTION - 0.08) state.phase = 'transit';
    else if (state.leg < TRANSIT_FRACTION) state.phase = 'arrival';
    else state.phase = 'station';

    // --- altitude -----------------------------------------------------------
    // One arc across the transit, flattening to the station's own height for the
    // remainder of the ayah. sin(πt) rather than a parabola: it leaves and
    // arrives with zero vertical velocity, so there is no kink at either end.
    const transit = Math.min(1, state.leg / TRANSIT_FRACTION);
    const arc = Math.sin(Math.PI * ease(transit)) * ARC_HEIGHT;
    const settled = 1 - ease((state.leg - TRANSIT_FRACTION) / (1 - TRANSIT_FRACTION));
    state.altitude = state.leg < TRANSIT_FRACTION ? arc : arc * Math.max(0, settled);

    // --- bank ---------------------------------------------------------------
    // The vehicle leans into the turn during transit and levels at the station.
    const target = state.leg < TRANSIT_FRACTION ? Math.sin(Math.PI * transit) * 0.22 : 0;
    state.bank += (target - state.bank) * Math.min(dt * 1.8, 1);

    // --- closure ------------------------------------------------------------
    // The impulse is taken at its peak and released slowly, so the single field
    // expansion of رد السلام reads as one event rather than a flicker.
    state.discharge = Math.max(input.closure, state.discharge - dt * 0.8);

    // --- the shell ----------------------------------------------------------
    state.shell = shellProgress(input.index) + state.leg / SHELL_PERIOD;

    return state;
  }

  function reset(): void {
    drift = 0;
    lastIndex = -1;
    state.phase = 'departure';
    state.leg = 0;
    state.altitude = ARC_HEIGHT;
    state.bank = 0;
    state.shell = 0;
    state.discharge = 0;
    state.legsFlown = 0;
  }

  return { state, step, beginLeg, reset };
}

/**
 * Whether the orientation markers should be showing.
 *
 * They appear on arrival and hold through the station, then withdraw as the
 * circuit closes. Offering them during transit would mean a tap landing on an
 * orientation belonging to a station the observer has not reached yet.
 */
export function orientationsVisible(state: NavState): boolean {
  return (state.phase === 'arrival' || state.phase === 'station') && state.discharge < 0.25;
}
