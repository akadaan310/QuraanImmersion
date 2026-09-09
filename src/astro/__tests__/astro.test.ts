/**
 * The real-data layer, checked against values that come from outside this
 * codebase.
 *
 * A test that asserts `sunPosition(jd)` equals whatever `sunPosition(jd)`
 * returned when the test was written proves only that nobody edited the file.
 * The assertions below are pinned to independently known quantities — the
 * standard epoch, the equinoxes and solstices, the published rotation rate, the
 * Kaaba's own coordinates — with tolerances set from each series' documented
 * error, not from what happened to pass.
 */

import { describe, expect, it } from 'vitest';

import {
  earthRotationAngle, eclipticToEquatorial, formatSolarTime, greenwichMeanSiderealTime,
  julianDay, localSolarTime, moonPhase, moonPosition, norm180, norm360, obliquity,
  solarAltitude, subsolarPoint, sunPosition,
} from '../ephemeris';
import {
  EARTH_RADIUS_KM, QIBLA, centralAngle, distanceKm, initialBearing, interpolate,
  qiblaBearing, toGeo, toVector,
} from '../geo';
import { BRIGHT_STARS, magnitudeFlux } from '../stars';

/** J2000.0 — 2000 January 1, 12:00 TT. The epoch every series is written about. */
const J2000 = 2451545.0;
const utc = (iso: string) => julianDay(new Date(iso));

describe('julian day', () => {
  it('places the standard epoch where the definition puts it', () => {
    // The Julian Day of 2000-01-01T12:00:00Z is 2451545.0 by definition.
    expect(utc('2000-01-01T12:00:00Z')).toBeCloseTo(J2000, 9);
  });

  it('advances by exactly one per day', () => {
    expect(utc('2026-03-02T00:00:00Z') - utc('2026-03-01T00:00:00Z')).toBeCloseTo(1, 9);
  });

  it('is unaffected by the machine timezone', () => {
    // Both strings name the same instant; a Date built from either must agree.
    expect(utc('2026-06-01T00:00:00Z')).toBeCloseTo(utc('2026-06-01T02:00:00+02:00'), 9);
  });
});

describe('angle normalisation', () => {
  it('wraps into the ranges the rest of the module assumes', () => {
    expect(norm360(-1)).toBeCloseTo(359, 9);
    expect(norm360(721)).toBeCloseTo(1, 9);
    expect(norm180(190)).toBeCloseTo(-170, 9);
    expect(norm180(-190)).toBeCloseTo(170, 9);
    expect(norm180(180)).toBeCloseTo(180, 9);
  });
});

describe('Earth rotation', () => {
  it('turns once per sidereal day, not once per solar day', () => {
    // A sidereal day is 23h56m04.0905s = 0.99726956633 mean solar days. After
    // exactly that interval the Earth must have turned a whole number of turns.
    const before = earthRotationAngle(J2000);
    const after = earthRotationAngle(J2000 + 0.99726956633);
    expect(Math.abs(norm180(after - before))).toBeLessThan(0.001);
  });

  it('advances about 15.041° per hour of UT', () => {
    const rate = norm360(earthRotationAngle(J2000 + 1 / 24) - earthRotationAngle(J2000));
    expect(rate).toBeCloseTo(15.0411, 3);
  });

  it('agrees with GMST to within the precession term across a decade', () => {
    // ERA and GMST differ by the accumulated precession in right ascension —
    // about 0.0128° per year. Over ten years that is ~0.13°, and no more.
    const drift = Math.abs(norm180(
      greenwichMeanSiderealTime(J2000 + 3652.5) - earthRotationAngle(J2000 + 3652.5),
    ) - norm180(greenwichMeanSiderealTime(J2000) - earthRotationAngle(J2000)));
    expect(drift).toBeLessThan(0.2);
  });
});

describe('obliquity', () => {
  it('is 23.4393° at J2000 and decreasing', () => {
    // IAU value: 23° 26′ 21.406″ = 23.439291°, decreasing by ~47″ per century.
    expect(obliquity(J2000)).toBeCloseTo(23.439291, 4);
    expect(obliquity(J2000 + 36525)).toBeLessThan(obliquity(J2000));
    expect(obliquity(J2000) - obliquity(J2000 + 36525)).toBeCloseTo(47 / 3600, 3);
  });
});

describe('the Sun', () => {
  it('crosses the celestial equator at the equinoxes', () => {
    // March equinox 2026 is 2026-03-20 around 14:46 UTC; September around
    // 2026-09-23 00:05 UTC. The declination must be ~0 within the series' error.
    expect(Math.abs(sunPosition(utc('2026-03-20T14:46:00Z')).dec)).toBeLessThan(0.02);
    expect(Math.abs(sunPosition(utc('2026-09-23T00:05:00Z')).dec)).toBeLessThan(0.02);
  });

  it('reaches the tropics at the solstices', () => {
    // At solstice the declination equals the obliquity, ±.
    const june = sunPosition(utc('2026-06-21T08:24:00Z'));
    const december = sunPosition(utc('2026-12-21T20:50:00Z'));
    expect(june.dec).toBeCloseTo(23.44, 1);
    expect(december.dec).toBeCloseTo(-23.44, 1);
  });

  it('is nearest in early January and furthest in early July', () => {
    // Perihelion ≈ 0.9833 AU around 3 January; aphelion ≈ 1.0167 AU around 4 July.
    expect(sunPosition(utc('2026-01-03T00:00:00Z')).distance).toBeCloseTo(0.9833, 3);
    expect(sunPosition(utc('2026-07-04T00:00:00Z')).distance).toBeCloseTo(1.0167, 3);
  });

  it('has a subsolar point that circles the Earth once a day', () => {
    const now = utc('2026-05-05T00:00:00Z');
    const later = subsolarPoint(now + 1 / 24);
    const earlier = subsolarPoint(now);
    // Westward by very nearly 15° an hour.
    expect(norm180(earlier.lon - later.lon)).toBeCloseTo(15, 0);
    // And it never leaves the tropics.
    expect(Math.abs(earlier.lat)).toBeLessThanOrEqual(23.5);
  });
});

describe('the Moon', () => {
  it('completes a synodic cycle in 29.53 days', () => {
    const start = utc('2026-01-01T00:00:00Z');
    const first = moonPhase(start).elongation;
    const after = moonPhase(start + 29.530588853).elongation;
    expect(Math.abs(norm180(after - first))).toBeLessThan(3);
  });

  it('reports illumination consistent with elongation', () => {
    const jd = utc('2026-04-11T00:00:00Z');
    const phase = moonPhase(jd);
    expect(phase.illumination).toBeGreaterThanOrEqual(0);
    expect(phase.illumination).toBeLessThanOrEqual(1);
    // The relation is exactly (1 − cos E)/2 and must not drift from it.
    expect(phase.illumination).toBeCloseTo((1 - Math.cos((phase.elongation * Math.PI) / 180)) / 2, 12);
  });

  it('stays within the real range of lunar distances', () => {
    // Perigee ≈ 356 500 km, apogee ≈ 406 700 km. The abridged series must not
    // wander outside that by more than its own ~1000 km error.
    for (let day = 0; day < 60; day += 1) {
      const distance = moonPosition(utc('2026-01-01T00:00:00Z') + day).distance;
      expect(distance).toBeGreaterThan(355000);
      expect(distance).toBeLessThan(408000);
    }
  });

  it('never leaves the band the 5.1° inclination allows', () => {
    for (let day = 0; day < 40; day += 1) {
      expect(Math.abs(moonPosition(J2000 + day).dec)).toBeLessThan(29);
    }
  });
});

describe('coordinate conversion', () => {
  it('maps the ecliptic pole to the pole of the ecliptic', () => {
    const { dec } = eclipticToEquatorial(0, 90, 23.4392911);
    expect(dec).toBeCloseTo(90 - 23.4392911, 6);
  });

  it('leaves the vernal equinox at the origin of both systems', () => {
    const { ra, dec } = eclipticToEquatorial(0, 0, 23.4392911);
    expect(ra).toBeCloseTo(0, 9);
    expect(dec).toBeCloseTo(0, 9);
  });
});

describe('local circumstances', () => {
  it('puts solar noon near 12h at the subsolar longitude', () => {
    const jd = utc('2026-08-14T09:00:00Z');
    const sub = subsolarPoint(jd);
    expect(localSolarTime(jd, sub.lon)).toBeCloseTo(12, 1);
  });

  it('puts the Sun overhead at the subsolar point and under the antipode', () => {
    const jd = utc('2026-08-14T09:00:00Z');
    const sub = subsolarPoint(jd);
    expect(solarAltitude(jd, sub)).toBeCloseTo(90, 1);
    expect(solarAltitude(jd, { lat: -sub.lat, lon: norm180(sub.lon + 180) })).toBeCloseTo(-90, 1);
  });

  it('formats the hour in Arabic-Indic numerals', () => {
    expect(formatSolarTime(7.5)).toBe('٠٧:٣٠');
    expect(formatSolarTime(0)).toBe('٠٠:٠٠');
    expect(formatSolarTime(23.99)).toBe('٢٣:٥٩');
  });
});

describe('geodesy', () => {
  it('round-trips a coordinate through the vector frame', () => {
    for (const point of [QIBLA, { lat: -33.87, lon: 151.21 }, { lat: 64.14, lon: -21.94 }]) {
      const back = toGeo(toVector(point));
      expect(back.lat).toBeCloseTo(point.lat, 9);
      expect(back.lon).toBeCloseTo(point.lon, 9);
    }
  });

  it('puts the north pole on +Y, as the renderer assumes', () => {
    const pole = toVector({ lat: 90, lon: 0 });
    expect(pole.y).toBeCloseTo(1, 12);
    expect(Math.hypot(pole.x, pole.z)).toBeLessThan(1e-9);
  });

  it('measures a quarter of the great circle from equator to pole', () => {
    expect(centralAngle({ lat: 0, lon: 0 }, { lat: 90, lon: 0 })).toBeCloseTo(Math.PI / 2, 12);
    expect(distanceKm({ lat: 0, lon: 0 }, { lat: 90, lon: 0 }))
      .toBeCloseTo((Math.PI / 2) * EARTH_RADIUS_KM, 6);
  });

  it('agrees with a published distance', () => {
    // London Heathrow to New York JFK is about 5555 km great-circle. A sphere
    // is good to a few tenths of a percent here.
    const km = distanceKm({ lat: 51.4700, lon: -0.4543 }, { lat: 40.6413, lon: -73.7781 });
    expect(km).toBeGreaterThan(5500);
    expect(km).toBeLessThan(5610);
  });

  it('gives a bearing of due north up a meridian and due east along the equator', () => {
    expect(initialBearing({ lat: 0, lon: 0 }, { lat: 10, lon: 0 })).toBeCloseTo(0, 9);
    expect(initialBearing({ lat: 0, lon: 0 }, { lat: 0, lon: 10 })).toBeCloseTo(90, 9);
    expect(initialBearing({ lat: 0, lon: 0 }, { lat: -10, lon: 0 })).toBeCloseTo(180, 9);
  });

  it('points the qibla the way it is actually known to point', () => {
    // Cairo is a little south of east of nothing — the Kaaba is south-east of
    // it, around 136°. Jakarta faces west-north-west, around 295°.
    expect(qiblaBearing({ lat: 30.0444, lon: 31.2357 })).toBeGreaterThan(130);
    expect(qiblaBearing({ lat: 30.0444, lon: 31.2357 })).toBeLessThan(142);
    expect(qiblaBearing({ lat: -6.2088, lon: 106.8456 })).toBeGreaterThan(290);
    expect(qiblaBearing({ lat: -6.2088, lon: 106.8456 })).toBeLessThan(300);
  });

  it('interpolates along the geodesic, not along the coordinates', () => {
    // Halfway from (0,0) to (0,90) on a great circle is (0,45) — which the
    // coordinates happen to agree with. Halfway from (60,0) to (60,180) is the
    // POLE, which they emphatically do not.
    const equatorial = interpolate({ lat: 0, lon: 0 }, { lat: 0, lon: 90 }, 0.5);
    expect(equatorial.lat).toBeCloseTo(0, 9);
    expect(equatorial.lon).toBeCloseTo(45, 9);

    const overThePole = interpolate({ lat: 60, lon: 0 }, { lat: 60, lon: 180 }, 0.5);
    expect(overThePole.lat).toBeCloseTo(90, 6);
  });

  it('returns the endpoints exactly at t = 0 and t = 1', () => {
    const from = { lat: 12.3, lon: -45.6 };
    const to = { lat: -7.8, lon: 90.1 };
    expect(interpolate(from, to, 0).lat).toBeCloseTo(from.lat, 9);
    expect(interpolate(from, to, 1).lat).toBeCloseTo(to.lat, 9);
    expect(interpolate(from, to, 1).lon).toBeCloseTo(to.lon, 9);
  });

  it('does not produce NaN for antipodal or identical points', () => {
    const antipodal = interpolate({ lat: 10, lon: 20 }, { lat: -10, lon: -160 }, 0.5);
    expect(Number.isFinite(antipodal.lat)).toBe(true);
    expect(Number.isFinite(antipodal.lon)).toBe(true);

    const identical = interpolate({ lat: 5, lon: 5 }, { lat: 5, lon: 5 }, 0.5);
    expect(identical.lat).toBeCloseTo(5, 9);
  });
});

describe('the star catalogue', () => {
  it('holds only coordinates that exist', () => {
    for (const star of BRIGHT_STARS) {
      expect(star.ra).toBeGreaterThanOrEqual(0);
      expect(star.ra).toBeLessThan(360);
      expect(star.dec).toBeGreaterThanOrEqual(-90);
      expect(star.dec).toBeLessThanOrEqual(90);
      expect(star.name).toMatch(/[؀-ۿ]/);   // the label must be Arabic
    }
  });

  it('has no duplicate designations', () => {
    const seen = new Set(BRIGHT_STARS.map((star) => star.designation));
    expect(seen.size).toBe(BRIGHT_STARS.length);
  });

  it('leads with Sirius and holds the naked-eye range', () => {
    const brightest = BRIGHT_STARS.reduce((a, b) => (a.mag <= b.mag ? a : b));
    expect(brightest.designation).toBe('α CMa');
    expect(Math.max(...BRIGHT_STARS.map((star) => star.mag))).toBeLessThan(3.5);
  });

  it('converts magnitude to flux by Pogson’s ratio', () => {
    // Five magnitudes is exactly a factor of one hundred.
    expect(magnitudeFlux(0, 0)).toBeCloseTo(1, 12);
    expect(magnitudeFlux(5, 0)).toBeCloseTo(0.01, 12);
    expect(magnitudeFlux(-1.46)).toBeCloseTo(1, 12);
  });
});
