/**
 * سِيرُوا۟ فِى ٱلْأَرْضِ — the traversal.
 *
 * The Earth is السيارة: the vehicle the observer is aboard, not a scene object
 * to look at. Every ayah is a leg of a journey across it, and the legs together
 * cover the whole sphere.
 *
 * WHAT THE MAPPING IS, AND WHAT IT IS NOT
 * ---------------------------------------
 * Each ayah is assigned a point on the sphere by a Fibonacci (golden-angle)
 * lattice over all 6236 ayat. This is a TRAVERSAL ORDER — a way of walking the
 * whole Earth without repeating and without bunching at the poles. It is not a
 * claim that an ayah belongs to a place. Nothing in the interface says otherwise,
 * and the coordinates are shown as what they are: where the traveller is now.
 *
 * Two properties make the lattice the right choice rather than an arbitrary one:
 *
 *   1. EQUAL AREA. Latitudes are drawn from a uniform distribution in sin(φ), so
 *      the density of waypoints per square kilometre is constant. A naive
 *      uniform-in-degrees mapping would crowd the poles, and the journey would
 *      spend most of its life in the Arctic.
 *   2. NO PERIOD. The longitude step is the golden angle, 137.507764…°, which is
 *      irrational in units of a turn. Consecutive ayat therefore land on opposite
 *      faces of the Earth and the sequence never falls into a repeating ring —
 *      each leg is a real crossing, and the coverage keeps filling in for as long
 *      as the journey runs.
 *
 * The phenomenon at a waypoint is bound by the ayah's own anchors first: a verse
 * that a phenomenon actually names gets that phenomenon. Only where no anchor
 * matches does the index decide, and that fallback is stated in the return value
 * (`anchored`) rather than hidden.
 */

import { PHENOMENA, type Phenomenon, type PhenomenonId } from '@/data/phenomena';
import { SURAHS, ayahCountOf, verseKey } from '@/data/surahs';
import { norm180 } from '@/astro/ephemeris';
import type { GeoPoint } from '@/astro/geo';

/** Total ayat in the muṣḥaf, summed from the verified surah table. */
export const TOTAL_AYAT = SURAHS.reduce((sum, surah) => sum + surah.ayahCount, 0);

/** The golden angle in degrees: 360° · (1 − 1/φ). */
const GOLDEN_ANGLE = 137.50776405003785;

/**
 * Decorrelating stride.
 *
 * The golden angle spreads consecutive waypoints in LONGITUDE, but the lattice
 * walks latitude monotonically from pole to pole. Used directly, the first fifty
 * ayat of the muṣḥaf would all land inside the Arctic — and because an
 * equal-area lattice packs its polar points into a small circle, those legs
 * would be a few degrees long each. A journey that opens with fifty short hops
 * around the north pole is not سير في الأرض.
 *
 * Multiplying the index by a stride coprime to the total permutes the lattice
 * without damaging it: it is still a bijection, so coverage is still complete
 * and no waypoint is still ever repeated, but consecutive ayat now land in
 * unrelated latitudes as well as unrelated longitudes.
 *
 * 6236 = 2² · 1559, and 3853 shares neither factor, so the stride visits every
 * index exactly once before returning to the start. It is near TOTAL_AYAT/φ,
 * which is what keeps the successive latitudes from falling into a short cycle.
 */
const STRIDE = 3853;

/** Cumulative ayah counts, so absolute index is a lookup and not a loop. */
const CUMULATIVE: number[] = (() => {
  const table: number[] = [0];
  for (const surah of SURAHS) table.push(table[table.length - 1] + surah.ayahCount);
  return table;
})();

/** Absolute ayah index, 1-based, counting from the first ayah of al-Fātiḥah. */
export function absoluteIndex(surah: number, ayah: number): number {
  const clampedSurah = Math.min(Math.max(Math.trunc(surah), 1), 114);
  const clampedAyah = Math.min(Math.max(Math.trunc(ayah), 1), ayahCountOf(clampedSurah));
  return CUMULATIVE[clampedSurah - 1] + clampedAyah;
}

/** The inverse: absolute index → surah and ayah. Wraps, so the journey is endless. */
export function fromAbsoluteIndex(index: number): { surah: number; ayah: number } {
  const wrapped = ((Math.trunc(index) - 1) % TOTAL_AYAT + TOTAL_AYAT) % TOTAL_AYAT + 1;
  // Linear scan over 114 entries: cheaper than a binary search's branch
  // misprediction at this size, and it runs once per ayah, not once per frame.
  for (let surah = 1; surah <= 114; surah += 1) {
    if (wrapped <= CUMULATIVE[surah]) return { surah, ayah: wrapped - CUMULATIVE[surah - 1] };
  }
  return { surah: 114, ayah: ayahCountOf(114) };
}

/** The point on السيارة this ayah's leg arrives at. */
export function waypointFor(surah: number, ayah: number): GeoPoint {
  const ordinal = absoluteIndex(surah, ayah) - 1;
  const index = (ordinal * STRIDE) % TOTAL_AYAT;
  // Offset by a half step so neither the first nor the last point sits exactly
  // on a pole, where longitude is undefined and the camera's up-vector flips.
  const z = 1 - (2 * index + 1) / TOTAL_AYAT;
  return {
    lat: (Math.asin(Math.max(-1, Math.min(1, z))) * 180) / Math.PI,
    lon: norm180(index * GOLDEN_ANGLE),
  };
}

/** Every phenomenon that names this verse among its anchors. */
function anchoredPhenomena(surah: number, ayah: number): Phenomenon[] {
  const key = verseKey(surah, ayah);
  return PHENOMENA.filter((phenomenon) => phenomenon.anchors.includes(key));
}

export interface Waypoint {
  surah: number;
  ayah: number;
  /** 1-based position in the muṣḥaf. */
  index: number;
  /** Where on السيارة this leg lands. */
  at: GeoPoint;
  /** The phenomenon that stands at this waypoint. */
  phenomenon: PhenomenonId;
  /**
   * True when the phenomenon was chosen because the ayah is one of its declared
   * anchors — a real binding. False when it fell through to the index rotation.
   */
  anchored: boolean;
  /**
   * Orbital radius of the station above the surface, in Earth radii above 1.
   * Derived from the phenomenon's own emphasis: a scene weighted toward the
   * terrestrial witness (L4) is met low, one weighted toward the unseen (L5) is
   * met high. Nothing about the altitude is arbitrary.
   */
  altitude: number;
}

export function waypointOf(surah: number, ayah: number): Waypoint {
  const index = absoluteIndex(surah, ayah);
  const anchored = anchoredPhenomena(surah, ayah);
  const phenomenon = anchored.length > 0
    ? anchored[index % anchored.length]
    : PHENOMENA[(index - 1) % PHENOMENA.length];

  const [, , , l4, l5] = phenomenon.isnaadWeights;
  // l4 pulls the station down toward the surface, l5 lifts it away from it.
  const altitude = 0.35 + 1.15 * Math.max(0, Math.min(1, 0.5 + (l5 - l4) * 0.5));

  return {
    surah,
    ayah,
    index,
    at: waypointFor(surah, ayah),
    phenomenon: phenomenon.id,
    anchored: anchored.length > 0,
    altitude,
  };
}

/** The waypoint `offset` legs ahead — used to draw the track before flying it. */
export function waypointAhead(surah: number, ayah: number, offset: number): Waypoint {
  const { surah: nextSurah, ayah: nextAyah } = fromAbsoluteIndex(absoluteIndex(surah, ayah) + offset);
  return waypointOf(nextSurah, nextAyah);
}

/**
 * The shell of the infinite ladder this ayah belongs to.
 *
 * Every `SHELL_PERIOD` legs the journey climbs one shell: the traversal so far
 * recedes to a mote and a wider structure resolves around it. The number is the
 * shell index, not a scale — the renderer recentres at each climb, so no world
 * coordinate ever grows and float precision never degrades however long the
 * journey runs. That recentring is what makes "infinite" true rather than a
 * number that eventually saturates.
 */
export const SHELL_PERIOD = 7;

export function shellOf(index: number): number {
  return Math.floor((index - 1) / SHELL_PERIOD);
}

/** Position within the current shell, 0..1 — how far the climb has come. */
export function shellProgress(index: number): number {
  return ((index - 1) % SHELL_PERIOD) / SHELL_PERIOD;
}
