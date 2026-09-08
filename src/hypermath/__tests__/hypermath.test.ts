/**
 * Verification for the QuranSpace hyper-math merge.
 *
 * These are ports of the checks that the Python engine
 * (tri-reality-os/sandbox-lower) runs against closed forms. Each one compares
 * against an INDEPENDENT source of truth — an exact formula, a different code
 * path, or a control run — never against this code's own output.
 */
import { describe, it, expect } from 'vitest';

import { logaddexp, expClampedAbove, wrapPhase, LOG_FLOAT64_MAX } from '../logspace';
import {
  conformalInversion2D, inversionConformalFactor, inversionFixedRadius,
  ricciScalarSphere,
} from '../conformal';
import { CRITICAL_LAMBDA, Phase, SiteStatus, logRateAt, phaseOf, DEFAULT_DILATION } from '../dilation';
import { DualSeaContinuum, BARRIER_HALF_WIDTH } from '../DualSea';

describe('log-space arithmetic', () => {
  it('logaddexp matches direct arithmetic where direct still works', () => {
    for (const [a, b] of [[0, 0], [1, 2], [-5, 3], [10, 10.5]]) {
      expect(logaddexp(a, b)).toBeCloseTo(Math.log(Math.exp(a) + Math.exp(b)), 12);
    }
  });

  it('logaddexp survives where direct arithmetic overflows', () => {
    // exp(800) is Infinity, so ln(exp(800) + exp(799)) is NaN if done directly.
    const direct = Math.log(Math.exp(800) + Math.exp(799));
    expect(Number.isFinite(direct)).toBe(false);
    const viaLog = logaddexp(800, 799);
    expect(Number.isFinite(viaLog)).toBe(true);
    expect(viaLog).toBeCloseTo(800 + Math.log1p(Math.exp(-1)), 10);
  });

  it('a frozen clock (-Infinity) contributes exactly nothing', () => {
    expect(logaddexp(-Infinity, -Infinity)).toBe(-Infinity);
    expect(logaddexp(5, -Infinity)).toBe(5);
    expect(logaddexp(-Infinity, 5)).toBe(5);
  });

  it('expClampedAbove returns EXACTLY zero for a stopped clock', () => {
    // Regression: clamping the lower end too would give 5e-309, a clock that creeps.
    expect(expClampedAbove(-Infinity)).toBe(0);
    expect(expClampedAbove(-1e6)).toBe(0);
    expect(Number.isFinite(expClampedAbove(1e6))).toBe(true);
    expect(expClampedAbove(1e6)).toBe(Math.exp(LOG_FLOAT64_MAX));
  });

  it('wrapPhase lands in (-pi, pi]', () => {
    for (const p of [0, Math.PI, 10 * Math.PI, -37.5, 1e6]) {
      expect(Math.abs(wrapPhase(p))).toBeLessThanOrEqual(Math.PI + 1e-12);
    }
  });
});

describe('conformal geometry', () => {
  it('radial inversion is an involution for every lambda', () => {
    for (const lambda of [0.5, 1, 3, 3.5, 40]) {
      for (const p of [{ x: 1, y: 0 }, { x: -0.3, y: 0.7 }, { x: 2.5, y: -1.25 }]) {
        const back = conformalInversion2D(conformalInversion2D(p, lambda), lambda);
        expect(back.x).toBeCloseTo(p.x, 12);
        expect(back.y).toBeCloseTo(p.y, 12);
      }
    }
  });

  it('inversion maps the unit circle to radius 1/lambda', () => {
    for (const lambda of [0.7, 3, 3.5, 12]) {
      const p = { x: Math.cos(0.9), y: Math.sin(0.9) };
      const q = conformalInversion2D(p, lambda);
      expect(Math.hypot(q.x, q.y)).toBeCloseTo(1 / lambda, 12);
    }
  });

  it('inversion exchanges interior and exterior about 1/sqrt(lambda)', () => {
    const lambda = 3.5;
    const pivot = inversionFixedRadius(lambda);
    const inner = conformalInversion2D({ x: pivot / 10, y: 0 }, lambda);
    const outer = conformalInversion2D({ x: pivot * 10, y: 0 }, lambda);
    expect(Math.hypot(inner.x, inner.y)).toBeGreaterThan(pivot);
    expect(Math.hypot(outer.x, outer.y)).toBeLessThan(pivot);
    // The pivot radius is genuinely fixed.
    const onPivot = conformalInversion2D({ x: pivot, y: 0 }, lambda);
    expect(Math.hypot(onPivot.x, onPivot.y)).toBeCloseTo(pivot, 12);
  });

  it('the origin raises rather than returning Infinity', () => {
    expect(() => conformalInversion2D({ x: 0, y: 0 }, 3.5)).toThrow(/singular/);
    expect(() => conformalInversion2D({ x: 1, y: 0 }, 0)).toThrow(/lambda/);
  });

  it('conformal factor agrees with the measured length scaling', () => {
    const lambda = 2.5;
    const p = { x: 0.8, y: 0.6 };            // r = 1
    const h = 1e-7;
    const q = { x: p.x + h, y: p.y };
    const dp = conformalInversion2D(p, lambda);
    const dq = conformalInversion2D(q, lambda);
    const measured = Math.hypot(dq.x - dp.x, dq.y - dp.y) / h;
    expect(measured).toBeCloseTo(inversionConformalFactor(1, lambda), 6);
  });

  it('Ricci scalar of the unit N-sphere is exactly N(N-1) at every radius', () => {
    // Relative, not absolute: at N=200, r=40 the intermediate (1+r^2)^2 is
    // ~2.6e6, so an absolute tolerance would be measuring float exponent range
    // rather than the correctness of the formula.
    for (const N of [2, 3, 7, 25, 200]) {
      for (const r of [0, 0.4, 1, 2.5, 40]) {
        const want = N * (N - 1);
        const got = ricciScalarSphere(r, N);
        expect(Math.abs(got - want) / want).toBeLessThan(1e-11);
      }
    }
  });
});

describe('three-phase clock lifecycle', () => {
  it('classifies the lambda sweep', () => {
    expect(phaseOf(1.0)).toBe(Phase.SubCritical);
    expect(phaseOf(2.9)).toBe(Phase.SubCritical);
    expect(phaseOf(CRITICAL_LAMBDA)).toBe(Phase.Collapse);
    expect(phaseOf(3.01)).toBe(Phase.Collapse);
    expect(phaseOf(3.5)).toBe(Phase.SuperCritical);
  });

  it('phase A runs every clock at exactly 1', () => {
    const p = { ...DEFAULT_DILATION, lambda: 2.0 };
    for (const r of [0.01, 0.5, 5]) {
      const { logRate, status } = logRateAt(r, 0.9, p);
      expect(logRate).toBe(0);
      expect(status).toBe(SiteStatus.Ok);
    }
  });

  it('phase B stops dense clocks dead and leaves sparse ones untouched', () => {
    const p = { ...DEFAULT_DILATION, lambda: 3.0, rhoCritical: 0.5 };
    expect(logRateAt(0.5, 0.9, p).logRate).toBe(-Infinity);
    expect(logRateAt(0.5, 0.9, p).status).toBe(SiteStatus.Frozen);
    expect(logRateAt(0.5, 0.1, p).logRate).toBe(0);
  });

  it('phase C matches lambda(1/r^2 - 1/r_ref^2) and is 1 at the reference', () => {
    const p = { ...DEFAULT_DILATION, lambda: 3.5, referenceRadius: 1.0 };
    expect(logRateAt(1.0, 0, p).logRate).toBeCloseTo(0, 12);
    expect(logRateAt(0.5, 0, p).logRate).toBeCloseTo(3.5 * (4 - 1), 12);
    // Strictly monotone inward.
    const rates = [1.0, 0.5, 0.2, 0.1].map((r) => logRateAt(r, 0, p).logRate);
    for (let i = 1; i < rates.length; i++) expect(rates[i]).toBeGreaterThan(rates[i - 1]);
  });

  it('phase C survives radii where a direct exp() is destroyed', () => {
    const p = { ...DEFAULT_DILATION, lambda: 3.5, referenceRadius: 1.0, minRadius: 1e-9 };
    for (const r of [0.06, 0.01, 1e-4]) {
      const { logRate } = logRateAt(r, 0, p);
      expect(Number.isFinite(logRate)).toBe(true);
      expect(Math.exp(3.5 / (r * r))).toBe(Infinity);   // the naive encoding dies
      expect(logRate).toBeGreaterThan(LOG_FLOAT64_MAX); // and this one does not
    }
  });
});

describe('مرج البحرين — two seas meeting at a برزخ', () => {
  it('no cell of either sea ever sits on the wrong side', () => {
    const c = new DualSeaContinuum(48, 48);
    expect(c.verifyBarrier()).toBe(0);
    c.setLambda('lower', 3.5);
    c.setLambda('upper', 1.2);
    for (let i = 0; i < 50; i++) c.step(0.01);
    expect(c.verifyBarrier()).toBe(0);
    expect(Math.abs(c.lower.worldX[0])).toBeGreaterThan(BARRIER_HALF_WIDTH);
    expect(Math.abs(c.upper.worldX[0])).toBeGreaterThan(BARRIER_HALF_WIDTH);
  });

  it('the two seas hold different phases at the same instant', () => {
    const c = new DualSeaContinuum(32, 32);
    c.setLambda('lower', 1.0);      // uniform
    c.setLambda('upper', 3.5);      // racing inward
    for (let i = 0; i < 20; i++) c.step(0.01);
    const s = c.stats();
    expect(s.lower.phase).toBe(Phase.SubCritical);
    expect(s.upper.phase).toBe(Phase.SuperCritical);
    expect(s.upper.logRateMax).toBeGreaterThan(s.lower.logRateMax);
  });

  it('لا يبغيان: agitating one sea leaves the other BIT-IDENTICAL', () => {
    // The isolation witness. A control run with no taps, and a run where the
    // lower sea is hammered — the upper sea's proper times must match exactly,
    // bit for bit, not merely closely.
    const control = new DualSeaContinuum(48, 48);
    const agitated = new DualSeaContinuum(48, 48);
    for (const c of [control, agitated]) {
      c.setLambda('lower', 3.5);
      c.setLambda('upper', 2.0);
    }
    for (let i = 0; i < 40; i++) {
      if (i % 4 === 0) agitated.tap(-0.3 - i * 0.01, 0.2 - i * 0.005, 1.5);
      control.step(0.01);
      agitated.step(0.01);
    }

    // The lower sea MUST have been changed by the taps, or the test is vacuous.
    let lowerDiffers = false;
    for (let k = 0; k < control.lower.logTau.length; k++) {
      if (control.lower.logTau[k] !== agitated.lower.logTau[k]) { lowerDiffers = true; break; }
    }
    expect(lowerDiffers).toBe(true);
    expect(agitated.tapCount('lower')).toBeGreaterThan(0);

    // ...and the upper sea must be untouched, exactly.
    for (let k = 0; k < control.upper.logTau.length; k++) {
      expect(agitated.upper.logTau[k]).toBe(control.upper.logTau[k]);
    }
    expect(agitated.tapCount('upper')).toBe(0);
  });

  it('a tap inside the برزخ is refused — nothing exists there', () => {
    const c = new DualSeaContinuum(24, 24);
    expect(c.tap(0, 0.5)).toBeNull();
    expect(c.tap(BARRIER_HALF_WIDTH * 0.5, 0)).toBeNull();
    expect(c.tap(-0.5, 0)).toBe('lower');
    expect(c.tap(0.5, 0)).toBe('upper');
  });

  it('phase A is a conservation law: every clock reads exactly t_global', () => {
    const c = new DualSeaContinuum(24, 24);
    c.setLambda('lower', 1.5);
    c.setLambda('upper', 1.5);
    for (let i = 0; i < 100; i++) c.step(0.01);
    for (let k = 0; k < c.lower.logTau.length; k++) {
      expect(c.tauAt('lower', k)).toBeCloseTo(1.0, 10);
      expect(c.tauAt('upper', k)).toBeCloseTo(1.0, 10);
    }
  });

  it('a super-critical sea reports proper times beyond float64 without NaN', () => {
    const c = new DualSeaContinuum(32, 32);
    c.setLambda('upper', 3.6);
    c.tap(0.12, 0.0, 3.0);            // a deep clock well near the barrier
    for (let i = 0; i < 30; i++) c.step(0.005);
    const s = c.stats();
    expect(s.upper.phase).toBe(Phase.SuperCritical);
    expect(s.upper.exceedsFloat64).toBe(true);
    expect(Number.isFinite(s.upper.logTauMax)).toBe(true);
    for (let k = 0; k < c.upper.logTau.length; k++) {
      expect(Number.isNaN(c.upper.logTau[k])).toBe(false);
    }
  });

  it('the clock ratio between seas stays exact when neither can be materialized', () => {
    const c = new DualSeaContinuum(16, 16);
    c.setLambda('lower', 3.5);
    c.setLambda('upper', 3.5);
    for (let i = 0; i < 10; i++) c.step(0.01);
    const k = 0;
    const ratio = c.logTauRatio(k);
    expect(Number.isFinite(ratio)).toBe(true);
    // Identical lambdas and mirrored geometry => the seas keep the same time.
    expect(ratio).toBeCloseTo(0, 9);
  });

  it('GPU texture payload is finite and normalized in every phase', () => {
    for (const lambda of [1.0, 3.0, 3.6]) {
      const c = new DualSeaContinuum(32, 32);
      c.setLambda('lower', lambda);
      c.setLambda('upper', lambda);
      c.tap(-0.4, 0.1, 2.0);
      for (let i = 0; i < 15; i++) c.step(0.01);
      c.writeTextures();
      for (const sea of [c.lower, c.upper]) {
        for (let i = 0; i < sea.texture.length; i++) {
          const v = sea.texture[i];
          expect(Number.isFinite(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1.000001);
        }
      }
    }
  });
});
