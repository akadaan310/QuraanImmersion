/**
 * Session store — the journey's human-speed state.
 *
 * Holds only what changes at HUMAN speed: which experience, which position along
 * it, which reciter, which drawer is open. Everything that changes at FRAME
 * speed — the audio frame, the six vectors, the navigator's leg and velocity —
 * lives in `audioEngine.frame`, `isnaadEngine.snapshot` and the navigator, and
 * never passes through React.
 *
 * THE JOURNEY IS A ROUTE, NOT A CURSOR
 * ------------------------------------
 * The position of record is `(experienceId, position)`, and the ayah is derived
 * from it. That ordering matters: a route may visit 20:9 after 28:35 and before
 * 27:7, and a store that kept `(surah, ayah)` as the truth would have to guess
 * what "next" meant. `advance` walks the route; at its end it walks on to the
 * next route in the same family, so the traversal never terminates.
 *
 * The phenomenon standing at a waypoint comes from the route when the route
 * names one, and otherwise from the lattice. Both are derived; neither is state.
 */

import { create } from 'zustand';

import { audioEngine } from '@/audio/AudioEngine';
import { isnaadEngine } from '@/engine/isnaad/IsnaadEngine';
import { DEFAULT_RECITER, type ReciterId } from '@/data/reciters';
import type { PhenomenonId } from '@/data/phenomena';
import {
  DEFAULT_EXPERIENCE, EXPERIENCES, EXPERIENCE_BY_ID, positionOf, surahExperienceFor,
  type AyahRef, type Experience,
} from '@/data/experiences';
import { clampVerse } from '@/data/surahs';
import { loadSurahText } from '@/services/QuranTextService';
import { waypointOf, type Waypoint } from '@/journey/waypoints';
import { orientationsFor, weightsFor, ORIENTATIONS, type OrientationId } from '@/journey/orientations';
import type { DualSeaStats, SeaId } from '@/hypermath/DualSea';

const UNLOCK_KEY = 'isnaad.unlocked.v2';
const LAST_ROUTE_KEY = 'isnaad.route.v1';

function readUnlocked(): boolean {
  try {
    return localStorage.getItem(UNLOCK_KEY) === 'yes';
  } catch {
    return false;
  }
}

/** Resume where the last session stopped, if that route still exists. */
function readRoute(): { id: string; position: number } {
  try {
    const raw = localStorage.getItem(LAST_ROUTE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { id: string; position: number };
      const experience = EXPERIENCE_BY_ID[parsed.id];
      if (experience && parsed.position >= 0 && parsed.position < experience.count) return parsed;
    }
  } catch {
    /* a corrupt or absent entry simply opens the default route */
  }
  return { id: DEFAULT_EXPERIENCE, position: 0 };
}

export type Drawer = 'none' | 'experiences' | 'waypoints' | 'reciters';

export interface SessionState {
  /**
   * Has the observer given the one gesture a browser requires before an
   * AudioContext may open? Not a settings screen — the single unavoidable tap.
   */
  unlocked: boolean;

  reciter: ReciterId;

  /** The route being flown. */
  experienceId: string;
  /** Index into that route. */
  position: number;

  /** Derived from (experienceId, position). Never set directly. */
  surah: number;
  ayah: number;
  waypoint: Waypoint;
  /** Set by an external driver; released at the next verse. */
  pinnedPhenomenon: PhenomenonId | null;

  playing: boolean;
  /** Arabic provenance label of the stream bound to the analyser. */
  provider: string | null;
  /** Set when every candidate route for the current ayah failed. */
  routeFailed: boolean;

  /**
   * The standpoint the camera is reading the field from.
   *
   * No longer chosen by hand — there are no orientation buttons. It is adopted
   * automatically per waypoint from the phenomenon's own emphasis, and the
   * external drivers can still override it.
   */
  orientation: OrientationId | null;

  /** Which bottom drawer is open. */
  drawer: Drawer;
  /** Is the ayah text and the readout showing? A tap clears the view. */
  veil: boolean;

  volume: number;
  loopVerse: boolean;

  textError: string | null;
  textLoading: boolean;

  /**
   * مرج البحرين — the two clock seas. Each carries its own lambda and therefore
   * its own phase, so the two can sit in different regimes at the same instant.
   */
  lambdaLower: number;
  lambdaUpper: number;
  seaStats: DualSeaStats | null;
  lastTapSea: SeaId | null;
  tapCounter: number;

  unlock: () => void;
  setReciter: (id: ReciterId) => void;

  enterExperience: (id: string, position?: number) => void;
  goTo: (position: number) => void;
  selectVerse: (surah: number, ayah: number) => void;
  advance: () => void;
  retreat: () => void;

  play: () => void;
  pause: () => void;
  toggleTransport: () => void;

  adopt: (id: OrientationId | null) => void;
  openDrawer: (drawer: Drawer) => void;
  setVeil: (value: boolean) => void;

  setVolume: (value: number) => void;
  setLoopVerse: (value: boolean) => void;
  pinPhenomenon: (id: PhenomenonId | null) => void;

  setLambda: (sea: SeaId, value: number) => void;
  setSeaStats: (stats: DualSeaStats) => void;
  registerTap: (sea: SeaId) => void;

  ingestText: (surah: number) => void;
}

// ------------------------------------------------------------------ derivation

export function experienceOf(state: SessionState): Experience {
  return EXPERIENCE_BY_ID[state.experienceId] ?? EXPERIENCE_BY_ID[DEFAULT_EXPERIENCE];
}

export function currentRef(state: SessionState): AyahRef {
  const route = experienceOf(state).ayat();
  return route[Math.min(Math.max(state.position, 0), route.length - 1)];
}

/** The phenomenon actually standing now: the pin, the route, then the lattice. */
export function activePhenomenon(state: SessionState): PhenomenonId {
  if (state.pinnedPhenomenon) return state.pinnedPhenomenon;
  return currentRef(state).phenomenon ?? state.waypoint.phenomenon;
}

/**
 * The route that follows this one when a route runs out.
 *
 * Within the same family, so a surah leads to the next surah and a thematic
 * route to the next thematic route. Wrapping at the end of each family is what
 * makes the traversal endless without ever leaving the muṣḥaf.
 */
function successorOf(experience: Experience): Experience {
  const family = EXPERIENCES.filter((candidate) => candidate.group === experience.group);
  const at = family.findIndex((candidate) => candidate.id === experience.id);
  return family[(at + 1) % family.length];
}

function predecessorOf(experience: Experience): Experience {
  const family = EXPERIENCES.filter((candidate) => candidate.group === experience.group);
  const at = family.findIndex((candidate) => candidate.id === experience.id);
  return family[(at - 1 + family.length) % family.length];
}

/**
 * Push the weight array the engine should be running.
 *
 * Called on every change of waypoint or standpoint — never per frame. The engine
 * reads the array each frame; recomputing it here would be work done sixty times
 * a second to produce the same six numbers.
 */
function syncWeights(state: SessionState): void {
  const orientation = state.orientation ? ORIENTATIONS[state.orientation] : null;
  isnaadEngine.setPhenomenonWeights(weightsFor(activePhenomenon(state), orientation));
}

/**
 * The standpoint this waypoint is met from.
 *
 * The orientation buttons are gone: the observer no longer picks a vector from a
 * ring of four. Instead the strongest vector of the phenomenon standing here is
 * adopted automatically, so the camera's station changes from waypoint to
 * waypoint the way the emphasis does — which is what the buttons were meant to
 * express and never did, because they mostly went untouched.
 */
function standpointFor(phenomenon: PhenomenonId, voice: boolean): OrientationId | null {
  const offered = orientationsFor(phenomenon, voice, 1);
  return offered[0]?.id ?? null;
}

function persist(id: string, position: number): void {
  try {
    localStorage.setItem(LAST_ROUTE_KEY, JSON.stringify({ id, position }));
  } catch {
    /* the journey simply opens at the default route next session */
  }
}

// ---------------------------------------------------------------------- store

const OPENING = readRoute();
const OPENING_REF = (EXPERIENCE_BY_ID[OPENING.id] ?? EXPERIENCE_BY_ID[DEFAULT_EXPERIENCE])
  .ayat()[OPENING.position];

export const useSession = create<SessionState>((set, get) => ({
  unlocked: readUnlocked(),

  reciter: DEFAULT_RECITER,

  experienceId: OPENING.id,
  position: OPENING.position,

  surah: OPENING_REF.surah,
  ayah: OPENING_REF.ayah,
  waypoint: waypointOf(OPENING_REF.surah, OPENING_REF.ayah),
  pinnedPhenomenon: null,

  playing: false,
  provider: null,
  routeFailed: false,

  orientation: null,

  drawer: 'none',
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
    void get().play();
  },

  setReciter: (id) => {
    const { surah, ayah, playing } = get();
    set({ reciter: id, routeFailed: false, provider: null, drawer: 'none' });
    if (playing) void audioEngine.playVerse(id, surah, ayah);
  },

  enterExperience: (id, position) => {
    const experience = EXPERIENCE_BY_ID[id];
    if (!experience) return;
    const { surah, ayah } = get();
    // Entering a route that already contains the current ayah continues from
    // there rather than restarting: the same verse in a new reading is a change
    // of path, not a jump.
    const at = position ?? Math.max(0, positionOf(experience, surah, ayah));
    set({ experienceId: id, drawer: 'none' });
    get().goTo(at);
  },

  goTo: (position) => {
    const experience = experienceOf(get());
    const route = experience.ayat();
    const at = Math.min(Math.max(position, 0), route.length - 1);
    const ref = route[at];
    const { reciter, playing } = get();

    set({
      position: at,
      surah: ref.surah,
      ayah: ref.ayah,
      waypoint: waypointOf(ref.surah, ref.ayah),
      pinnedPhenomenon: null,
      routeFailed: false,
    });
    // The standpoint belongs to the waypoint, so it is chosen after the
    // waypoint is in place and before the weights are pushed.
    set({ orientation: standpointFor(activePhenomenon(get()), playing) });
    syncWeights(get());
    persist(experience.id, at);

    get().ingestText(ref.surah);
    if (playing) void audioEngine.playVerse(reciter, ref.surah, ref.ayah);
  },

  selectVerse: (surah, ayah) => {
    // An arbitrary verse may not be on the current route. Staying on the route
    // and pretending would silently play something the position does not name,
    // so the journey moves to that verse's own surah route instead.
    const target = clampVerse(surah, ayah);
    const experience = experienceOf(get());
    const here = positionOf(experience, target.surah, target.ayah);
    if (here >= 0) {
      get().goTo(here);
      return;
    }
    const fallback = surahExperienceFor(target.surah);
    set({ experienceId: fallback.id });
    get().goTo(target.ayah - 1);
  },

  advance: () => {
    const { position } = get();
    const experience = experienceOf(get());
    if (position + 1 < experience.count) {
      get().goTo(position + 1);
      return;
    }
    // The route is finished; the journey is not.
    const next = successorOf(experience);
    set({ experienceId: next.id });
    get().goTo(0);
  },

  retreat: () => {
    const { position } = get();
    if (position > 0) {
      get().goTo(position - 1);
      return;
    }
    const previous = predecessorOf(experienceOf(get()));
    set({ experienceId: previous.id });
    get().goTo(previous.count - 1);
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

  adopt: (id) => {
    set({ orientation: id });
    syncWeights(get());
  },

  openDrawer: (drawer) => set((state) => ({ drawer: state.drawer === drawer ? 'none' : drawer })),
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
  const opening = useSession.getState();
  useSession.setState({ orientation: standpointFor(activePhenomenon(opening), false) });
  syncWeights(useSession.getState());

  // Auto-advance is handled here rather than inside the AudioEngine, because
  // "the next verse" is a property of the ROUTE and the engine knows nothing
  // about routes. Leaving the engine's own advance on would race with this one
  // and skip a waypoint at every boundary.
  audioEngine.setAutoAdvance(false);

  return audioEngine.subscribe((event) => {
    switch (event.type) {
      case 'verse-start': {
        isnaadEngine.beginExecution();
        useSession.setState({ provider: event.provider, playing: true, routeFailed: false });
        break;
      }
      case 'verse-end': {
        // L6 — رد السلام: close the circuit before the next command vector fires.
        isnaadEngine.closeExecution();
        audioEngine.emitClosureEcho();
        const state = useSession.getState();
        if (state.loopVerse) void audioEngine.playVerse(state.reciter, state.surah, state.ayah);
        else state.advance();
        break;
      }
      case 'state': {
        useSession.setState({ playing: event.playing });
        if (!event.playing) isnaadEngine.haltExecution();
        break;
      }
      case 'route-failed': {
        // A dead route ends this leg, not the journey: the traversal moves on to
        // the next waypoint rather than stranding the observer at a silent one.
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
