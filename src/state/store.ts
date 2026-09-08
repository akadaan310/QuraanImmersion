/**
 * Session store.
 *
 * Holds only state that changes at HUMAN speed (which verse, which reciter, which
 * phenomenon). Anything that changes at FRAME speed lives in AudioEngine.frame and
 * IsnaadEngine.snapshot instead, and never passes through React.
 */

import { create } from 'zustand';

import { audioEngine } from '@/audio/AudioEngine';
import { isnaadEngine } from '@/engine/isnaad/IsnaadEngine';
import { DEFAULT_RECITER, type ReciterId } from '@/data/reciters';
import { DEFAULT_PHENOMENON, PHENOMENON_BY_ID, type PhenomenonId } from '@/data/phenomena';
import { clampVerse, nextVerse, prevVerse, PRIMARY_PROCESSING_CORE } from '@/data/surahs';
import { loadSurahText } from '@/services/QuranTextService';
import type { DualSeaStats, SeaId } from '@/hypermath/DualSea';

const CALIBRATION_KEY = 'isnaad.calibration.v1';

function readCalibrated(): boolean {
  try {
    return localStorage.getItem(CALIBRATION_KEY) === 'complete';
  } catch {
    return false;
  }
}

export interface SessionState {
  /** Has the observer completed the onboarding calibration protocol? */
  calibrated: boolean;

  reciter: ReciterId;
  surah: number;
  ayah: number;
  phenomenon: PhenomenonId;

  playing: boolean;
  /** Arabic provenance label of the stream currently bound to the analyser. */
  provider: string | null;
  /** Set when every candidate route for the current ayah failed. */
  routeFailed: boolean;

  loopVerse: boolean;
  autoAdvance: boolean;
  volume: number;

  hudVisible: boolean;
  /** Inverted viewport: observer outside the crystal, projecting inward. */
  inverted: boolean;

  textError: string | null;
  textLoading: boolean;

  /**
   * مرج البحرين — the two clock seas.
   *
   * Each sea carries its OWN lambda and therefore its own phase, so the two can
   * sit in different regimes at the same instant: one running uniform time,
   * one collapsed, one racing inward. They are stored separately here for the
   * same reason they are simulated separately — nothing may couple them.
   */
  lambdaLower: number;
  lambdaUpper: number;
  /** Live telemetry from the continuum, republished at ~6 Hz. */
  seaStats: DualSeaStats | null;
  /** Which sea was last tapped, and a counter to drive the UI pulse. */
  lastTapSea: SeaId | null;
  tapCounter: number;

  setReciter: (id: ReciterId) => void;
  selectVerse: (surah: number, ayah: number) => void;
  setPhenomenon: (id: PhenomenonId) => void;
  toggleTransport: () => void;
  play: () => void;
  pause: () => void;
  advance: () => void;
  retreat: () => void;
  setLoopVerse: (value: boolean) => void;
  setAutoAdvance: (value: boolean) => void;
  setVolume: (value: number) => void;
  toggleHud: () => void;
  toggleInverted: () => void;
  completeCalibration: () => void;
  resetCalibration: () => void;
  ingestText: (surah: number) => void;

  setLambda: (sea: SeaId, value: number) => void;
  setSeaStats: (stats: DualSeaStats) => void;
  registerTap: (sea: SeaId) => void;
}

export const useSession = create<SessionState>((set, get) => ({
  calibrated: readCalibrated(),

  reciter: DEFAULT_RECITER,
  surah: PRIMARY_PROCESSING_CORE,
  ayah: 1,
  phenomenon: DEFAULT_PHENOMENON,

  playing: false,
  provider: null,
  routeFailed: false,

  loopVerse: false,
  autoAdvance: true,
  volume: 0.9,

  hudVisible: true,
  inverted: true,

  textError: null,
  textLoading: false,

  // Both seas open sub-critical, so the first thing an observer sees is
  // uniform time — the baseline the other two phases are departures from.
  lambdaLower: 1.0,
  lambdaUpper: 1.0,
  seaStats: null,
  lastTapSea: null,
  tapCounter: 0,

  setReciter: (id) => {
    const { surah, ayah, playing } = get();
    set({ reciter: id, routeFailed: false, provider: null });
    if (playing) void audioEngine.playVerse(id, surah, ayah);
  },

  selectVerse: (surah, ayah) => {
    const target = clampVerse(surah, ayah);
    const { reciter, playing } = get();
    set({ ...target, routeFailed: false });
    get().ingestText(target.surah);
    if (playing) void audioEngine.playVerse(reciter, target.surah, target.ayah);
  },

  setPhenomenon: (id) => {
    set({ phenomenon: id });
    isnaadEngine.setPhenomenonWeights(PHENOMENON_BY_ID[id].isnaadWeights);
  },

  toggleTransport: () => {
    if (get().playing) get().pause();
    else get().play();
  },

  play: () => {
    const { reciter, surah, ayah } = get();
    set({ playing: true, routeFailed: false });
    isnaadEngine.beginExecution();
    void audioEngine.playVerse(reciter, surah, ayah);
  },

  pause: () => {
    audioEngine.pause();
    isnaadEngine.haltExecution();
    set({ playing: false });
  },

  advance: () => {
    const { surah, ayah } = get();
    const upcoming = nextVerse(surah, ayah);
    if (upcoming) get().selectVerse(upcoming.surah, upcoming.ayah);
  },

  retreat: () => {
    const { surah, ayah } = get();
    const previous = prevVerse(surah, ayah);
    if (previous) get().selectVerse(previous.surah, previous.ayah);
  },

  setLoopVerse: (value) => {
    audioEngine.setLoopVerse(value);
    set({ loopVerse: value });
  },

  setAutoAdvance: (value) => {
    audioEngine.setAutoAdvance(value);
    set({ autoAdvance: value });
  },

  setVolume: (value) => {
    audioEngine.setVolume(value);
    set({ volume: value });
  },

  toggleHud: () => set((state) => ({ hudVisible: !state.hudVisible })),
  toggleInverted: () => set((state) => ({ inverted: !state.inverted })),

  completeCalibration: () => {
    try {
      localStorage.setItem(CALIBRATION_KEY, 'complete');
    } catch {
      /* calibration simply replays next session */
    }
    set({ calibrated: true });
  },

  resetCalibration: () => {
    try {
      localStorage.removeItem(CALIBRATION_KEY);
    } catch {
      /* nothing to clear */
    }
    set({ calibrated: false });
  },

  setLambda: (sea, value) => {
    // Clamped to the sweep the three-phase model is defined on. The collapse
    // band sits at 3.0 +/- 0.02, so a control stepping by 0.01 cannot skip it.
    const clamped = Math.min(Math.max(value, 0.1), 6.0);
    set(sea === 'lower' ? { lambdaLower: clamped } : { lambdaUpper: clamped });
  },

  setSeaStats: (stats) => set({ seaStats: stats }),

  registerTap: (sea) =>
    set((state) => ({ lastTapSea: sea, tapCounter: state.tapCounter + 1 })),

  ingestText: (surah) => {
    set({ textLoading: true, textError: null });
    loadSurahText(surah)
      .then(() => set({ textLoading: false }))
      .catch(() =>
        set({
          textLoading: false,
          textError: 'تعذّر جلب الرسم العثماني — تحقق من اتصال الشبكة.',
        }),
      );
  },
}));

/** Wire AudioEngine events into the store. Called once from the entry point. */
export function bindEngineToSession(): () => void {
  isnaadEngine.setPhenomenonWeights(PHENOMENON_BY_ID[useSession.getState().phenomenon].isnaadWeights);

  return audioEngine.subscribe((event) => {
    switch (event.type) {
      case 'verse-start': {
        isnaadEngine.beginExecution();
        useSession.setState({
          surah: event.surah,
          ayah: event.ayah,
          provider: event.provider,
          playing: true,
          routeFailed: false,
        });
        useSession.getState().ingestText(event.surah);
        break;
      }
      case 'verse-end': {
        // L6 — رد السلام: close the circuit before the next command vector fires.
        isnaadEngine.closeExecution();
        audioEngine.emitClosureEcho();
        break;
      }
      case 'state': {
        useSession.setState({ playing: event.playing });
        if (!event.playing) isnaadEngine.haltExecution();
        break;
      }
      case 'route-failed': {
        useSession.setState({ playing: false, routeFailed: true, provider: null });
        isnaadEngine.haltExecution();
        break;
      }
      case 'error': {
        useSession.setState({ playing: false });
        break;
      }
    }
  });
}
