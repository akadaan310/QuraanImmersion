/**
 * continuum.ts — the live مرج البحرين, driven entirely by the recitation.
 *
 * There are no controls. Everything the two seas do is derived, frame by frame,
 * from two sources that are already live: the AnalyserNode's measurement of the
 * voice, and the six-vector Isnaad array computed from it. The observer's only
 * input is which ayah is playing.
 *
 * WHY THE VECTORS AND NOT A SLIDER
 * --------------------------------
 * The two seas are given lambda by the two halves of the Isnaad array that
 * already correspond to them:
 *
 *   بحر الساعات السفلى  <- L1 (الأمر) + L3 (الهدف المادي) + the low bands
 *        the terrestrial sea, driven by command and materialisation
 *
 *   بحر الساعات العليا  <- L2 (الصوت) + L5 (المستمع غير المرئي) + L6 (الصدى)
 *        the unseen sea, driven by the vocal anchor and what answers it
 *
 * Because L1/L3 and L2/L5/L6 rise at different moments of a verse — command
 * leads, materialisation follows, the echo closes — the two seas cross the
 * critical lambda = 3 at DIFFERENT times. One is still running uniform time
 * while the other has already collapsed or begun racing inward. That
 * divergence is the whole point, and it falls out of the Isnaad structure
 * rather than being staged.
 *
 * PULSATION
 * ---------
 * Onsets open clock wells. Each transient in the recitation injects a well
 * whose sea is chosen by which band carries the onset (low frequencies sink to
 * the lower sea, high ones rise to the upper), whose latitude comes from the
 * spectral centroid, and whose depth comes from the onset's own strength. The
 * recitation is therefore what taps the seas.
 */

import { audioEngine } from '@/audio/AudioEngine';
import { isnaadEngine } from '@/engine/isnaad/IsnaadEngine';
import { upperSeaSync, type UpperSeaLink } from '@/services/UpperSeaSync';
import { BASIN_EXTENT, DualSeaContinuum, type DualSeaStats, type SeaId } from './DualSea';

/** One global continuum: the clocks are the same clocks in every scene. */
export const continuum = new DualSeaContinuum(72, 72);

/** Onset strength above which a well opens. Below this the sea only breathes. */
const PULSE_THRESHOLD = 0.34;
/** Floor between wells, so a dense passage does not flood the basin. */
const PULSE_INTERVAL_MS = 130;

const LAMBDA_REST = 1.0;
const LAMBDA_SPAN = 3.3;   // rest + span*1.0 lands well above the critical 3.0
/** One-pole time constant for lambda, in seconds. Slow enough to read. */
const LAMBDA_TAU = 0.45;

let lambdaLower = LAMBDA_REST;
let lambdaUpper = LAMBDA_REST;
let lastPulseAt = 0;

function smooth(current: number, target: number, tau: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-dt / Math.max(tau, 1e-4)));
}

/**
 * Advance both seas one frame.
 *
 * Called from EngineDriver AFTER the audio frame and the Isnaad array have been
 * recomputed, so it reads this frame's measurement rather than last frame's.
 */
export function advanceContinuum(dt: number): void {
  const frame = audioEngine.frame;
  const isnaad = isnaadEngine.snapshot;

  // ---- lambda, from the Isnaad array ------------------------------------
  const lowerDrive = 0.45 * isnaad.l1 + 0.40 * isnaad.l3 + 0.30 * frame.bass;
  const upperDrive =
    0.40 * isnaad.l2 + 0.45 * isnaad.l5 + 0.35 * isnaad.l6 + 0.25 * frame.treble;

  lambdaLower = smooth(lambdaLower, LAMBDA_REST + LAMBDA_SPAN * lowerDrive, LAMBDA_TAU, dt);
  lambdaUpper = smooth(lambdaUpper, LAMBDA_REST + LAMBDA_SPAN * upperDrive, LAMBDA_TAU, dt);

  continuum.setLambda('lower', lambdaLower);
  continuum.setLambda('upper', lambdaUpper);

  // ---- pulsation: the recitation opens the clock wells -------------------
  const now = performance.now();
  if (frame.transient > PULSE_THRESHOLD && now - lastPulseAt > PULSE_INTERVAL_MS) {
    lastPulseAt = now;

    // Which sea receives the onset is decided by where its energy sits.
    const low = frame.subBass + frame.bass + frame.lowMid;
    const high = frame.mid + frame.highMid + frame.treble;
    const sea: SeaId = low >= high ? 'lower' : 'upper';

    // Latitude from spectral brightness: a bright phoneme lands high in the sea.
    const y = (frame.centroid * 2 - 1) * BASIN_EXTENT * 0.85;
    // A loud onset lands nearer the barrier, where the two seas are closest.
    const depth = 1 - Math.min(frame.level * 1.4, 0.85);
    const magnitude = 0.10 + depth * (BASIN_EXTENT - 0.12);
    const x = (sea === 'lower' ? -1 : 1) * magnitude;

    continuum.tap(x, y, 0.9 + frame.transient * 1.8);
  }

  continuum.step(dt);

  // ---- the upper sea's round trip through the deployment ----------------
  // Offered every frame, not awaited: the client throttles on WALL-CLOCK time
  // and keeps at most one request in flight, so the link can never gate the
  // simulation and its cadence cannot drift with the frame rate.
  upperSeaSync.offer(
    continuum.upper.logTau,
    lambdaUpper,
    continuum.tGlobal,
    continuum.steps,
  );
}

export function continuumStats(): DualSeaStats {
  return continuum.stats();
}

export function upperLink(): UpperSeaLink {
  return upperSeaSync.link;
}

/** Current driven lambda per sea, for readout only. */
export function drivenLambda(): { lower: number; upper: number } {
  return { lower: lambdaLower, upper: lambdaUpper };
}
