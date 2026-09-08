/**
 * logspace.ts — overflow-safe arithmetic for QuranSpace.
 *
 * Ported from the verified Python engine (tri-reality-os/sandbox-lower).
 * Every function here exists for one reason: the super-critical clock rate
 *
 *      dtau/dt  ~  exp( lambda / ||x||^2 )
 *
 * diverges, and IEEE-754 float64 stops at exp(709.78) = 1.798e308. A clock at
 * radius 0.06 with lambda = 3.5 already needs exp(972). Encoded directly it
 * becomes Infinity, then Infinity - Infinity = NaN, and the whole sea fills
 * with NaN while every array length still looks correct.
 *
 * So the primary state is never the rate and never the proper time. It is the
 * LOGARITHM of each. log_rate = lambda/r^2 is linear and never overflows: at
 * r = 1e-150 it is merely 3.5e300.
 */

/** ln(1.7976931348623157e308) — where float64 exp() dies. */
export const LOG_FLOAT64_MAX = 709.782712893384;

/**
 * ln(e^a + e^b), computed without ever forming e^a or e^b.
 *
 * This is what makes proper-time accumulation exact rather than approximate:
 *
 *      tau_{n+1} = tau_n + (dtau/dt) dt
 *   => ln tau_{n+1} = logaddexp( ln tau_n , log_rate + ln dt )
 *
 * A frozen clock carries log_rate = -Infinity, and logaddexp(a, -Inf) = a
 * exactly, so a stopped clock holds its proper time with no special-casing and
 * no drift.
 */
export function logaddexp(a: number, b: number): number {
  if (a === -Infinity) return b;
  if (b === -Infinity) return a;
  const max = a > b ? a : b;
  const min = a > b ? b : a;
  return max + Math.log1p(Math.exp(min - max));
}

/**
 * exp() that is clamped ABOVE only.
 *
 * Clamping below as well would map a frozen clock's -Infinity onto -709.78,
 * i.e. dtau/dt = 5e-309 rather than 0 — a stopped clock that silently creeps.
 * That exact bug was caught by the Python self-test and is prevented here by
 * construction.
 */
export function expClampedAbove(logValue: number): number {
  if (logValue === -Infinity) return 0;
  return Math.exp(Math.min(logValue, LOG_FLOAT64_MAX));
}

/** Would a direct exp() of this log-value have overflowed? */
export function wouldOverflow(logValue: number): boolean {
  return logValue > LOG_FLOAT64_MAX;
}

/**
 * A complex number held as (ln|z|, arg z).
 *
 * In N dimensions the wavepacket magnitude is a product of N factors, so |Psi|
 * overflows float64 near N ~ 1300. Storing the log lifts the representable
 * range to |z| in [1e-3e307, 1e+3e307], which is dimension-proof.
 */
export interface LogComplex {
  logMagnitude: number;
  phase: number;
}

const TWO_PI = 2 * Math.PI;

/** Reduce a phase into (-pi, pi]. */
export function wrapPhase(phase: number): number {
  const wrapped = phase - TWO_PI * Math.round(phase / TWO_PI);
  return wrapped === -Math.PI ? Math.PI : wrapped;
}

export function logComplexMul(a: LogComplex, b: LogComplex): LogComplex {
  return {
    logMagnitude: a.logMagnitude + b.logMagnitude,
    phase: wrapPhase(a.phase + b.phase),
  };
}

/**
 * Scale-free discrepancy between two LogComplex values: |ratio - 1|.
 * Meaningful even when both magnitudes are ~1e300 and cannot be materialized.
 */
export function logComplexRelativeError(a: LogComplex, b: LogComplex): number {
  const dLog = a.logMagnitude - b.logMagnitude;
  if (!Number.isFinite(dLog)) return Infinity;
  if (dLog > 700) return Infinity;
  const dPhase = wrapPhase(a.phase - b.phase);
  const scale = Math.exp(dLog);
  const re = scale * Math.cos(dPhase) - 1;
  const im = scale * Math.sin(dPhase);
  return Math.hypot(re, im);
}
