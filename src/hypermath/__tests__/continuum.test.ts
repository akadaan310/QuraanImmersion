/**
 * The pulsation driver: no controls, so everything must be provably derived
 * from the recitation. These tests drive the audio frame and the Isnaad array
 * directly — the same objects EngineDriver writes — and assert what the seas do.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import { audioEngine } from '@/audio/AudioEngine';
import { isnaadEngine } from '@/engine/isnaad/IsnaadEngine';
import { advanceContinuum, continuum, continuumStats, drivenLambda } from '../continuum';
import { Phase } from '../dilation';
import { CRITICAL_LAMBDA } from '../dilation';

/** Silence: every band at zero, no onset. */
function silence(): void {
  const f = audioEngine.frame;
  f.level = 0; f.peak = 0; f.transient = 0; f.flux = 0; f.centroid = 0;
  f.subBass = 0; f.bass = 0; f.lowMid = 0; f.mid = 0; f.highMid = 0; f.treble = 0;
  f.playing = false; f.progress = 0;
  const s = isnaadEngine.snapshot;
  s.l1 = 0; s.l2 = 0; s.l3 = 0; s.l4 = 0; s.l5 = 0; s.l6 = 0; s.closure = 0;
}

/** Drive the continuum to steady state; lambda smooths with tau = 0.45 s. */
function settle(seconds = 4, dt = 1 / 60): void {
  for (let i = 0; i < Math.round(seconds / dt); i += 1) advanceContinuum(dt);
}

describe('pulsation driver — no controls', () => {
  beforeEach(() => {
    silence();
    continuum.clearTaps();
  });

  it('rests sub-critical when there is no recitation', () => {
    settle(4);
    const l = drivenLambda();
    expect(l.lower).toBeLessThan(CRITICAL_LAMBDA);
    expect(l.upper).toBeLessThan(CRITICAL_LAMBDA);
    const s = continuumStats();
    expect(s.lower.phase).toBe(Phase.SubCritical);
    expect(s.upper.phase).toBe(Phase.SubCritical);
  });

  it('the terrestrial half drives the LOWER sea past the threshold alone', () => {
    // L1 (command) and L3 (materialisation) belong to the lower sea; L2/L5/L6
    // belong to the upper. Loading only the first pair must move only that sea.
    const s = isnaadEngine.snapshot;
    s.l1 = 1; s.l3 = 1;
    audioEngine.frame.bass = 0.8;
    settle(5);

    const l = drivenLambda();
    expect(l.lower).toBeGreaterThan(CRITICAL_LAMBDA);
    expect(l.upper).toBeLessThan(CRITICAL_LAMBDA);
    expect(continuumStats().lower.phase).toBe(Phase.SuperCritical);
    expect(continuumStats().upper.phase).toBe(Phase.SubCritical);
  });

  it('the unseen half drives the UPPER sea past the threshold alone', () => {
    const s = isnaadEngine.snapshot;
    s.l2 = 1; s.l5 = 1; s.l6 = 1;
    audioEngine.frame.treble = 0.8;
    settle(5);

    const l = drivenLambda();
    expect(l.upper).toBeGreaterThan(CRITICAL_LAMBDA);
    expect(l.lower).toBeLessThan(CRITICAL_LAMBDA);
  });

  it('onsets open clock wells; silence opens none', () => {
    const before = continuumStats();
    expect(before.lower.taps + before.upper.taps).toBe(0);

    settle(1);
    expect(continuumStats().lower.taps + continuumStats().upper.taps).toBe(0);

    // A sustained onset above threshold, spaced past the interval floor.
    audioEngine.frame.transient = 0.9;
    audioEngine.frame.level = 0.6;
    audioEngine.frame.centroid = 0.5;
    audioEngine.frame.bass = 0.9;      // low-dominant => the lower sea receives it
    for (let i = 0; i < 60; i += 1) {
      advanceContinuum(1 / 60);
      // performance.now() advances in real time; give the interval floor room.
      const t0 = performance.now();
      while (performance.now() - t0 < 3) { /* spin briefly */ }
    }
    const after = continuumStats();
    expect(after.lower.taps).toBeGreaterThan(0);
  });

  it('low-dominant onsets sink to the lower sea, high-dominant rise to the upper', () => {
    audioEngine.frame.transient = 0.9;
    audioEngine.frame.level = 0.5;
    audioEngine.frame.treble = 0.95;
    audioEngine.frame.highMid = 0.8;
    audioEngine.frame.mid = 0.7;       // high-dominant
    for (let i = 0; i < 40; i += 1) {
      advanceContinuum(1 / 60);
      const t0 = performance.now();
      while (performance.now() - t0 < 4) { /* spin */ }
    }
    const s = continuumStats();
    expect(s.upper.taps).toBeGreaterThan(0);
  });

  it('the برزخ holds through a full pulsation sweep', () => {
    // Sweep both seas across all three phases while hammering with onsets.
    for (let step = 0; step <= 40; step += 1) {
      const drive = step / 40;
      const s = isnaadEngine.snapshot;
      s.l1 = drive; s.l3 = drive; s.l2 = drive; s.l5 = drive; s.l6 = drive;
      const f = audioEngine.frame;
      f.bass = drive; f.treble = drive; f.level = drive;
      f.transient = step % 3 === 0 ? 0.9 : 0;
      f.centroid = (step % 7) / 7;
      for (let i = 0; i < 10; i += 1) advanceContinuum(1 / 60);
      expect(continuum.verifyBarrier()).toBe(0);
    }
    expect(continuumStats().barrierViolations).toBe(0);
  });

  it('proper times stay finite and NaN-free across the whole sweep', () => {
    const s = isnaadEngine.snapshot;
    s.l1 = 1; s.l2 = 1; s.l3 = 1; s.l5 = 1; s.l6 = 1;
    audioEngine.frame.level = 0.9;
    audioEngine.frame.bass = 0.9;
    audioEngine.frame.treble = 0.9;
    settle(6);

    for (const sea of [continuum.lower, continuum.upper]) {
      for (let k = 0; k < sea.logTau.length; k += 1) {
        expect(Number.isNaN(sea.logTau[k])).toBe(false);
      }
    }
    const stats = continuumStats();
    expect(Number.isFinite(stats.lower.logTauMax)).toBe(true);
    expect(Number.isFinite(stats.upper.logTauMax)).toBe(true);
  });
});
