/**
 * IsnaadEngine — the six-dimensional vector array.
 *
 *   [L1] إسناد الأمر والتشغيل        Divine source vector — programmatic trigger
 *          │
 *          ▼
 *   [L2] إسناد الصوت والربط          Vocal anchor — FFT drives every shader
 *          ├───────────────┐
 *          ▼               ▼
 *   [L3] الهدف المادي   [L5] المستمع غير المرئي
 *          └───────┬───────┘
 *                  ▼
 *   [L6] الصدى الغيبي / الدارة المغلقة   (رد السلام)
 *                  ▼
 *   [L4] الشاهد الأرضي               Observer camera state
 *
 * Every ayah execution recomputes all six coordinates each frame. L3 and L5 are
 * children of L2 (they cannot exist without a live vocal anchor), L6 closes over
 * both of them, and L4 is the only vector the user drives directly — it feeds
 * back into L6 because the observer's orientation determines what of the closed
 * loop is actually witnessed.
 */

import type { AudioFrame } from '@/audio/AudioFrame';
import type { Phenomenon } from '@/data/phenomena';

export const VECTOR_LABELS: readonly string[] = [
  'إسناد الأمر والتشغيل',
  'إسناد الصوت والربط',
  'إسناد الهدف المادي',
  'إسناد الشاهد الأرضي',
  'إسناد المستمع غير المرئي',
  'إسناد الصدى الغيبي',
];

export const VECTOR_SIGILS: readonly string[] = ['ل١', 'ل٢', 'ل٣', 'ل٤', 'ل٥', 'ل٦'];

export interface ObserverState {
  /** Camera distance from the crystal core, normalised 0..1 (0 = at the core). */
  proximity: number;
  /** How directly the camera faces the core, 0..1. */
  alignment: number;
  /** Angular velocity of the observer, 0..1 — motion dilutes witnessing. */
  agitation: number;
}

export interface IsnaadSnapshot {
  /** Packed [L1..L6] for direct upload as a shader uniform. */
  vector: Float32Array;
  l1: number;
  l2: number;
  l3: number;
  l4: number;
  l5: number;
  l6: number;
  /** Impulse fired once the verse's execution loop closes; decays to 0. */
  closure: number;
  /** True between verse-start and verse-end. */
  executing: boolean;
  /** Total ayat executed this session. */
  executions: number;
}

const DELAY_SLOTS = 48; // ~0.8s of L2 history at 60fps, the L5 propagation lag

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function smooth(current: number, target: number, tau: number, dt: number): number {
  const k = 1 - Math.exp(-dt / Math.max(tau, 1e-4));
  return current + (target - current) * k;
}

export class IsnaadEngine {
  readonly snapshot: IsnaadSnapshot = {
    vector: new Float32Array(6),
    l1: 0,
    l2: 0,
    l3: 0,
    l4: 0,
    l5: 0,
    l6: 0,
    closure: 0,
    executing: false,
    executions: 0,
  };

  private observer: ObserverState = { proximity: 0.6, alignment: 1, agitation: 0 };
  private delayLine = new Float32Array(DELAY_SLOTS);
  private delayCursor = 0;
  private trigger = 0;
  private closureImpulse = 0;
  private weights: Phenomenon['isnaadWeights'] = [1, 1, 1, 1, 1, 1];

  /** L1 — the programmatic trigger that initiates the spatial geometry state. */
  beginExecution(): void {
    this.trigger = 1;
    this.snapshot.executing = true;
    this.snapshot.executions += 1;
  }

  /** L6 — رد السلام: the loop closes and the field expands once, then settles. */
  closeExecution(): void {
    this.trigger = 0;
    this.snapshot.executing = false;
    this.closureImpulse = 1;
  }

  haltExecution(): void {
    this.trigger = 0;
    this.snapshot.executing = false;
  }

  /** L4 — pushed by the viewport each frame from the live camera transform. */
  setObserver(state: ObserverState): void {
    this.observer = state;
  }

  setPhenomenonWeights(weights: Phenomenon['isnaadWeights']): void {
    this.weights = weights;
  }

  update(frame: AudioFrame): IsnaadSnapshot {
    const dt = frame.dt || 1 / 60;
    const s = this.snapshot;
    const w = this.weights;

    // L1 — command vector. Held while an ayah is executing, released on closure.
    const l1Target = this.trigger * (0.55 + 0.45 * clamp01(frame.level * 1.6));
    s.l1 = smooth(s.l1, l1Target * w[0], 0.22, dt);

    // L2 — the vocal anchor. Loudness carries the body, brightness the edge.
    const vocal = clamp01(frame.level * 0.68 + frame.peak * 0.22 + frame.centroid * 0.28);
    s.l2 = smooth(s.l2, vocal * w[1] * (0.25 + 0.75 * s.l1), 0.045, dt);

    // Feed the propagation delay line that L5 reads from.
    this.delayLine[this.delayCursor] = s.l2;
    this.delayCursor = (this.delayCursor + 1) % DELAY_SLOTS;
    const delayed = this.delayLine[(this.delayCursor + 1) % DELAY_SLOTS];

    // L3 — materialisation of the described object. Mass lives in the low bands.
    const material = clamp01(frame.bass * 0.55 + frame.lowMid * 0.35 + frame.subBass * 0.4);
    s.l3 = smooth(s.l3, material * w[2] * (0.2 + 0.8 * s.l2), 0.12, dt);

    // L4 — the terrestrial observer. Witnessing is strongest when still, aligned
    // and at a contemplative distance rather than pressed against the glass.
    const stillness = 1 - clamp01(this.observer.agitation);
    const stance = 1 - Math.abs(this.observer.proximity - 0.55) * 1.6;
    const witness = clamp01(this.observer.alignment * 0.5 + stillness * 0.25 + clamp01(stance) * 0.25);
    s.l4 = smooth(s.l4, witness * w[3], 0.3, dt);

    // L5 — the unseen audience. Reacts to the delayed anchor, biased to the
    // frequencies a terrestrial listener attends to least.
    const spectral = clamp01(delayed * 0.7 + frame.treble * 0.5 + frame.flux * 0.35);
    s.l5 = smooth(s.l5, spectral * w[4] * (0.15 + 0.85 * s.l1), 0.2, dt);

    // L6 — the closed circuit. Builds as the verse completes, then discharges.
    this.closureImpulse = smooth(this.closureImpulse, 0, 0.55, dt);
    const anticipation = s.executing ? Math.pow(clamp01(frame.progress), 3) : 0;
    const echo = clamp01(anticipation * 0.55 + this.closureImpulse * 0.9);
    s.l6 = smooth(s.l6, clamp01(echo * (0.4 + 0.6 * s.l4)) * w[5], 0.15, dt);
    s.closure = this.closureImpulse;

    s.vector[0] = s.l1;
    s.vector[1] = s.l2;
    s.vector[2] = s.l3;
    s.vector[3] = s.l4;
    s.vector[4] = s.l5;
    s.vector[5] = s.l6;

    return s;
  }
}

export const isnaadEngine = new IsnaadEngine();
