/**
 * The experiences.
 *
 * Two things are worth testing here and both are claims the README makes:
 *
 *   1. COVERAGE. Every ayah in the muṣḥaf is reachable. This is the whole point
 *      of generating the surah routes rather than hand-writing a library, and it
 *      is the kind of claim that is true when written and quietly false three
 *      commits later.
 *
 *   2. VALIDITY. Every hand-compiled thematic reference exists. The check is
 *      arithmetic — it knows 2:290 is not an ayah because al-Baqarah has 286 —
 *      and it is deliberately not more than that. It cannot know whether the
 *      span chosen for فرق البحر is the right span, and pretending otherwise
 *      with a test would be worse than not testing it.
 */

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_EXPERIENCE, EXPERIENCES, EXPERIENCE_BY_ID, GROUPS, SURAH_EXPERIENCES,
  THEMATIC_EXPERIENCES, labelOf, positionOf, surahExperienceFor,
} from '../experiences';
import { PHENOMENON_BY_ID } from '../phenomena';
import { SURAHS, ayahCountOf } from '../surahs';

const TOTAL_AYAT = 6236;

describe('coverage', () => {
  it('reaches every ayah in the muṣḥaf, exactly once, through the surah routes', () => {
    const seen = new Set<string>();
    for (const experience of SURAH_EXPERIENCES) {
      for (const ref of experience.ayat()) {
        const key = `${ref.surah}:${ref.ayah}`;
        expect(seen.has(key)).toBe(false);       // no ayah twice
        seen.add(key);
      }
    }
    expect(seen.size).toBe(TOTAL_AYAT);

    // And the other direction: nothing in the muṣḥaf is missing.
    for (let surah = 1; surah <= 114; surah += 1) {
      for (let ayah = 1; ayah <= ayahCountOf(surah); ayah += 1) {
        expect(seen.has(`${surah}:${ayah}`)).toBe(true);
      }
    }
  });

  it('has one surah route per surah, in order, each the full surah', () => {
    expect(SURAH_EXPERIENCES).toHaveLength(114);
    SURAH_EXPERIENCES.forEach((experience, index) => {
      const surah = SURAHS[index];
      expect(experience.id).toBe(`surah-${surah.number}`);
      expect(experience.title).toBe(surah.name);
      expect(experience.count).toBe(surah.ayahCount);
      expect(experience.ayat()).toHaveLength(surah.ayahCount);
      expect(experience.ayat()[0]).toMatchObject({ surah: surah.number, ayah: 1 });
    });
  });

  it('leaves nothing reachable only through a thematic route', () => {
    // The thematic routes are extra paths, never the only path. If one ever
    // names an ayah the surah routes do not, the coverage claim above has
    // quietly become the weaker "reachable somehow".
    const throughSurahs = new Set(
      SURAH_EXPERIENCES.flatMap((experience) =>
        experience.ayat().map((ref) => `${ref.surah}:${ref.ayah}`)),
    );
    for (const experience of THEMATIC_EXPERIENCES) {
      for (const ref of experience.ayat()) {
        expect(throughSurahs.has(`${ref.surah}:${ref.ayah}`)).toBe(true);
      }
    }
  });
});

describe('validity', () => {
  it('names only ayat that exist', () => {
    for (const experience of EXPERIENCES) {
      for (const ref of experience.ayat()) {
        expect(ref.surah, experience.id).toBeGreaterThanOrEqual(1);
        expect(ref.surah, experience.id).toBeLessThanOrEqual(114);
        expect(ref.ayah, `${experience.id} ${ref.surah}:${ref.ayah}`).toBeGreaterThanOrEqual(1);
        expect(ref.ayah, `${experience.id} ${ref.surah}:${ref.ayah}`)
          .toBeLessThanOrEqual(ayahCountOf(ref.surah));
      }
    }
  });

  it('names only phenomena that exist', () => {
    for (const experience of EXPERIENCES) {
      for (const ref of experience.ayat()) {
        if (ref.phenomenon) expect(PHENOMENON_BY_ID[ref.phenomenon], ref.phenomenon).toBeDefined();
      }
    }
  });

  it('has a unique id for every route, and the index agrees', () => {
    const ids = new Set(EXPERIENCES.map((experience) => experience.id));
    expect(ids.size).toBe(EXPERIENCES.length);
    for (const experience of EXPERIENCES) {
      expect(EXPERIENCE_BY_ID[experience.id]).toBe(experience);
    }
  });

  it('has no empty route — a route with no waypoints cannot be flown', () => {
    for (const experience of EXPERIENCES) {
      expect(experience.count, experience.id).toBeGreaterThan(0);
      expect(experience.ayat().length, experience.id).toBe(experience.count);
    }
  });

  it('opens on a route that exists', () => {
    expect(EXPERIENCE_BY_ID[DEFAULT_EXPERIENCE]).toBeDefined();
  });

  it('renders Arabic only — no Latin text reaches the interface', () => {
    // The repository's hard constraint, checked here at the data level rather
    // than only by the source scanner: a title or a brief is displayed text.
    const LATIN = /[A-Za-z]/;
    for (const experience of EXPERIENCES) {
      expect(LATIN.test(experience.title), experience.id).toBe(false);
      expect(LATIN.test(experience.brief), experience.id).toBe(false);
      expect(LATIN.test(experience.sigil), experience.id).toBe(false);
    }
  });

  it('uses Arabic-Indic numerals in every label', () => {
    expect(labelOf({ surah: 18, ayah: 60 })).toBe('الكهف · ٦٠');
    expect(/[0-9]/.test(labelOf({ surah: 2, ayah: 255 }))).toBe(false);
  });
});

describe('موسى', () => {
  const musa = THEMATIC_EXPERIENCES.filter((experience) => experience.title.startsWith('موسى'));

  it('is many routes, not one', () => {
    expect(musa.length).toBeGreaterThanOrEqual(8);
  });

  it('gives each route a distinct set of waypoints', () => {
    const signatures = musa.map((experience) =>
      experience.ayat().map((ref) => `${ref.surah}:${ref.ayah}`).join('|'));
    expect(new Set(signatures).size).toBe(musa.length);
  });

  it('draws from more than one surah where the account is spread across several', () => {
    const spread = musa.find((experience) => experience.id === 'musa-farq-bahr');
    expect(spread).toBeDefined();
    const surahs = new Set(spread!.ayat().map((ref) => ref.surah));
    expect(surahs.size).toBeGreaterThan(1);
  });
});

describe('groups', () => {
  it('assigns every route to a declared group', () => {
    const declared = new Set(GROUPS.map((group) => group.id));
    for (const experience of EXPERIENCES) {
      expect(declared.has(experience.group), experience.id).toBe(true);
    }
  });

  it('has every group populated', () => {
    for (const group of GROUPS) {
      expect(EXPERIENCES.some((experience) => experience.group === group.id), group.id).toBe(true);
    }
  });
});

describe('navigation helpers', () => {
  it('finds an ayah inside a route, and reports −1 when it is not there', () => {
    const kahf = surahExperienceFor(18);
    expect(positionOf(kahf, 18, 60)).toBe(59);
    expect(positionOf(kahf, 2, 1)).toBe(-1);
  });

  it('maps a surah to its own route, clamping out-of-range input', () => {
    expect(surahExperienceFor(1).id).toBe('surah-1');
    expect(surahExperienceFor(114).id).toBe('surah-114');
    expect(surahExperienceFor(0).id).toBe('surah-1');
    expect(surahExperienceFor(999).id).toBe('surah-114');
  });

  it('enters a thematic route at the ayah already being flown', () => {
    // 18:60 is the first waypoint of موسى ومجمع البحرين, so a journey standing
    // there that opens that route continues rather than restarting.
    const khidr = EXPERIENCE_BY_ID['musa-khidr'];
    expect(positionOf(khidr, 18, 60)).toBe(0);
    expect(positionOf(khidr, 18, 82)).toBe(khidr.count - 1);
  });
});
