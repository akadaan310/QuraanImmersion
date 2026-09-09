/**
 * Real sky, real time.
 *
 * Every celestial position in the journey is computed from the machine's actual
 * clock. Nothing here is decorative and nothing is animated on a made-up rate:
 * the Earth turns at the Earth's rate, the terminator falls where it actually
 * falls right now, and the Moon is where the Moon is.
 *
 * ACCURACY, STATED HONESTLY
 * -------------------------
 * These are the standard low-precision series (Meeus, *Astronomical Algorithms*,
 * ch. 25 and 47 — the abridged forms). Their published error bounds:
 *
 *   Sun, apparent longitude      ≈ 0.01°   (≈ 36″)   over 1950–2050
 *   Earth rotation angle          exact to the model; UT1−UTC is ignored,
 *                                 which is at most 0.9 s ⇒ ≈ 0.004° of rotation
 *   Moon, longitude              ≈ 0.3°    (the abridged series keeps only the
 *                                 largest term of each argument)
 *   Moon, distance               ≈ 1000 km
 *
 * That is far inside a pixel for a globe on a phone, and it is nowhere near
 * enough for astrometry. This module is for orientation, not for navigation or
 * for determining prayer times, and it must never be used for either.
 *
 * UNITS. Angles are DEGREES at every boundary of this module; radians appear
 * only inside a function. Distances are kilometres. Time is a Julian Day number
 * in UT. Anything else would eventually be mixed up.
 */

const DEG = Math.PI / 180;
const J2000 = 2451545.0;

/** Reduce an angle to [0, 360). */
export function norm360(degrees: number): number {
  const wrapped = degrees % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/** Reduce an angle to (−180, 180] — the form a longitude has to be in. */
export function norm180(degrees: number): number {
  const wrapped = norm360(degrees);
  return wrapped > 180 ? wrapped - 360 : wrapped;
}

/**
 * Julian Day from a JavaScript Date, in UT.
 *
 * The Date is already UTC internally, so no timezone enters this: two phones in
 * different countries compute the same sky at the same instant, which is the
 * whole point.
 */
export function julianDay(date: Date = new Date()): number {
  return date.getTime() / 86400000 + 2440587.5;
}

/** Julian centuries since J2000.0 — the argument every series below is in. */
export function julianCenturies(jd: number): number {
  return (jd - J2000) / 36525;
}

// ---------------------------------------------------------------- Earth spin

/**
 * Earth Rotation Angle, degrees (IERS Conventions 2010, eq. 5.15).
 *
 * This is the angle the Earth has actually turned — the quantity that decides
 * which meridian faces the Sun. It is linear in UT1 by definition, so unlike
 * GMST there is no series to truncate: the only error is that UT1−UTC (≤0.9 s)
 * is ignored.
 */
export function earthRotationAngle(jd: number): number {
  const t = jd - J2000;
  return norm360(360 * (0.7790572732640 + 1.00273781191135448 * t));
}

/**
 * Greenwich Mean Sidereal Time in degrees.
 *
 * Needed rather than ERA wherever a right ascension has to be turned into a
 * geographic longitude, because RA is measured from the equinox and ERA is not.
 */
export function greenwichMeanSiderealTime(jd: number): number {
  const t = julianCenturies(jd);
  return norm360(
    280.46061837
      + 360.98564736629 * (jd - J2000)
      + 0.000387933 * t * t
      - (t * t * t) / 38710000,
  );
}

/** Obliquity of the ecliptic, degrees (IAU 2006 polynomial, mean obliquity). */
export function obliquity(jd: number): number {
  const t = julianCenturies(jd);
  return 23.439291111
    - 0.0130041667 * t
    - 1.6666667e-7 * t * t
    + 5.027778e-7 * t * t * t;
}

// -------------------------------------------------------------- coordinates

export interface Equatorial {
  /** Right ascension, degrees, [0, 360). */
  ra: number;
  /** Declination, degrees, [−90, 90]. */
  dec: number;
  /** Distance. Kilometres for the Moon, astronomical units for the Sun. */
  distance: number;
}

export interface GeoPoint {
  /** Latitude, degrees, positive north. */
  lat: number;
  /** Longitude, degrees, positive east, (−180, 180]. */
  lon: number;
}

/** Ecliptic (λ, β) → equatorial (α, δ). Both in degrees. */
export function eclipticToEquatorial(lambda: number, beta: number, eps: number): { ra: number; dec: number } {
  const l = lambda * DEG;
  const b = beta * DEG;
  const e = eps * DEG;
  const sinDec = Math.sin(b) * Math.cos(e) + Math.cos(b) * Math.sin(e) * Math.sin(l);
  const dec = Math.asin(Math.max(-1, Math.min(1, sinDec)));
  const y = Math.sin(l) * Math.cos(e) - Math.tan(b) * Math.sin(e);
  const x = Math.cos(l);
  return { ra: norm360(Math.atan2(y, x) / DEG), dec: dec / DEG };
}

/**
 * The point on the Earth's surface with a body directly overhead.
 *
 * For the Sun this is the subsolar point: the centre of the lit hemisphere, and
 * therefore the thing that positions the terminator. Latitude is simply the
 * declination; longitude is the hour angle of the body at Greenwich, negated.
 */
export function subpoint(body: { ra: number; dec: number }, jd: number): GeoPoint {
  return { lat: body.dec, lon: norm180(body.ra - greenwichMeanSiderealTime(jd)) };
}

// --------------------------------------------------------------------- Sun

/**
 * Apparent geocentric position of the Sun (Meeus ch. 25, low precision).
 * Error ≈ 0.01° in longitude across 1950–2050.
 */
export function sunPosition(jd: number): Equatorial {
  const n = jd - J2000;
  const meanLongitude = norm360(280.460 + 0.9856474 * n);
  const meanAnomaly = norm360(357.528 + 0.9856003 * n) * DEG;

  // Equation of the centre, truncated after the second term.
  const lambda = norm360(
    meanLongitude + 1.915 * Math.sin(meanAnomaly) + 0.020 * Math.sin(2 * meanAnomaly),
  );
  const distance = 1.00014 - 0.01671 * Math.cos(meanAnomaly) - 0.00014 * Math.cos(2 * meanAnomaly);

  // The Sun's ecliptic latitude never exceeds 1.2″; zero is the right answer here.
  const { ra, dec } = eclipticToEquatorial(lambda, 0, obliquity(jd));
  return { ra, dec, distance };
}

/** Where the Sun is overhead right now. The centre of the lit half of السيارة. */
export function subsolarPoint(jd: number): GeoPoint {
  return subpoint(sunPosition(jd), jd);
}

// -------------------------------------------------------------------- Moon

/**
 * Geocentric position of the Moon (Meeus ch. 47, abridged to the leading term
 * of each argument). Error ≈ 0.3° in longitude, ≈ 1000 km in distance.
 *
 * That is visibly wrong for an occultation prediction and invisible on a globe
 * the width of a thumb, which is the only place it is used.
 */
export function moonPosition(jd: number): Equatorial {
  const d = jd - J2000;

  const meanLongitude = norm360(218.316 + 13.176396 * d);
  const meanAnomaly = norm360(134.963 + 13.064993 * d) * DEG;
  const argumentOfLatitude = norm360(93.272 + 13.229350 * d) * DEG;

  const lambda = norm360(meanLongitude + 6.289 * Math.sin(meanAnomaly));
  const beta = 5.128 * Math.sin(argumentOfLatitude);
  const distance = 385001 - 20905 * Math.cos(meanAnomaly);

  const { ra, dec } = eclipticToEquatorial(lambda, beta, obliquity(jd));
  return { ra, dec, distance };
}

export interface MoonPhase {
  /** Elongation from the Sun in degrees, 0 = new, 180 = full. */
  elongation: number;
  /** Illuminated fraction of the disc, 0..1. */
  illumination: number;
  /** Age in days since the last new moon, 0..≈29.53. */
  age: number;
  /** True while the Moon is waxing (elongation increasing). */
  waxing: boolean;
}

/** Phase from the geometry, not from a lookup table of dates. */
export function moonPhase(jd: number): MoonPhase {
  const d = jd - J2000;
  const sunLongitude = norm360(280.460 + 0.9856474 * d + 1.915 * Math.sin(norm360(357.528 + 0.9856003 * d) * DEG));
  const moonLongitude = norm360(218.316 + 13.176396 * d + 6.289 * Math.sin(norm360(134.963 + 13.064993 * d) * DEG));

  const elongation = norm360(moonLongitude - sunLongitude);
  const illumination = (1 - Math.cos(elongation * DEG)) / 2;
  const SYNODIC_MONTH = 29.530588853;
  return {
    elongation,
    illumination,
    age: (elongation / 360) * SYNODIC_MONTH,
    waxing: elongation < 180,
  };
}

// ------------------------------------------------------------- local circumstances

/**
 * Apparent solar time at a longitude, in hours [0, 24).
 *
 * The traveller's clock aboard السيارة. It is the true local solar time — the
 * hour angle of the actual Sun — not a timezone, because a timezone is a
 * political boundary and a waypoint in the middle of the Pacific does not have
 * one.
 */
export function localSolarTime(jd: number, longitude: number): number {
  const sun = sunPosition(jd);
  const hourAngle = norm360(greenwichMeanSiderealTime(jd) + longitude - sun.ra);
  // Hour angle 0 is local noon, so shift by half a turn to make 0 h midnight.
  return (norm360(hourAngle + 180) / 15) % 24;
}

/**
 * Solar altitude at a point, degrees. Negative means the Sun is below the
 * horizon there — the night side of the terminator.
 */
export function solarAltitude(jd: number, at: GeoPoint): number {
  const sun = sunPosition(jd);
  const hourAngle = norm360(greenwichMeanSiderealTime(jd) + at.lon - sun.ra) * DEG;
  const lat = at.lat * DEG;
  const dec = sun.dec * DEG;
  const sinAltitude = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(hourAngle);
  return Math.asin(Math.max(-1, Math.min(1, sinAltitude))) / DEG;
}

/** Formatted as ٠٧:٤٢ in Arabic-Indic numerals, matching every other counter. */
export function formatSolarTime(hours: number): string {
  const whole = Math.floor(hours);
  const minutes = Math.floor((hours - whole) * 60);
  const text = `${String(whole).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  return text.replace(/[0-9]/g, (digit) => '٠١٢٣٤٥٦٧٨٩'[Number(digit)]);
}
