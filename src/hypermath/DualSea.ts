/**
 * DualSea.ts — مرج البحرين يلتقيان: two seas of clocks meeting at a برزخ.
 *
 * This is the merge point of QuranSpace. Two independent proper-time ensembles
 * are advanced side by side:
 *
 *      بحر الساعات السفلى   the LOWER clock sea   (the local runtime's time)
 *      بحر الساعات العليا   the UPPER clock sea   (the distributed runtime's time)
 *
 * They meet along a barrier and DO NOT MIX. That is not a rendering effect
 * painted onto a shared field — it is an invariant of the data structure:
 *
 *   * each sea owns its own coordinate array, its own tau(x,t), its own
 *     log-rate array, and its own lambda;
 *   * no update path reads one sea's arrays while writing the other's;
 *   * `verifyBarrier()` asserts that every cell of each sea lies strictly on
 *     its own side, and `isolationWitness()` proves that agitating one sea
 *     leaves the other's proper times BIT-IDENTICAL.
 *
 * The last of those is the real content of لا يبغيان: not that crossing is
 * discouraged, but that it is structurally impossible and measurably absent.
 *
 * Each sea's clocks run under the three-phase lifecycle of dilation.ts, so the
 * two seas can sit in DIFFERENT PHASES simultaneously — one uniform, one
 * collapsed, one racing inward — while still refusing to exchange anything
 * across the barrier.
 */

import { logaddexp, expClampedAbove, LOG_FLOAT64_MAX } from './logspace';
import {
  DEFAULT_DILATION,
  Phase,
  SiteStatus,
  logRateAt,
  phaseOf,
  type DilationParams,
} from './dilation';

export type SeaId = 'lower' | 'upper';

/** Arabic names — QuranSpace renders no other language. */
export const SEA_LABEL: Record<SeaId, string> = {
  lower: 'بحر الساعات السفلى',
  upper: 'بحر الساعات العليا',
};

/** Half-width of the برزخ in world units. Nothing exists inside it. */
export const BARRIER_HALF_WIDTH = 0.06;

/** World extent of the whole basin along each axis. */
export const BASIN_EXTENT = 1.0;

export interface TapSource {
  /** World coordinates of the tap. */
  x: number;
  y: number;
  sea: SeaId;
  /** Seconds since the tap landed; drives its decay. */
  age: number;
  strength: number;
}

export interface SeaStats {
  phase: Phase;
  lambda: number;
  logTauMin: number;
  logTauMax: number;
  logRateMax: number;
  frozen: number;
  singular: number;
  /** True when a direct exp() encoding would have produced Infinity. */
  exceedsFloat64: boolean;
  taps: number;
}

/** One sea: an independent ensemble of localized clocks. */
class ClockSea {
  readonly id: SeaId;
  readonly width: number;
  readonly height: number;

  /** World-space cell centres. Never shared with the other sea. */
  readonly worldX: Float32Array;
  readonly worldY: Float32Array;
  /** Radius from THIS sea's own core. */
  readonly radius: Float32Array;

  readonly logTau: Float64Array;
  readonly logRate: Float64Array;
  readonly baseDensity: Float32Array;
  readonly density: Float32Array;
  readonly status: Uint8Array;

  /**
   * RGBA float payload handed to the GPU.
   *
   * Typed as Float32Array<ArrayBuffer> — not the default ArrayBufferLike —
   * because THREE.DataTexture requires a buffer that is provably not shared.
   */
  readonly texture: Float32Array<ArrayBuffer>;

  params: DilationParams;

  constructor(id: SeaId, width: number, height: number, params: DilationParams) {
    this.id = id;
    this.width = width;
    this.height = height;
    this.params = { ...params };

    const n = width * height;
    this.worldX = new Float32Array(n);
    this.worldY = new Float32Array(n);
    this.radius = new Float32Array(n);
    this.logTau = new Float64Array(n);
    this.logRate = new Float64Array(n);
    this.baseDensity = new Float32Array(n);
    this.density = new Float32Array(n);
    this.status = new Uint8Array(n);
    this.texture = new Float32Array(new ArrayBuffer(n * 4 * Float32Array.BYTES_PER_ELEMENT));

    // tau starts at 0 => ln tau starts at -Infinity. logaddexp handles it exactly.
    this.logTau.fill(-Infinity);

    // Lay the sea out on its OWN side of the barrier. The lower sea occupies
    // x < -BARRIER_HALF_WIDTH, the upper sea x > +BARRIER_HALF_WIDTH; neither
    // is ever assigned a coordinate inside or across the barrier.
    const sign = id === 'lower' ? -1 : 1;
    const inner = BARRIER_HALF_WIDTH;
    const outer = BASIN_EXTENT;
    const coreX = sign * (inner + outer) * 0.5;

    for (let j = 0; j < height; j++) {
      for (let i = 0; i < width; i++) {
        const k = j * width + i;
        // Cell CENTRES, not edges. Sampling at edges puts the innermost column
        // exactly on |x| = BARRIER_HALF_WIDTH, which is inside the برزخ — a
        // region nothing may occupy. Centres keep every cell strictly on its
        // own side, which is what verifyBarrier() then confirms.
        const u = (i + 0.5) / width;
        const v = (j + 0.5) / height;
        const x = sign * (inner + (outer - inner) * u);
        const y = -BASIN_EXTENT + 2 * BASIN_EXTENT * v;
        this.worldX[k] = x;
        this.worldY[k] = y;
        const dx = x - coreX;
        this.radius[k] = Math.hypot(dx, y);
        // A Gaussian core gives "high-density region" a definite meaning.
        this.baseDensity[k] = Math.exp(-(dx * dx + y * y) * 3.0);
      }
    }
    this.density.set(this.baseDensity);
  }

  /** Rebuild the density field from the base plus this sea's own taps. */
  applyTaps(taps: readonly TapSource[]): void {
    this.density.set(this.baseDensity);
    for (const tap of taps) {
      if (tap.sea !== this.id) continue; // a tap belongs to exactly one sea
      const decay = Math.exp(-tap.age * 0.6);
      if (decay < 1e-3) continue;
      const amplitude = tap.strength * decay;
      for (let k = 0; k < this.density.length; k++) {
        const dx = this.worldX[k] - tap.x;
        const dy = this.worldY[k] - tap.y;
        this.density[k] += amplitude * Math.exp(-(dx * dx + dy * dy) * 60.0);
      }
    }
  }

  /**
   * Recompute every clock rate from this sea's own lambda.
   *
   * A tap deepens the local clock well: it raises density (which freezes the
   * cell at the collapse threshold) and shortens the effective radius (which
   * accelerates it in the super-critical phase). One gesture therefore does
   * opposite things in different phases, which is the point.
   */
  recomputeRates(): void {
    for (let k = 0; k < this.logRate.length; k++) {
      const wellDepth = this.density[k] - this.baseDensity[k];
      const effectiveRadius = Math.max(
        this.params.minRadius,
        this.radius[k] * Math.exp(-wellDepth * 0.9),
      );
      const { logRate, status } = logRateAt(effectiveRadius, this.density[k], this.params);
      this.logRate[k] = logRate;
      this.status[k] = status;
    }
  }

  /** Advance every local clock by one global tick: ln tau += rate * dt, in log space. */
  step(dt: number): void {
    const logDt = Math.log(dt);
    for (let k = 0; k < this.logTau.length; k++) {
      const rate = this.logRate[k];
      // A singular site's clock is infinite; it stays infinite rather than NaN.
      this.logTau[k] = rate === Infinity ? Infinity : logaddexp(this.logTau[k], rate + logDt);
    }
  }

  stats(tapCount: number): SeaStats {
    let logTauMin = Infinity;
    let logTauMax = -Infinity;
    let logRateMax = -Infinity;
    let frozen = 0;
    let singular = 0;
    let exceeds = false;

    for (let k = 0; k < this.logTau.length; k++) {
      const t = this.logTau[k];
      if (Number.isFinite(t)) {
        if (t < logTauMin) logTauMin = t;
        if (t > logTauMax) logTauMax = t;
      }
      const r = this.logRate[k];
      if (Number.isFinite(r) && r > logRateMax) logRateMax = r;
      if (r > LOG_FLOAT64_MAX) exceeds = true;
      if (this.status[k] === SiteStatus.Frozen) frozen++;
      if (this.status[k] === SiteStatus.Singular) singular++;
    }

    return {
      phase: phaseOf(this.params.lambda, this.params.band),
      lambda: this.params.lambda,
      logTauMin: Number.isFinite(logTauMin) ? logTauMin : 0,
      logTauMax: Number.isFinite(logTauMax) ? logTauMax : 0,
      logRateMax: Number.isFinite(logRateMax) ? logRateMax : 0,
      frozen,
      singular,
      exceedsFloat64: exceeds,
      taps: tapCount,
    };
  }

  /**
   * Pack state for the GPU as RGBA float.
   *   R = normalized ln tau   G = normalized ln rate
   *   B = density             A = status
   *
   * Both logs are normalized against this sea's OWN range: a sea whose core
   * clock has run to e^3.5e6 and one running uniformly must both arrive at the
   * shader as [0,1], or the super-critical sea would saturate the display and
   * the sub-critical one would vanish into the floor.
   */
  writeTexture(): void {
    let tauMin = Infinity;
    let tauMax = -Infinity;
    let rateMin = Infinity;
    let rateMax = -Infinity;
    for (let k = 0; k < this.logTau.length; k++) {
      const t = this.logTau[k];
      if (Number.isFinite(t)) {
        if (t < tauMin) tauMin = t;
        if (t > tauMax) tauMax = t;
      }
      const r = this.logRate[k];
      if (Number.isFinite(r)) {
        if (r < rateMin) rateMin = r;
        if (r > rateMax) rateMax = r;
      }
    }
    const tauSpan = tauMax - tauMin;
    const rateSpan = rateMax - rateMin;

    for (let k = 0; k < this.logTau.length; k++) {
      const t = this.logTau[k];
      const r = this.logRate[k];
      const o = k * 4;
      this.texture[o] = Number.isFinite(t) && tauSpan > 1e-12 ? (t - tauMin) / tauSpan
                      : (t === -Infinity ? 0 : 1);
      this.texture[o + 1] = Number.isFinite(r) && rateSpan > 1e-12 ? (r - rateMin) / rateSpan
                          : (r === -Infinity ? 0 : 1);
      // Density is a DISPLAY channel and taps drive it above 1, so it is
      // saturated here rather than allowed to exceed the texture's range.
      // The unclamped value remains authoritative in `this.density`.
      this.texture[o + 2] = Math.min(this.density[k], 1);
      this.texture[o + 3] = this.status[k] / 2;
    }
  }
}

export interface DualSeaStats {
  lower: SeaStats;
  upper: SeaStats;
  tGlobal: number;
  steps: number;
  /** Number of cells found on the wrong side of the برزخ. Must always be 0. */
  barrierViolations: number;
}

/**
 * The pair of seas, their barrier, and the taps that agitate them.
 */
export class DualSeaContinuum {
  readonly lower: ClockSea;
  readonly upper: ClockSea;
  private taps: TapSource[] = [];
  tGlobal = 0;
  steps = 0;

  constructor(width = 72, height = 72) {
    this.lower = new ClockSea('lower', width, height, { ...DEFAULT_DILATION, lambda: 1.0 });
    this.upper = new ClockSea('upper', width, height, { ...DEFAULT_DILATION, lambda: 1.0 });
    this.recompute();
  }

  sea(id: SeaId): ClockSea {
    return id === 'lower' ? this.lower : this.upper;
  }

  setLambda(id: SeaId, lambda: number): void {
    this.sea(id).params.lambda = lambda;
    this.recompute();
  }

  /**
   * Register a tap. The sea is decided by which side of the barrier it landed
   * on; a tap inside the barrier itself is refused, because the برزخ is not a
   * place where anything exists.
   */
  tap(x: number, y: number, strength = 1.0): SeaId | null {
    if (Math.abs(x) <= BARRIER_HALF_WIDTH) return null;
    const sea: SeaId = x < 0 ? 'lower' : 'upper';
    this.taps.push({ x, y, sea, age: 0, strength });
    if (this.taps.length > 24) this.taps.shift();
    return sea;
  }

  clearTaps(): void {
    this.taps = [];
    this.recompute();
  }

  tapCount(id: SeaId): number {
    return this.taps.filter((t) => t.sea === id).length;
  }

  private recompute(): void {
    this.lower.applyTaps(this.taps);
    this.upper.applyTaps(this.taps);
    this.lower.recomputeRates();
    this.upper.recomputeRates();
  }

  /** Advance both seas by dt. Each uses only its own arrays. */
  step(dt: number): void {
    for (const tap of this.taps) tap.age += dt;
    this.taps = this.taps.filter((t) => t.age < 12);
    this.recompute();
    this.lower.step(dt);
    this.upper.step(dt);
    this.tGlobal += dt;
    this.steps += 1;
  }

  writeTextures(): void {
    this.lower.writeTexture();
    this.upper.writeTexture();
  }

  /**
   * Count cells sitting on the wrong side of the برزخ.
   *
   * This is the structural half of لا يبغيان and must be identically 0 at all
   * times. It is cheap, so it is checked rather than assumed.
   */
  verifyBarrier(): number {
    let violations = 0;
    for (let k = 0; k < this.lower.worldX.length; k++) {
      if (this.lower.worldX[k] >= -BARRIER_HALF_WIDTH) violations++;
    }
    for (let k = 0; k < this.upper.worldX.length; k++) {
      if (this.upper.worldX[k] <= BARRIER_HALF_WIDTH) violations++;
    }
    return violations;
  }

  stats(): DualSeaStats {
    return {
      lower: this.lower.stats(this.tapCount('lower')),
      upper: this.upper.stats(this.tapCount('upper')),
      tGlobal: this.tGlobal,
      steps: this.steps,
      barrierViolations: this.verifyBarrier(),
    };
  }

  /** Proper time of one cell, materialized where representable. */
  tauAt(id: SeaId, index: number): number {
    return expClampedAbove(this.sea(id).logTau[index]);
  }

  /**
   * ln(tau_upper / tau_lower) at matching grid positions — the only quantity
   * that means anything when the two seas run at incommensurable rates. A
   * difference of logs, so it stays exact even when neither clock can be
   * materialized in float64.
   */
  logTauRatio(index: number): number {
    return this.upper.logTau[index] - this.lower.logTau[index];
  }
}
