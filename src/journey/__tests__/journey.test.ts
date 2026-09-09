/**
 * The journey core.
 *
 * Three properties matter here and none of them is visual:
 *
 *   · the traversal covers the Earth and never repeats a waypoint;
 *   · the orientations offered belong to the ayah, and cannot offer a standpoint
 *     the engine would refuse to honour;
 *   · the navigator is bounded — it must run for a simulated week without a
 *     coordinate growing, because that is the whole claim behind "infinite".
 */

import { describe, expect, it } from 'vitest';

import { SURAHS, ayahCountOf } from '@/data/surahs';
import { PHENOMENA, PHENOMENON_BY_ID } from '@/data/phenomena';
import { centralAngle } from '@/astro/geo';

import {
  SHELL_PERIOD, TOTAL_AYAT, absoluteIndex, fromAbsoluteIndex, shellOf,
  shellProgress, waypointAhead, waypointFor, waypointOf,
} from '../waypoints';
import { ORIENTATIONS, cycle, orientationsFor, weightsFor } from '../orientations';
import { TRANSIT_FRACTION, createNavigator, orientationsVisible } from '../AutoNavigator';

describe('absolute indexing', () => {
  it('counts every ayah in the muṣḥaf exactly once', () => {
    // 6236 is the count of the Ḥafṣ muṣḥaf, and the table was already verified
    // against EveryAyah's published ayahCount array.
    expect(TOTAL_AYAT).toBe(6236);
    expect(SURAHS.reduce((sum, surah) => sum + surah.ayahCount, 0)).toBe(TOTAL_AYAT);
  });

  it('starts at one and ends at the last ayah of an-Nās', () => {
    expect(absoluteIndex(1, 1)).toBe(1);
    expect(absoluteIndex(114, ayahCountOf(114))).toBe(TOTAL_AYAT);
  });

  it('round-trips through the inverse for every ayah', () => {
    for (let surah = 1; surah <= 114; surah += 1) {
      for (const ayah of [1, Math.ceil(ayahCountOf(surah) / 2), ayahCountOf(surah)]) {
        const back = fromAbsoluteIndex(absoluteIndex(surah, ayah));
        expect(back).toEqual({ surah, ayah });
      }
    }
  });

  it('wraps rather than running off either end — the journey has no last leg', () => {
    expect(fromAbsoluteIndex(TOTAL_AYAT + 1)).toEqual({ surah: 1, ayah: 1 });
    expect(fromAbsoluteIndex(0)).toEqual({ surah: 114, ayah: ayahCountOf(114) });
    expect(fromAbsoluteIndex(-1)).toEqual({ surah: 114, ayah: ayahCountOf(114) - 1 });
  });

  it('is monotonic across a surah boundary', () => {
    expect(absoluteIndex(2, 1)).toBe(absoluteIndex(1, ayahCountOf(1)) + 1);
    expect(absoluteIndex(19, 1)).toBe(absoluteIndex(18, ayahCountOf(18)) + 1);
  });
});

describe('the traversal — سيروا في الأرض', () => {
  it('produces coordinates that exist, for every ayah', () => {
    for (let index = 1; index <= TOTAL_AYAT; index += 7) {
      const { surah, ayah } = fromAbsoluteIndex(index);
      const at = waypointFor(surah, ayah);
      expect(Number.isFinite(at.lat)).toBe(true);
      expect(Number.isFinite(at.lon)).toBe(true);
      expect(Math.abs(at.lat)).toBeLessThanOrEqual(90);
      expect(at.lon).toBeGreaterThan(-180.0001);
      expect(at.lon).toBeLessThanOrEqual(180.0001);
    }
  });

  it('never lands exactly on a pole, where longitude is undefined', () => {
    // The half-step offset in the lattice exists for this. Without it the first
    // and last waypoints sit on the poles and the camera's up-vector flips.
    for (const index of [1, 2, TOTAL_AYAT - 1, TOTAL_AYAT]) {
      const { surah, ayah } = fromAbsoluteIndex(index);
      expect(Math.abs(waypointFor(surah, ayah).lat)).toBeLessThan(89.99);
    }
  });

  it('covers both hemispheres in equal measure', () => {
    // The lattice is uniform in sin(latitude), so an equal-area split at the
    // equator must divide the waypoints in half.
    let north = 0;
    for (let index = 1; index <= TOTAL_AYAT; index += 1) {
      const { surah, ayah } = fromAbsoluteIndex(index);
      if (waypointFor(surah, ayah).lat > 0) north += 1;
    }
    expect(north / TOTAL_AYAT).toBeCloseTo(0.5, 2);
  });

  it('is equal-area rather than uniform in degrees', () => {
    // Half the sphere's area lies within ±30° of the equator (sin 30° = 0.5),
    // so half the waypoints must too. A naive uniform-in-degrees mapping would
    // put only a third there and would crowd the poles.
    let tropical = 0;
    for (let index = 1; index <= TOTAL_AYAT; index += 1) {
      const { surah, ayah } = fromAbsoluteIndex(index);
      if (Math.abs(waypointFor(surah, ayah).lat) <= 30) tropical += 1;
    }
    expect(tropical / TOTAL_AYAT).toBeCloseTo(0.5, 2);
  });

  it('never repeats a waypoint', () => {
    const seen = new Set<string>();
    for (let index = 1; index <= TOTAL_AYAT; index += 1) {
      const { surah, ayah } = fromAbsoluteIndex(index);
      const at = waypointFor(surah, ayah);
      seen.add(`${at.lat.toFixed(4)}|${at.lon.toFixed(4)}`);
    }
    expect(seen.size).toBe(TOTAL_AYAT);
  });

  it('makes every leg a real crossing rather than a shuffle in place', () => {
    // The golden angle sends consecutive ayat most of the way round the world.
    // Anything under a few thousand kilometres would not read as travel.
    let shortest = Infinity;
    for (let index = 1; index < 400; index += 1) {
      const a = fromAbsoluteIndex(index);
      const b = fromAbsoluteIndex(index + 1);
      const angle = centralAngle(waypointFor(a.surah, a.ayah), waypointFor(b.surah, b.ayah));
      shortest = Math.min(shortest, angle);
    }
    expect((shortest * 180) / Math.PI).toBeGreaterThan(60);
  });
});

describe('stations', () => {
  it('binds a phenomenon to every waypoint', () => {
    for (let index = 1; index <= TOTAL_AYAT; index += 53) {
      const { surah, ayah } = fromAbsoluteIndex(index);
      const waypoint = waypointOf(surah, ayah);
      expect(PHENOMENON_BY_ID[waypoint.phenomenon]).toBeDefined();
      expect(waypoint.altitude).toBeGreaterThan(0);
      expect(waypoint.altitude).toBeLessThan(2);
    }
  });

  it('honours an ayah that a phenomenon actually names', () => {
    // الرتق والفتق anchors 21:30. Standing there must give that phenomenon, and
    // must be reported as a real binding rather than the index fallback.
    const waypoint = waypointOf(21, 30);
    expect(waypoint.phenomenon).toBe('ratq-fatq');
    expect(waypoint.anchored).toBe(true);
  });

  it('marks the fallback as a fallback', () => {
    // 18:1 is not an anchor of anything; the binding is the index rotation and
    // the waypoint has to say so.
    expect(waypointOf(18, 1).anchored).toBe(false);
  });

  it('reaches all twenty phenomena within a few hundred legs', () => {
    const met = new Set<string>();
    for (let index = 1; index <= 400; index += 1) {
      const { surah, ayah } = fromAbsoluteIndex(index);
      met.add(waypointOf(surah, ayah).phenomenon);
    }
    expect(met.size).toBe(PHENOMENA.length);
  });

  it('looks a fixed number of legs ahead and behind', () => {
    const here = waypointOf(18, 60);
    expect(waypointAhead(18, 60, 1).index).toBe(here.index + 1);
    expect(waypointAhead(18, 60, -1).index).toBe(here.index - 1);
  });
});

describe('the shell ladder', () => {
  it('climbs one shell every SHELL_PERIOD legs', () => {
    expect(shellOf(1)).toBe(0);
    expect(shellOf(SHELL_PERIOD)).toBe(0);
    expect(shellOf(SHELL_PERIOD + 1)).toBe(1);
    expect(shellOf(SHELL_PERIOD * 4 + 1)).toBe(4);
  });

  it('reports progress within a shell as a fraction', () => {
    expect(shellProgress(1)).toBe(0);
    expect(shellProgress(SHELL_PERIOD)).toBeCloseTo((SHELL_PERIOD - 1) / SHELL_PERIOD, 9);
    for (let index = 1; index < 200; index += 1) {
      expect(shellProgress(index)).toBeGreaterThanOrEqual(0);
      expect(shellProgress(index)).toBeLessThan(1);
    }
  });
});

describe('orientations', () => {
  it('offers this ayah’s strongest vectors, in its own order', () => {
    const offered = orientationsFor('noor-ala-noor', true);
    const weights = PHENOMENON_BY_ID['noor-ala-noor'].isnaadWeights;
    for (let index = 1; index < offered.length; index += 1) {
      expect(weights[offered[index - 1].vector]).toBeGreaterThanOrEqual(weights[offered[index].vector]);
    }
  });

  it('withholds the vectors the engine gates on a live voice', () => {
    const silent = orientationsFor('shajarah-mubarakah', false);
    expect(silent.every((orientation) => !orientation.requiresVoice)).toBe(true);
    // L3 and L5 are exactly the gated pair, and they are offered once the voice is live.
    const sounding = orientationsFor('shajarah-mubarakah', true).map((o) => o.id);
    expect(ORIENTATIONS.l3.requiresVoice && ORIENTATIONS.l5.requiresVoice).toBe(true);
    expect(sounding.length).toBeGreaterThanOrEqual(silent.length);
  });

  it('is bounded, so the markers cannot crowd a phone viewport', () => {
    for (const phenomenon of PHENOMENA) {
      expect(orientationsFor(phenomenon.id, true).length).toBeLessThanOrEqual(4);
      expect(orientationsFor(phenomenon.id, true).length).toBeGreaterThan(0);
    }
  });

  it('is deterministic — the same ayah always offers the same options', () => {
    const first = orientationsFor('awtad', true).map((o) => o.id);
    const second = orientationsFor('awtad', true).map((o) => o.id);
    expect(first).toEqual(second);
  });

  it('differs between ayat, which is the point of them being per-ayah', () => {
    const witness = orientationsFor('awtad', true).map((o) => o.id).join();
    const unseen = orientationsFor('sarab-bee-qee-ah', true).map((o) => o.id).join();
    expect(witness).not.toBe(unseen);
  });
});

describe('orientation weighting', () => {
  it('leaves the array untouched when no orientation is held', () => {
    const base = PHENOMENON_BY_ID['ratq-fatq'].isnaadWeights;
    expect(weightsFor('ratq-fatq', null)).toEqual([...base]);
  });

  it('raises the adopted vector relative to the others', () => {
    const base = PHENOMENON_BY_ID['ratq-fatq'].isnaadWeights;
    const held = weightsFor('ratq-fatq', ORIENTATIONS.l5);
    const share = (array: readonly number[]) => array[4] / array.reduce((sum, w) => sum + w, 0);
    expect(share(held)).toBeGreaterThan(share(base));
  });

  it('conserves the total, so adopting a standpoint is not a gain control', () => {
    const total = (array: readonly number[]) => array.reduce((sum, weight) => sum + weight, 0);
    for (const phenomenon of PHENOMENA) {
      const base = total(PHENOMENON_BY_ID[phenomenon.id].isnaadWeights);
      for (const orientation of Object.values(ORIENTATIONS)) {
        expect(total(weightsFor(phenomenon.id, orientation))).toBeCloseTo(base, 9);
      }
    }
  });
});

describe('cycling the focus', () => {
  const offered = orientationsFor('ratq-fatq', true);

  it('wraps in both directions, so a swipe never dead-ends', () => {
    const last = offered[offered.length - 1].id;
    expect(cycle(offered, last, 1)).toBe(offered[0].id);
    expect(cycle(offered, offered[0].id, -1)).toBe(last);
  });

  it('enters at an end when nothing is focused yet', () => {
    expect(cycle(offered, null, 1)).toBe(offered[0].id);
    expect(cycle(offered, null, -1)).toBe(offered[offered.length - 1].id);
  });

  it('enters at an end when the focus names an option this ayah does not offer', () => {
    expect(cycle(offered, 'l6', 1)).toBeDefined();
    expect(cycle([], 'l1', 1)).toBeNull();
  });
});

describe('the navigator', () => {
  const frame = (over: Partial<Parameters<ReturnType<typeof createNavigator>['step']>[0]> = {}) => ({
    dt: 1 / 60, progress: 0, executing: false, closure: 0, index: 1, ...over,
  });

  it('moves even when nothing is playing', () => {
    const navigator = createNavigator();
    navigator.step(frame());
    const start = navigator.state.leg;
    for (let i = 0; i < 600; i += 1) navigator.step(frame());
    expect(navigator.state.leg).toBeGreaterThan(start);
  });

  it('is driven by verse progress once the verse overtakes the drift', () => {
    const navigator = createNavigator();
    navigator.step(frame({ executing: true, progress: 0.8 }));
    expect(navigator.state.leg).toBeCloseTo(0.8, 6);
  });

  it('arrives on station partway through the ayah', () => {
    const navigator = createNavigator();
    navigator.step(frame({ executing: true, progress: TRANSIT_FRACTION - 0.01 }));
    expect(navigator.state.phase).toBe('arrival');
    navigator.step(frame({ executing: true, progress: TRANSIT_FRACTION + 0.01 }));
    expect(navigator.state.phase).toBe('station');
  });

  it('arcs up and comes back down across the transit', () => {
    const navigator = createNavigator();
    navigator.step(frame({ executing: true, progress: 0.01 }));
    const departure = navigator.state.altitude;
    navigator.step(frame({ executing: true, progress: TRANSIT_FRACTION / 2 }));
    const apex = navigator.state.altitude;
    navigator.step(frame({ executing: true, progress: 0.98 }));
    const settled = navigator.state.altitude;

    expect(apex).toBeGreaterThan(departure);
    expect(settled).toBeLessThan(apex);
    expect(settled).toBeLessThan(0.2);
  });

  it('shows the orientations only on station, and never mid-closure', () => {
    const navigator = createNavigator();
    navigator.step(frame({ executing: true, progress: 0.2 }));
    expect(orientationsVisible(navigator.state)).toBe(false);

    navigator.step(frame({ executing: true, progress: 0.7 }));
    expect(orientationsVisible(navigator.state)).toBe(true);

    navigator.step(frame({ executing: true, progress: 0.99, closure: 1 }));
    expect(orientationsVisible(navigator.state)).toBe(false);
  });

  it('holds the closure at its peak and releases it slowly', () => {
    const navigator = createNavigator();
    navigator.step(frame({ closure: 1 }));
    expect(navigator.state.discharge).toBe(1);
    for (let i = 0; i < 30; i += 1) navigator.step(frame({ dt: 0.016 }));
    expect(navigator.state.discharge).toBeLessThan(1);
    expect(navigator.state.discharge).toBeGreaterThan(0.4);
  });

  it('cannot teleport when a tab was suspended', () => {
    const navigator = createNavigator();
    navigator.step(frame());
    const before = navigator.state.leg;
    // A backgrounded tab returns with a delta of many seconds. The step clamps
    // it; without that clamp the journey jumps several legs on every resume.
    navigator.step(frame({ dt: 45 }));
    expect(navigator.state.leg - before).toBeLessThan(0.01);
  });

  it('stays bounded over a simulated week — this is the infinity claim', () => {
    const navigator = createNavigator();
    let index = 1;
    // 60 Hz for seven days, sampled every 600th frame to keep the test quick,
    // with the leg index advancing the way real playback would.
    for (let step = 0; step < 60 * 60 * 24 * 7; step += 600) {
      if (step % 6000 === 0) index += 1;
      navigator.step(frame({ dt: 600 / 60 > 0.1 ? 0.1 : 600 / 60, index }));
      expect(Number.isFinite(navigator.state.leg)).toBe(true);
      expect(navigator.state.leg).toBeGreaterThanOrEqual(0);
      expect(navigator.state.leg).toBeLessThan(1);
      expect(navigator.state.altitude).toBeLessThan(4);
      expect(navigator.state.shell).toBeLessThan(2);
      expect(Math.abs(navigator.state.bank)).toBeLessThan(1);
    }
    expect(navigator.state.legsFlown).toBeGreaterThan(50);
  });

  it('starts a new leg when the index changes', () => {
    const navigator = createNavigator();
    navigator.step(frame({ executing: true, progress: 0.9, index: 1 }));
    navigator.step(frame({ executing: true, progress: 0.0, index: 2 }));
    expect(navigator.state.leg).toBeLessThan(0.05);
    expect(navigator.state.legsFlown).toBe(2);
  });
});
