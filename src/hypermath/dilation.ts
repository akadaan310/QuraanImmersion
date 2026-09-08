/**
 * dilation.ts — the three-phase localized clock lifecycle.
 *
 * Ported from the verified Python engine. Replaces a global time scalar t with
 * a localized proper-time continuum tau(x, t): every cell carries its own clock.
 *
 *   A. SUB-CRITICAL     lambda < 3    dtau/dt = 1 exactly       (uniform flow)
 *   B. COLLAPSE         lambda = 3    dtau/dt -> 0 where dense  (clocks stop)
 *   C. SUPER-CRITICAL   lambda > 3    dtau/dt -> infinity at the core
 *
 * Phase C is normalized against a reference radius, because a bare
 * proportionality fixes no units:
 *
 *      log_rate(x) = lambda * ( 1/||x||^2  -  1/r_ref^2 )
 *
 * At ||x|| = r_ref the rate is exactly 1, so r_ref IS the clock the core is
 * measured against; inside it clocks race, outside they lag. Without this the
 * whole ensemble would carry an arbitrary multiplicative unit in tau and only
 * the RATIO of two clocks would be well defined — so the normalization makes
 * that ratio explicit rather than implicit.
 */

import { LOG_FLOAT64_MAX } from './logspace';

export const CRITICAL_LAMBDA = 3.0;

export enum Phase {
  SubCritical = 0,
  Collapse = 1,
  SuperCritical = 2,
}

/** Arabic phase names — QuranSpace renders no other language. */
export const PHASE_LABEL: Record<Phase, string> = {
  [Phase.SubCritical]: 'ما دون الحرج',
  [Phase.Collapse]: 'عتبة الانهيار',
  [Phase.SuperCritical]: 'فوق الحرج — التحام داخلي',
};

export enum SiteStatus {
  Ok = 0,
  Frozen = 1,
  Singular = 2,
}

/**
 * Which branch is live.
 *
 * The threshold is a BAND, not an equality: `lambda === 3.0` is true for a set
 * of measure zero and is unreachable by any continuous sweep, so a slider
 * stepping lambda would skip the collapse phase entirely.
 *
 * The band must also be chosen WIDER than the sweep's step. A subtlety verified
 * in the Python suite: `3.0 + 1e-9` is not 1e-9 away from 3.0 — the nearest
 * float64 sits 1.0000000827e-9 away — so even the band's own edge is not
 * addressable by arithmetic. The default 0.02 spans a comfortable interval for
 * a human dragging a control.
 */
export function phaseOf(lambda: number, band = 0.02): Phase {
  if (Math.abs(lambda - CRITICAL_LAMBDA) <= band) return Phase.Collapse;
  return lambda < CRITICAL_LAMBDA ? Phase.SubCritical : Phase.SuperCritical;
}

export interface DilationParams {
  lambda: number;
  /** Density above which a clock freezes at the collapse threshold. */
  rhoCritical: number;
  /** The boundary clock the core is measured against (phase C). */
  referenceRadius: number;
  /** Below this radius the rate is genuinely infinite; the site is marked. */
  minRadius: number;
  band: number;
}

export const DEFAULT_DILATION: DilationParams = {
  lambda: 1.0,
  rhoCritical: 0.55,
  referenceRadius: 0.55,
  minRadius: 1e-6,
  band: 0.02,
};

export interface RateResult {
  logRate: number;
  status: SiteStatus;
}

/**
 * ln(dtau/dt) for one site. Computed ENTIRELY in log space: exp(lambda/r^2) is
 * never formed, so a core clock at r = 1e-6 with lambda = 3.5 yields
 * log_rate = 3.5e12 instead of Infinity.
 */
export function logRateAt(
  radius: number,
  density: number,
  params: DilationParams,
): RateResult {
  const phase = phaseOf(params.lambda, params.band);

  if (phase === Phase.SubCritical) {
    // Uniform flow: exactly 1, not "approximately 1".
    return { logRate: 0, status: SiteStatus.Ok };
  }

  if (phase === Phase.Collapse) {
    // A step function on density. "-> 0" is implemented as EXACTLY zero via
    // -Infinity, which logaddexp handles without special-casing; a large
    // negative finite floor would leak drift into a clock the model stops.
    if (density > params.rhoCritical) {
      return { logRate: -Infinity, status: SiteStatus.Frozen };
    }
    return { logRate: 0, status: SiteStatus.Ok };
  }

  // Super-critical: the divergence is real and is not clipped.
  if (radius < params.minRadius) {
    return { logRate: Infinity, status: SiteStatus.Singular };
  }
  const rRef = params.referenceRadius;
  return {
    logRate: params.lambda * (1 / (radius * radius) - 1 / (rRef * rRef)),
    status: SiteStatus.Ok,
  };
}

/** Would a direct exp() of this rate have destroyed the simulation? */
export function rateExceedsFloat64(logRate: number): boolean {
  return logRate > LOG_FLOAT64_MAX;
}
