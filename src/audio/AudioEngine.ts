/**
 * AudioEngine — the single Web Audio graph for the whole application.
 *
 *   <audio crossorigin=anonymous>            (one element for the page lifetime;
 *        │                                    a MediaElementSource may only be
 *        ▼                                    created once per element)
 *   MediaElementSource ─► BiquadFilter(lowpass) ─► Gain ─► Analyser ─► destination
 *                                  ▲                          │
 *                       onboarding sweep                      ▼
 *                                                       AudioFrame → GLSL uniforms
 *
 * The analyser is the L2 vocal anchor of the Isnaad array: every shader parameter
 * in the engine is ultimately a function of what this node measured this frame.
 */

import { createEmptyFrame, type AudioFrame } from './AudioFrame';
import {
  rememberRoute,
  resolveAyahCandidates,
  prefetchAyah,
  type AyahAudioCandidate,
} from '@/services/QuranAudioService';
import type { ReciterId } from '@/data/reciters';
import { nextVerse } from '@/data/surahs';

const FFT_SIZE = 2048;

/** How far behind an ayah's start the playhead may drift before it is re-seeked. */
const SEEK_TOLERANCE = 0.25;

/**
 * When one ayah hands off to the next inside the SAME stream, the playhead is
 * already sitting on the new ayah's start. Seeking there anyway forces the media
 * element to re-buffer, which stalls playback for longer than the drift it
 * corrects — so a playhead this close to the start is accepted as-is and the
 * handoff stays gapless.
 */
const CONTIGUOUS_TOLERANCE = 0.5;

export type EngineEvent =
  | { type: 'verse-start'; surah: number; ayah: number; reciter: ReciterId; provider: string }
  | { type: 'verse-end'; surah: number; ayah: number }
  | { type: 'state'; playing: boolean }
  | { type: 'route-failed'; surah: number; ayah: number; reciter: ReciterId }
  | { type: 'error'; message: string };

type Listener = (event: EngineEvent) => void;

interface BandRange {
  lo: number;
  hi: number;
}

const BANDS: Record<'subBass' | 'bass' | 'lowMid' | 'mid' | 'highMid' | 'treble', BandRange> = {
  subBass: { lo: 20, hi: 60 },
  bass: { lo: 60, hi: 250 },
  lowMid: { lo: 250, hi: 500 },
  mid: { lo: 500, hi: 2000 },
  highMid: { lo: 2000, hi: 4000 },
  treble: { lo: 4000, hi: 14000 },
};

/** One-pole smoothing that is frame-rate independent. */
function smooth(current: number, target: number, tau: number, dt: number): number {
  const k = 1 - Math.exp(-dt / Math.max(tau, 1e-4));
  return current + (target - current) * k;
}

export class AudioEngine {
  readonly frame: AudioFrame;

  private ctx: AudioContext | null = null;
  private element: HTMLAudioElement | null = null;
  private source: MediaElementAudioSourceNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private gain: GainNode | null = null;
  private analyser: AnalyserNode | null = null;

  private listeners = new Set<Listener>();
  private lastAnalysis = 0;
  private previousSpectrum: Float32Array;
  private loopVerse = false;
  private autoAdvance = true;

  private current: { surah: number; ayah: number; reciter: ReciterId } | null = null;
  private candidates: AyahAudioCandidate[] = [];
  private candidateIndex = 0;
  /** Guards against a stale load resolving after the user moved on. */
  private loadToken = 0;

  /** URL currently attached to the element; re-assigning `src` would reload it. */
  private loadedUrl: string | null = null;
  /**
   * Set when the ayah is a span of a longer stream. Playback is bounded to it and
   * `progress` is reported relative to the span, not to the whole file.
   */
  private activeWindow: { startSec: number; endSec: number } | null = null;
  /**
   * Timer that closes a timed ayah at its exact end. Boundary detection must not
   * ride the render loop: a heavy scene can stretch a frame to hundreds of
   * milliseconds, and the observer would hear the next ayah begin inside this one.
   */
  private boundaryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.frame = createEmptyFrame(FFT_SIZE / 2, FFT_SIZE);
    this.previousSpectrum = new Float32Array(FFT_SIZE / 2);
  }

  /* -------------------------------------------------------------- graph --- */

  /** Must be called from a user gesture: browsers block AudioContext otherwise. */
  async unlock(): Promise<void> {
    this.ensureGraph();
    if (this.ctx && this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
  }

  get ready(): boolean {
    return this.ctx != null && this.ctx.state === 'running';
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  private ensureGraph(): void {
    if (this.ctx) return;

    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor();

    const element = new Audio();
    element.crossOrigin = 'anonymous';
    element.preload = 'auto';
    element.loop = false;

    const source = ctx.createMediaElementSource(element);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 20000;
    filter.Q.value = 0.7;

    const gain = ctx.createGain();
    gain.gain.value = 0.9;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = FFT_SIZE;
    analyser.smoothingTimeConstant = 0.72;
    analyser.minDecibels = -95;
    analyser.maxDecibels = -12;

    source.connect(filter);
    filter.connect(gain);
    gain.connect(analyser);
    analyser.connect(ctx.destination);

    element.addEventListener('ended', () => this.handleEnded());
    element.addEventListener('error', () => this.handleElementError());
    element.addEventListener('playing', () => {
      this.scheduleBoundary();
      this.emit({ type: 'state', playing: true });
    });
    element.addEventListener('pause', () => {
      this.clearBoundary();
      this.emit({ type: 'state', playing: false });
    });
    // A seek or a rate change invalidates the pending boundary deadline.
    element.addEventListener('seeked', () => this.scheduleBoundary());
    element.addEventListener('ratechange', () => this.scheduleBoundary());

    this.ctx = ctx;
    this.element = element;
    this.source = source;
    this.filter = filter;
    this.gain = gain;
    this.analyser = analyser;
  }

  /* ------------------------------------------------------------ listeners -- */

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: EngineEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  /* -------------------------------------------------------------- verses -- */

  /**
   * Load and play one ayah. Candidates are tried in order until one produces
   * audio; the winner is memoised so subsequent ayat resolve in a single request.
   */
  async playVerse(reciter: ReciterId, surah: number, ayah: number): Promise<void> {
    await this.unlock();
    if (!this.element) return;

    const token = ++this.loadToken;
    this.current = { reciter, surah, ayah };
    this.candidates = await resolveAyahCandidates(reciter, { surah, ayah });
    if (token !== this.loadToken) return;

    if (!this.candidates.length) {
      this.emit({ type: 'route-failed', surah, ayah, reciter });
      return;
    }

    this.candidateIndex = 0;
    await this.attachCandidate(token);
  }

  private async attachCandidate(token: number): Promise<void> {
    if (!this.element || !this.current) return;
    if (token !== this.loadToken) return;

    const candidate = this.candidates[this.candidateIndex];
    if (!candidate) {
      const { surah, ayah, reciter } = this.current;
      this.emit({ type: 'route-failed', surah, ayah, reciter });
      return;
    }

    // Stepping between ayat of the same timed stream must not reload the file:
    // the next verse is already buffered a few seconds ahead of the playhead.
    const sameStream = this.loadedUrl === candidate.url;
    if (!sameStream) {
      this.loadedUrl = candidate.url;
      this.element.src = candidate.url;
    }

    this.activeWindow = candidate.window ?? null;

    try {
      if (candidate.window) {
        const drift = this.element.currentTime - candidate.window.startSec;
        const contiguous = sameStream && drift >= 0 && drift <= CONTIGUOUS_TOLERANCE;
        if (!contiguous) {
          await this.seekWithinWindow(candidate.window.startSec);
          if (token !== this.loadToken) return;
        }
      }
      await this.element.play();
      if (token !== this.loadToken) return;
      this.scheduleBoundary();
      const { surah, ayah, reciter } = this.current;
      rememberRoute(reciter, candidate.routeKey);
      this.emit({ type: 'verse-start', surah, ayah, reciter, provider: candidate.provider });
      const upcoming = nextVerse(surah, ayah);
      if (upcoming) void prefetchAyah(reciter, upcoming);
    } catch {
      if (token !== this.loadToken) return;
      this.loadedUrl = null;
      this.candidateIndex += 1;
      await this.attachCandidate(token);
    }
  }

  private clearBoundary(): void {
    if (this.boundaryTimer !== null) {
      clearTimeout(this.boundaryTimer);
      this.boundaryTimer = null;
    }
  }

  /**
   * Arm a timer for the moment the playhead should reach the ayah's end. If the
   * stream stalls, the timer fires early, finds the playhead short, and re-arms
   * from the new position — so buffering delays the boundary instead of
   * truncating the verse.
   */
  private scheduleBoundary(): void {
    this.clearBoundary();
    const element = this.element;
    const span = this.activeWindow;
    if (!element || !span || element.paused) return;

    const rate = element.playbackRate || 1;
    const remainingMs = ((span.endSec - element.currentTime) / rate) * 1000;

    this.boundaryTimer = setTimeout(() => {
      this.boundaryTimer = null;
      const current = this.element;
      const active = this.activeWindow;
      if (!current || !active) return;
      if (current.currentTime >= active.endSec - 0.02) this.handleWindowBoundary();
      else this.scheduleBoundary();
    }, Math.max(remainingMs, 8));
  }

  /** True once the element reports a seekable range that contains `seconds`. */
  private canSeekTo(seconds: number): boolean {
    const element = this.element;
    if (!element) return false;
    const ranges = element.seekable;
    for (let i = 0; i < ranges.length; i += 1) {
      if (seconds >= ranges.start(i) && seconds <= ranges.end(i)) return true;
    }
    return false;
  }

  /** Seeking is only legal once the element knows its duration. */
  private seekWithinWindow(startSec: number): Promise<void> {
    const element = this.element;
    if (!element) return Promise.resolve();

    if (element.readyState >= 1) {
      element.currentTime = startSec;
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const onReady = () => {
        cleanup();
        try {
          element.currentTime = startSec;
          resolve();
        } catch (error) {
          reject(error as Error);
        }
      };
      const onFail = () => {
        cleanup();
        reject(new Error('stream failed before metadata'));
      };
      const cleanup = () => {
        element.removeEventListener('loadedmetadata', onReady);
        element.removeEventListener('error', onFail);
      };
      element.addEventListener('loadedmetadata', onReady, { once: true });
      element.addEventListener('error', onFail, { once: true });
    });
  }

  /**
   * A timed ayah has no 'ended' event — its boundary is a timestamp. Checked from
   * the analysis loop, which runs every frame and so lands the boundary within
   * one frame rather than the ~4Hz of 'timeupdate'.
   */
  private handleWindowBoundary(): void {
    if (!this.current) return;
    const { surah, ayah, reciter } = this.current;

    // Clear first: the async resolve below must not re-enter this boundary.
    this.activeWindow = null;
    this.clearBoundary();
    this.emit({ type: 'verse-end', surah, ayah });

    if (this.loopVerse) {
      void this.playVerse(reciter, surah, ayah);
      return;
    }
    if (this.autoAdvance) {
      const upcoming = nextVerse(surah, ayah);
      if (upcoming) {
        // Same stream: playback continues uninterrupted across the boundary.
        void this.playVerse(reciter, upcoming.surah, upcoming.ayah);
        return;
      }
    }
    this.element?.pause();
  }

  private handleElementError(): void {
    if (!this.current) return;
    this.candidateIndex += 1;
    void this.attachCandidate(this.loadToken);
  }

  private handleEnded(): void {
    if (!this.current) return;
    const { surah, ayah, reciter } = this.current;
    this.emit({ type: 'verse-end', surah, ayah });

    if (this.loopVerse) {
      void this.playVerse(reciter, surah, ayah);
      return;
    }
    if (this.autoAdvance) {
      const upcoming = nextVerse(surah, ayah);
      if (upcoming) void this.playVerse(reciter, upcoming.surah, upcoming.ayah);
    }
  }

  pause(): void {
    this.element?.pause();
  }

  async resume(): Promise<void> {
    await this.unlock();
    try {
      await this.element?.play();
    } catch {
      /* the user gesture requirement was not met yet */
    }
  }

  stop(): void {
    this.loadToken += 1;
    this.activeWindow = null;
    this.clearBoundary();
    this.loadedUrl = null;
    if (this.element) {
      this.element.pause();
      this.element.removeAttribute('src');
      this.element.load();
    }
    this.current = null;
  }

  /** Seek within the CURRENT AYAH; `seconds` is relative to the verse, not the file. */
  seek(seconds: number): void {
    const element = this.element;
    if (!element || !Number.isFinite(element.duration)) return;

    const span = this.activeWindow;
    if (span) {
      const bounded = Math.min(Math.max(seconds, 0), span.endSec - span.startSec);
      element.currentTime = span.startSec + bounded;
      return;
    }
    element.currentTime = Math.min(Math.max(seconds, 0), element.duration);
  }

  setVolume(value: number): void {
    this.ensureGraph();
    if (this.gain && this.ctx) {
      this.gain.gain.setTargetAtTime(Math.min(Math.max(value, 0), 1), this.ctx.currentTime, 0.03);
    }
  }

  setRate(value: number): void {
    if (this.element) this.element.playbackRate = Math.min(Math.max(value, 0.5), 1.5);
  }

  setLoopVerse(value: boolean): void {
    this.loopVerse = value;
  }

  setAutoAdvance(value: boolean): void {
    this.autoAdvance = value;
  }

  get isPlaying(): boolean {
    return Boolean(this.element && !this.element.paused && !this.element.ended);
  }

  /**
   * Position of the playhead in the underlying stream, in seconds. For a timed
   * source this is a surah offset, not an ayah offset — `frame.elapsed` is the
   * ayah-relative figure. Exposed for transport UI and boundary diagnostics.
   */
  get mediaTime(): number {
    return this.element?.currentTime ?? 0;
  }

  /* ---------------------------------------------------- filter automation -- */

  /**
   * The onboarding acoustic clearance: sweep the lowpass corner down from the
   * open band to a sub-bass floor, collapsing the high-frequency field.
   */
  sweepLowpass(fromHz: number, toHz: number, seconds: number): void {
    this.ensureGraph();
    if (!this.ctx || !this.filter) return;
    const now = this.ctx.currentTime;
    this.filter.frequency.cancelScheduledValues(now);
    this.filter.frequency.setValueAtTime(Math.max(fromHz, 20), now);
    this.filter.frequency.exponentialRampToValueAtTime(Math.max(toHz, 20), now + Math.max(seconds, 0.05));
  }

  openFilter(seconds = 1.2): void {
    this.ensureGraph();
    if (!this.ctx || !this.filter) return;
    const now = this.ctx.currentTime;
    this.filter.frequency.cancelScheduledValues(now);
    this.filter.frequency.setValueAtTime(Math.max(this.filter.frequency.value, 20), now);
    this.filter.frequency.exponentialRampToValueAtTime(20000, now + seconds);
  }

  setFilterCutoff(hz: number): void {
    this.ensureGraph();
    if (this.filter && this.ctx) {
      this.filter.frequency.setTargetAtTime(Math.max(hz, 20), this.ctx.currentTime, 0.05);
    }
  }

  /**
   * Procedural noise bed for the clearance stage: filtered noise routed through
   * the same lowpass, so the sweep audibly strips it down to sub-bass ambience.
   */
  runAcousticClearance(seconds = 5): void {
    this.ensureGraph();
    if (!this.ctx || !this.filter) return;
    const ctx = this.ctx;
    const length = Math.ceil(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    // Brown-ish noise: integrating white noise tilts energy toward the sub band.
    let last = 0;
    for (let i = 0; i < length; i += 1) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.2;
    }

    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const envelope = ctx.createGain();
    const now = ctx.currentTime;
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(0.5, now + 0.6);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + seconds);

    noise.connect(envelope);
    envelope.connect(this.filter);
    noise.start(now);
    noise.stop(now + seconds);

    this.sweepLowpass(12000, 55, seconds * 0.82);
  }

  /**
   * L6 — رد السلام. A short reverberant tail acknowledging that the verse's
   * execution loop closed. Rendered with a procedurally generated impulse so the
   * engine ships no binary audio assets.
   */
  emitClosureEcho(): void {
    this.ensureGraph();
    if (!this.ctx || !this.gain) return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    const convolver = ctx.createConvolver();
    const seconds = 2.4;
    const length = Math.ceil(ctx.sampleRate * seconds);
    const impulse = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = impulse.getChannelData(channel);
      for (let i = 0; i < length; i += 1) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.6);
      }
    }
    convolver.buffer = impulse;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(196, now);
    osc.frequency.exponentialRampToValueAtTime(98, now + 1.1);

    const envelope = ctx.createGain();
    envelope.gain.setValueAtTime(0.0001, now);
    envelope.gain.exponentialRampToValueAtTime(0.18, now + 0.08);
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + 1.6);

    osc.connect(envelope);
    envelope.connect(convolver);
    convolver.connect(this.gain);
    osc.start(now);
    osc.stop(now + 1.7);
  }

  /* ------------------------------------------------------------- analysis -- */

  /** Call exactly once per animation frame, before any shader reads the frame. */
  analyse(): AudioFrame {
    const frame = this.frame;
    if (!this.analyser || !this.ctx) return frame;

    const now = this.ctx.currentTime;
    const dt = this.lastAnalysis === 0 ? 1 / 60 : Math.min(Math.max(now - this.lastAnalysis, 1 / 240), 0.25);
    this.lastAnalysis = now;
    frame.time = now;
    frame.dt = dt;

    this.analyser.getByteFrequencyData(frame.spectrum);
    this.analyser.getFloatTimeDomainData(frame.waveform);

    const bins = frame.spectrum.length;
    const binHz = this.ctx.sampleRate / (bins * 2);

    // --- band energies -------------------------------------------------------
    const bandKeys = Object.keys(BANDS) as (keyof typeof BANDS)[];
    for (const key of bandKeys) {
      const { lo, hi } = BANDS[key];
      const start = Math.max(1, Math.floor(lo / binHz));
      const end = Math.min(bins - 1, Math.ceil(hi / binHz));
      let sum = 0;
      for (let i = start; i <= end; i += 1) sum += frame.spectrum[i];
      const raw = end >= start ? sum / ((end - start + 1) * 255) : 0;
      frame[key] = smooth(frame[key], Math.min(raw * 1.35, 1), 0.06, dt);
    }

    // --- loudness ------------------------------------------------------------
    let sumSquares = 0;
    for (let i = 0; i < frame.waveform.length; i += 1) {
      const sample = frame.waveform[i];
      sumSquares += sample * sample;
    }
    const rms = Math.sqrt(sumSquares / frame.waveform.length);
    const level = Math.min(rms * 3.2, 1);
    frame.level = smooth(frame.level, level, 0.05, dt);
    frame.peak = level > frame.peak ? level : smooth(frame.peak, level, 0.35, dt);

    // --- spectral flux → onset ----------------------------------------------
    let flux = 0;
    let centroidNum = 0;
    let centroidDen = 0;
    for (let i = 1; i < bins; i += 1) {
      const magnitude = frame.spectrum[i] / 255;
      const delta = magnitude - this.previousSpectrum[i];
      if (delta > 0) flux += delta;
      this.previousSpectrum[i] = magnitude;
      centroidNum += magnitude * i;
      centroidDen += magnitude;
    }
    const fluxNorm = Math.min(flux / (bins * 0.06), 1);
    frame.flux = smooth(frame.flux, fluxNorm, 0.05, dt);
    frame.centroid = centroidDen > 1e-5 ? smooth(frame.centroid, centroidNum / centroidDen / bins, 0.09, dt) : frame.centroid;

    const onset = Math.max(0, fluxNorm - frame.flux * 0.9);
    frame.transient = onset > frame.transient ? Math.min(onset * 2.6, 1) : smooth(frame.transient, 0, 0.16, dt);

    // --- transport -----------------------------------------------------------
    const element = this.element;
    if (element) {
      const span = this.activeWindow;
      if (span) {
        // A seek issued before the stream was seekable is clamped to 0 by the
        // browser, which would play the ayah from the head of the surah. Re-issue
        // it as soon as a seekable range covering the window exists.
        if (element.currentTime < span.startSec - SEEK_TOLERANCE && this.canSeekTo(span.startSec)) {
          element.currentTime = span.startSec;
        }

        // Report the AYAH's transport, not the surah stream's: L6 anticipation and
        // every progress-driven shader must see the verse, not the file.
        const duration = Math.max(span.endSec - span.startSec, 0.001);
        const elapsed = Math.min(Math.max(element.currentTime - span.startSec, 0), duration);
        frame.duration = duration;
        frame.elapsed = elapsed;
        frame.progress = elapsed / duration;
        // Safety net only — the boundary timer above is the primary mechanism.
        if (element.currentTime >= span.endSec && !element.paused) {
          this.handleWindowBoundary();
        }
      } else {
        const duration = Number.isFinite(element.duration) ? element.duration : 0;
        frame.duration = duration;
        frame.elapsed = element.currentTime;
        frame.progress = duration > 0 ? Math.min(element.currentTime / duration, 1) : 0;
      }
      frame.playing = !element.paused && !element.ended;
    }

    return frame;
  }

  dispose(): void {
    this.stop();
    this.clearBoundary();
    this.listeners.clear();
    this.source?.disconnect();
    this.filter?.disconnect();
    this.gain?.disconnect();
    this.analyser?.disconnect();
    void this.ctx?.close();
    this.ctx = null;
  }
}

/** Process-wide singleton: exactly one AudioContext for the whole document. */
export const audioEngine = new AudioEngine();
