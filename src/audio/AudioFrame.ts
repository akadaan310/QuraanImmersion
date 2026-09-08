/**
 * The per-frame audio snapshot shared with every shader in the engine.
 *
 * This object is MUTATED IN PLACE once per animation frame and read by
 * `useFrame` callbacks. It deliberately never flows through React state: at 60fps
 * a re-render per frame would starve the render loop, so the identity is stable
 * and only the fields change.
 */
export interface AudioFrame {
  /** Seconds since the AudioContext was created. */
  time: number;
  /** Seconds since the previous analysed frame. */
  dt: number;

  /** RMS loudness, smoothed, 0..1. */
  level: number;
  /** Fast-attack / slow-release peak follower, 0..1. */
  peak: number;
  /** Onset energy: spikes to 1 on a transient and decays. */
  transient: number;
  /** Positive spectral flux, 0..1 — how fast the timbre is changing. */
  flux: number;
  /** Normalised spectral centroid, 0..1 — vocal brightness. */
  centroid: number;

  /** Band energies, each 0..1. */
  subBass: number;
  bass: number;
  lowMid: number;
  mid: number;
  highMid: number;
  treble: number;

  /**
   * Raw analyser buffers. Do not retain across frames — they are reused.
   * Backed by a plain ArrayBuffer (never shared) so they satisfy the
   * AnalyserNode signatures directly.
   */
  spectrum: Uint8Array<ArrayBuffer>;
  waveform: Float32Array<ArrayBuffer>;

  /** Playback state of the current ayah. */
  playing: boolean;
  /** 0..1 across the current ayah. */
  progress: number;
  /** Seconds elapsed inside the current ayah. */
  elapsed: number;
  /** Duration of the current ayah in seconds, 0 while unknown. */
  duration: number;
}

export function createEmptyFrame(bins: number, samples: number): AudioFrame {
  return {
    time: 0,
    dt: 0,
    level: 0,
    peak: 0,
    transient: 0,
    flux: 0,
    centroid: 0,
    subBass: 0,
    bass: 0,
    lowMid: 0,
    mid: 0,
    highMid: 0,
    treble: 0,
    spectrum: new Uint8Array(new ArrayBuffer(bins)),
    waveform: new Float32Array(new ArrayBuffer(samples * Float32Array.BYTES_PER_ELEMENT)),
    playing: false,
    progress: 0,
    elapsed: 0,
    duration: 0,
  };
}
