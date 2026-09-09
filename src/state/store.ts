/**
 * Session store — the journey's human-speed state.
 *
 * Holds only what changes at HUMAN speed: which ayah, which reciter, which
 * orientation the observer has adopted. Everything that changes at FRAME speed
 * — the audio frame, the six vectors, the navigator's leg and altitude — lives
 * in `audioEngine.frame`, `isnaadEngine.snapshot` and the navigator, and never
 * passes through React.
 *
 * The phenomenon is DERIVED, not chosen. There is no picker any more: the ayah
 * decides the waypoint and the waypoint decides the phenomenon (`waypointOf`).
 * `pinPhenomenon` exists for the two external drivers that legitimately need to
 * address a scene directly — the Termux CLI and the verification harness — and
 * the pin is released at the next verse so it can never quietly become a mode.
 */

import { create } from 'zustand';

import { audioEngine } from '@/audio/AudioEngine';
import { isnaadEngine } from '@/engine/isnaad/IsnaadEngine';
import { DEFAULT_RECITER, type ReciterId } from '@/data/reciters';
import type { PhenomenonId } from '@/data/phenomena';
import { clampVerse, nextVerse, prevVerse, PRIMARY_PROCESSING_CORE } from '@/data/surahs';
import { loadSurahText } from '@/services/QuranTextService';
import { waypointOf, type Waypoint } from '@/journey/waypoints';
import { ORIENTATIONS, cycle, orientationsFor, weightsFor, type OrientationId } from '@/journey/orientations';
import type { DualSeaStats, SeaId } from '@/hypermath/DualSea';

const UNLOCK_KEY = 'isnaad.unlocked.v2';

function readUnlocked(): boolean {
  try {
    return localStorage.getItem(UNLOCK_KEY) === 'yes';
  } catch {
    return false;
  }
}

export interface SessionState {
  /**
   * Has the observer given the one gesture a browser requires before an
   * AudioContext may open? This is not a settings screen — it is the single
   * unavoidable tap, and it is also the first isnaad orientation adopted.
   */
  unlocked: boolean;

  reciter: ReciterId;
  surah: number;
  ayah: number;

  /** The current leg. Derived from (surah, ayah) — never set directly. */
  waypoint: Waypoint;
  /** Set by an external driver; cleared at the next verse. */
  pinnedPhenomenon: PhenomenonId | null;

  playing: boolean;
  /** Arabic provenance label of the stream bound to the analyser. */
  provider: string | null;
  /** Set when every candidate route for the current ayah failed. */
  routeFailed: boolean;

  /** The orientation currently adopted, or null for the default standpoint. */
  orientation: OrientationId | null;
  /** The orientation a swipe has moved the focus to, awaiting a tap. */
  focused: OrientationId | null;

  /** Is the ayah's own text showing over the field? */
  veil: boolean;

  volume: number;
  loopVerse: boolean;

  textError: string | null;
  textLoading: boolean;

  /**
   * مرج البحرين — the two clock seas. Each carries its own lambda and therefore
   * its own phase, so the two can sit in different regimes at the same instant.
   * Stored separately for the same reason they are simulated separately.
   */
  lambdaLower: number;
  lambdaUpper: number;
  seaStats: DualSeaStats | null;
  lastTapSea: SeaId | null;
  tapCounter: number;

  unlock: () => void;
  setReciter: (id: ReciterId) => void;
  selectVerse: (surah: number, ayah: number) => void;
  play: () => void;
  pause: () => void;
  toggleTransport: () => void;
  advance: () => void;
  retreat: () => void;

  adopt: (id: OrientationId | null) => void;
  focus: (direction: 1 | -1) => void;
  commitFocus: () => void;

  setVeil: (value: boolean) => void;
  setVolume: (value: number) => void;
  setLoopVerse: (value: boolean) => void;
  pinPhenomenon: (id: PhenomenonId | null) => void;

  setLambda: (sea: SeaId, value: number) => void;
  setSeaStats: (stats: DualSeaStats) => void;
  registerTap: (sea: SeaId) => void;

  ingestText: (surah: number) => void;
}

/** The phenomenon actually standing at this moment: the pin, else the waypoint. */
export function activePhenomenon(state: SessionState): PhenomenonId {
  return state.pinnedPhenomenon ?? state.waypoint.phenomenon;
}

/**
 * Push the weight array the engine should be running.
 *
 * Called on every change of ayah or orientation — never per frame. The engine
 * reads the array each frame; recomputing it here would be work done sixty times
 * a second to produce the same six numbers.
 */
function syncWeights(state: SessionState): void {
  const orientation = state.orientation ? ORIENTATIONS[state.orientation] : null;
  isnaadEngine.setPhenomenonWeights(weightsFor(activePhenomenon(state), orientation));
}

const FIRST = waypointOf(PRIMARY_PROCESSING_CORE, 1);

export const useSession = create<SessionState>((set, get) => ({
  unlocked: readUnlocked(),

  reciter: DEFAULT_RECITER,
  surah: PRIMARY_PROCESSING_CORE,
  ayah: 1,
  waypoint: FIRST,
  pinnedPhenomenon: null,

  playing: false,
  provider: null,
  routeFailed: false,

  orientation: null,
  focused: null,

  veil: true,

  volume: 0.9,
  loopVerse: false,

  textError: null,
  textLoading: false,

  // Both seas open sub-critical, so the first thing an observer meets is
  // uniform time — the baseline the other two phases depart from.
  lambdaLower: 1.0,
  lambdaUpper: 1.0,
  seaStats: null,
  lastTapSea: null,
  tapCounter: 0,

  unlock: () => {
    try {
      localStorage.setItem(UNLOCK_KEY, 'yes');
    } catch {
      /* the gesture is simply asked for again next session */
    }
    set({ unlocked: true });
    // The journey begins the moment the gesture lands. Nothing else asks.
    void get().play();
  },

  setReciter: (id) => {
    const { surah, ayah, playing } = get();
    set({ reciter: id, routeFailed: false, provider: null });
    if (playing) void audioEngine.playVerse(id, surah, ayah);
  },

  selectVerse: (surah, ayah) => {
    const target = clampVerse(surah, ayah);
    const { reciter, playing } = get();
    // A new leg releases the pin and the adopted orientation: the orientations
    // on offer belong to the ayah, so carrying one across would present a
    // standpoint this ayah never offered.
    set({
      ...target,
      waypoint: waypointOf(target.surah, target.ayah),
      pinnedPhenomenon: null,
      orientation: null,
      focused: null,
      routeFailed: false,
    });
    syncWeights(get());
    get().ingestText(target.surah);
    if (playing) void audioEngine.playVerse(reciter, target.surah, target.ayah);
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

  toggleTransport: () => {
    if (get().playing) get().pause();
    else get().play();
  },

  advance: () => {
    const { surah, ayah } = get();
    const upcoming = nextVerse(surah, ayah);
    // At the end of a surah the journey continues into the next rather than
    // stopping — سير, not a playlist.
    if (upcoming) get().selectVerse(upcoming.surah, upcoming.ayah);
    else get().selectVerse(surah < 114 ? surah + 1 : 1, 1);
  },

  retreat: () => {
    const { surah, ayah } = get();
    const previous = prevVerse(surah, ayah);
    if (previous) get().selectVerse(previous.surah, previous.ayah);
  },

  adopt: (id) => {
    set({ orientation: id, focused: id });
    syncWeights(get());
  },

  focus: (direction) => {
    const state = get();
    const offered = orientationsFor(activePhenomenon(state), state.playing);
    set({ focused: cycle(offered, state.focused ?? state.orientation, direction) });
  },

  commitFocus: () => {
    const { focused, orientation } = get();
    // Tapping the orientation already held releases it, back to the default
    // standpoint. Without this there would be no way to let go of one.
    get().adopt(focused === orientation ? null : focused);
  },

  setVeil: (value) => set({ veil: value }),

  setVolume: (value) => {
    audioEngine.setVolume(value);
    set({ volume: value });
  },

  setLoopVerse: (value) => {
    audioEngine.setLoopVerse(value);
    set({ loopVerse: value });
  },

  pinPhenomenon: (id) => {
    set({ pinnedPhenomenon: id });
    syncWeights(get());
  },

  setLambda: (sea, value) => {
    // Clamped to the sweep the three-phase model is defined on. The collapse
    // band sits at 3.0 ± 0.02, so a control stepping by 0.01 cannot skip it.
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
  syncWeights(useSession.getState());
  // The journey never stops at a verse boundary; the next leg is always armed.
  audioEngine.setAutoAdvance(true);

  return audioEngine.subscribe((event) => {
    switch (event.type) {
      case 'verse-start': {
        isnaadEngine.beginExecution();
        useSession.setState({
          surah: event.surah,
          ayah: event.ayah,
          waypoint: waypointOf(event.surah, event.ayah),
          pinnedPhenomenon: null,
          orientation: null,
          focused: null,
          provider: event.provider,
          playing: true,
          routeFailed: false,
        });
        syncWeights(useSession.getState());
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
        // A dead route ends this leg, not the journey: the traversal moves on to
        // the next ayah rather than stranding the observer at a silent station.
        useSession.setState({ routeFailed: true, provider: null });
        isnaadEngine.haltExecution();
        setTimeout(() => {
          const state = useSession.getState();
          if (state.routeFailed) state.advance();
        }, 2500);
        break;
      }
      case 'error': {
        useSession.setState({ playing: false });
        break;
      }
    }
  });
}
