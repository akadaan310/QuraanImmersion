/**
 * Geodesy for السيارة — the Earth taken as the vehicle.
 *
 * سِيرُوا۟ فِى ٱلْأَرْضِ. The journey is a real traversal of a real sphere, so the
 * path between two waypoints is a great circle and not a line drawn on a
 * flattened rectangle. Every helper here is spherical.
 *
 * The sphere is a sphere, not the WGS-84 ellipsoid. The difference peaks at
 * about 0.3% of a distance — twenty kilometres in a seven-thousand kilometre
 * leg — which is below the width of the drawn track and irrelevant to a camera
 * path. Where the ellipsoid would matter (a bearing quoted to the arcminute) it
 * is not used.
 */

import * as THREE from 'three';

const DEG = Math.PI / 180;

/** Mean Earth radius, kilometres (IUGG). */
export const EARTH_RADIUS_KM = 6371.0088;

/**
 * ٱلْكَعْبَة — the reference every bearing in the journey is quoted against.
 * Coordinates of the Kaaba to five decimals.
 */
export const QIBLA: GeoPoint = { lat: 21.42251, lon: 39.82616 };

export interface GeoPoint {
  lat: number;
  lon: number;
}

/**
 * Geographic point → unit vector in an Earth-fixed frame.
 *
 * The frame: +Y is the north pole, +X pierces (0°N, 0°E), +Z pierces (0°N, 90°E).
 * Three.js is Y-up, so putting the pole on +Y means the globe's spin is a
 * rotation about the scene's own vertical and nothing needs a correction
 * quaternion anywhere else.
 */
export function toVector(point: GeoPoint, radius = 1, target = new THREE.Vector3()): THREE.Vector3 {
  const lat = point.lat * DEG;
  const lon = point.lon * DEG;
  const cosLat = Math.cos(lat);
  return target.set(
    radius * cosLat * Math.cos(lon),
    radius * Math.sin(lat),
    radius * cosLat * Math.sin(lon),
  );
}

/** The inverse, for reading a coordinate back off a position on the globe. */
export function toGeo(vector: THREE.Vector3): GeoPoint {
  const length = vector.length() || 1;
  return {
    lat: Math.asin(THREE.MathUtils.clamp(vector.y / length, -1, 1)) / DEG,
    lon: Math.atan2(vector.z, vector.x) / DEG,
  };
}

/** Angular separation between two points, radians. */
export function centralAngle(from: GeoPoint, to: GeoPoint): number {
  const lat1 = from.lat * DEG;
  const lat2 = to.lat * DEG;
  const dLat = lat2 - lat1;
  const dLon = (to.lon - from.lon) * DEG;
  // Haversine rather than the spherical law of cosines: the latter loses all
  // its precision for short legs, and consecutive waypoints are often close.
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Great-circle distance in kilometres. */
export function distanceKm(from: GeoPoint, to: GeoPoint): number {
  return centralAngle(from, to) * EARTH_RADIUS_KM;
}

/** Initial bearing from one point to another, degrees clockwise from north. */
export function initialBearing(from: GeoPoint, to: GeoPoint): number {
  const lat1 = from.lat * DEG;
  const lat2 = to.lat * DEG;
  const dLon = (to.lon - from.lon) * DEG;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (Math.atan2(y, x) / DEG + 360) % 360;
}

/**
 * Bearing to the Kaaba from anywhere on the sphere.
 *
 * This is the great-circle bearing — the same quantity a compass app calls the
 * qibla. It is displayed as a direction in the journey, not used to establish
 * one: an approximate sphere and no magnetic declination make it unfit for that.
 */
export function qiblaBearing(from: GeoPoint): number {
  return initialBearing(from, QIBLA);
}

/**
 * Interpolate along the great circle between two points.
 *
 * Slerp on the unit vectors, which is the geodesic by construction. The
 * degenerate case — antipodal points, where the great circle is not unique —
 * is nudged rather than left to produce a NaN that would silently freeze the
 * camera for a whole ayah.
 */
export function interpolate(from: GeoPoint, to: GeoPoint, t: number): GeoPoint {
  const a = toVector(from);
  const b = toVector(to);
  const dot = THREE.MathUtils.clamp(a.dot(b), -1, 1);

  if (dot > 0.999999) return { lat: from.lat, lon: from.lon };
  if (dot < -0.999999) {
    // Antipodal: pick a definite meridian instead of an undefined one.
    return interpolate(from, { lat: to.lat, lon: to.lon + 0.001 }, t);
  }

  const omega = Math.acos(dot);
  const sinOmega = Math.sin(omega);
  const scaleA = Math.sin((1 - t) * omega) / sinOmega;
  const scaleB = Math.sin(t * omega) / sinOmega;
  return toGeo(a.multiplyScalar(scaleA).add(b.multiplyScalar(scaleB)));
}

/** A polyline along the great circle, for drawing the track actually flown. */
export function greatCirclePoints(from: GeoPoint, to: GeoPoint, segments = 64, radius = 1): THREE.Vector3[] {
  const points: THREE.Vector3[] = [];
  for (let index = 0; index <= segments; index += 1) {
    points.push(toVector(interpolate(from, to, index / segments), radius));
  }
  return points;
}

/** Arabic-Indic coordinate readout: ٢١.٤٢° شمالاً · ٣٩.٨٣° شرقاً */
export function formatGeo(point: GeoPoint): string {
  const digits = (value: number) =>
    Math.abs(value).toFixed(2).replace(/[0-9]/g, (digit) => '٠١٢٣٤٥٦٧٨٩'[Number(digit)]);
  const ns = point.lat >= 0 ? 'شمالاً' : 'جنوباً';
  const ew = point.lon >= 0 ? 'شرقاً' : 'غرباً';
  return `${digits(point.lat)}° ${ns} · ${digits(point.lon)}° ${ew}`;
}

/**
 * The eight directions, in Arabic, for a bearing in degrees.
 * Used for the qibla readout, where a number alone reads as false precision.
 */
export function bearingName(degrees: number): string {
  const NAMES = ['شمال', 'شمال شرق', 'شرق', 'جنوب شرق', 'جنوب', 'جنوب غرب', 'غرب', 'شمال غرب'];
  return NAMES[Math.round(((degrees % 360) + 360) % 360 / 45) % 8];
}
