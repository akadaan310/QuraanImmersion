/**
 * الإسنادات — the isnaad orientations.
 *
 * These are the only interactive elements in the whole application. There is no
 * transport bar, no picker, no menu, no settings. Between two and four
 * orientations appear at each ayah, positioned in space around the station, and
 * the observer either swipes between them or taps one. Nothing else responds to
 * touch.
 *
 * WHAT AN ORIENTATION IS
 * ----------------------
 * The six-vector array already describes six distinct standpoints on the same
 * recitation — the command that opened it (L1), the voice (L2), the physical
 * target (L3), the terrestrial witness (L4), the unseen audience (L5), the
 * returned salām that closes the circuit (L6). An orientation adopts one of them:
 * the camera moves to where that vector stands, and the vector's own weight in
 * the scene is raised so the visual field is genuinely being read from there.
 *
 * WHY THEY DIFFER PER AYAH
 * ------------------------
 * Which orientations appear is not a fixed menu. Each phenomenon already carries
 * an emphasis profile (`isnaadWeights`), and the orientations offered are that
 * ayah's strongest vectors, in its own order. An ayah whose scene is weighted
 * toward the unseen offers the unseen; one weighted toward the witness does not.
 * The options are therefore a property of the ayah, which is exactly what the
 * dependency graph in the engine already says they are.
 *
 * L3 and L5 are gated on L2 in the engine — they cannot exist without a live
 * vocal anchor — so they are withheld until the voice is actually sounding.
 * Offering an orientation that the engine would refuse to honour would be a lie
 * told by the interface.
 */

import { PHENOMENON_BY_ID, type PhenomenonId } from '@/data/phenomena';

export type OrientationId = 'l1' | 'l2' | 'l3' | 'l4' | 'l5' | 'l6';

export interface Orientation {
  id: OrientationId;
  /** Index into the six-vector array, 0-based. */
  vector: number;
  /** Full Arabic name of the vector. */
  name: string;
  /** Two- or three-letter Arabic sigil, for the marker in space. */
  sigil: string;
  /** One line of Arabic on what adopting it does to the view. */
  brief: string;

  /** Distance from the station, in station radii. */
  distance: number;
  /** Elevation above the station's local horizon, degrees. Negative looks up. */
  elevation: number;
  /** Field of view the camera adopts, degrees. */
  fov: number;
  /** Roll about the view axis, degrees. */
  roll: number;
  /** Multiplier applied to this vector's weight while the orientation is held. */
  gain: number;
  /** True while the vector needs a live vocal anchor to exist at all. */
  requiresVoice: boolean;
}

/**
 * The six standpoints. Distances and elevations are not decoration: they place
 * the camera where the vector's own description says it stands.
 */
export const ORIENTATIONS: Record<OrientationId, Orientation> = {
  l1: {
    id: 'l1', vector: 0,
    name: 'إسناد الأمر والتشغيل', sigil: 'أمر',
    brief: 'من حيث فُتِحت الحالة — المنظور عند لحظة التشغيل، قبل أن يمتد الصوت.',
    distance: 1.0, elevation: 12, fov: 55, roll: 0, gain: 1.8, requiresVoice: false,
  },
  l2: {
    id: 'l2', vector: 1,
    name: 'إسناد الصوت والربط', sigil: 'صوت',
    brief: 'من داخل الصوت نفسه — الحقل يُقرأ من موضع المُحلِّل الطيفي.',
    distance: 0.55, elevation: 0, fov: 72, roll: 0, gain: 1.9, requiresVoice: false,
  },
  l3: {
    id: 'l3', vector: 2,
    name: 'الهدف المادي', sigil: 'مادة',
    brief: 'من الجسم المستهدَف — قريبٌ من السطح، حيث تقع الاستجابة الفيزيائية.',
    distance: 0.38, elevation: -18, fov: 84, roll: 0, gain: 1.7, requiresVoice: true,
  },
  l4: {
    id: 'l4', vector: 3,
    name: 'الشاهد الأرضي', sigil: 'شاهد',
    brief: 'من الأرض — السيارة تحت القدمين، والظاهرة تُرى من موضع الشهود.',
    distance: 1.9, elevation: -6, fov: 48, roll: 0, gain: 1.5, requiresVoice: false,
  },
  l5: {
    id: 'l5', vector: 4,
    name: 'المستمع غير المرئي', sigil: 'خفي',
    brief: 'من خلف الصوت بمقدار التأخير — يُرى الحقل كما يبلغ سامعاً لا يُرى.',
    distance: 2.6, elevation: 34, fov: 40, roll: 8, gain: 1.6, requiresVoice: true,
  },
  l6: {
    id: 'l6', vector: 5,
    name: 'الصدى الغيبي — ردّ السلام', sigil: 'صدى',
    brief: 'من نقطة الإغلاق — الدارة تُرى وهي تنغلق، والحقل يتمدد مرة واحدة.',
    distance: 3.4, elevation: 62, fov: 34, roll: -6, gain: 2.0, requiresVoice: false,
  },
};

const ORDER: OrientationId[] = ['l1', 'l2', 'l3', 'l4', 'l5', 'l6'];

/**
 * The orientations this ayah offers, strongest first.
 *
 * `voice` is whether a vocal anchor is currently live. When it is not, the two
 * gated vectors are withheld — not greyed out, absent: an option that cannot be
 * taken should not occupy space in a field the observer is swiping through.
 *
 * The count is bounded to four. Beyond that the markers crowd each other on a
 * phone-sized viewport and a swipe stops selecting reliably, which would break
 * the only input the application has.
 */
export function orientationsFor(phenomenon: PhenomenonId, voice: boolean, limit = 4): Orientation[] {
  const weights = PHENOMENON_BY_ID[phenomenon].isnaadWeights;

  return ORDER
    .map((id) => ({ orientation: ORIENTATIONS[id], weight: weights[ORIENTATIONS[id].vector] }))
    .filter(({ orientation }) => voice || !orientation.requiresVoice)
    // Ties are broken by vector order rather than left to the sort's stability,
    // so the same ayah always presents the same options in the same places.
    .sort((a, b) => (b.weight - a.weight) || (a.orientation.vector - b.orientation.vector))
    .slice(0, limit)
    .map(({ orientation }) => orientation);
}

/**
 * The weight array to hand the engine while an orientation is held.
 *
 * The adopted vector is amplified and the others are drawn down slightly, then
 * the whole array is renormalised to its original sum. Without the
 * renormalisation, adopting an orientation would raise the total energy of the
 * array and every scene would simply get brighter — which reads as a gain
 * control, not as a change of standpoint.
 */
export function weightsFor(
  phenomenon: PhenomenonId,
  orientation: Orientation | null,
): [number, number, number, number, number, number] {
  const base = PHENOMENON_BY_ID[phenomenon].isnaadWeights;
  if (!orientation) return [...base] as [number, number, number, number, number, number];

  const adjusted = base.map((weight, index) =>
    index === orientation.vector ? weight * orientation.gain : weight * 0.82,
  );
  const before = base.reduce((sum, weight) => sum + weight, 0);
  const after = adjusted.reduce((sum, weight) => sum + weight, 0) || 1;
  const scale = before / after;

  return adjusted.map((weight) => weight * scale) as [number, number, number, number, number, number];
}

/** Step through the offered orientations. Wraps, so a swipe never dead-ends. */
export function cycle(offered: Orientation[], current: OrientationId | null, direction: 1 | -1): OrientationId | null {
  if (offered.length === 0) return null;
  const at = offered.findIndex((orientation) => orientation.id === current);
  if (at < 0) return offered[direction > 0 ? 0 : offered.length - 1].id;
  return offered[(at + direction + offered.length) % offered.length].id;
}
