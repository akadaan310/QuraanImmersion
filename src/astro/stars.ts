/**
 * مواقع النجوم — an embedded catalogue of the brightest stars.
 *
 * WHAT THIS IS. Seventy-odd real stars, at their real J2000 equatorial
 * coordinates, with their real visual magnitudes. When the journey turns to face
 * a star, that star is where the sky actually has it, and the sky rotates
 * because the Earth rotates (`earthRotationAngle`), not because a timer is
 * incrementing a rotation.
 *
 * ACCURACY, STATED HONESTLY. Positions are carried to three decimal places of a
 * degree but are reliable to roughly 0.1° — the catalogue is compact and
 * hand-carried, not machine-generated from Hipparcos. Proper motion is ignored
 * entirely: over the decades this code might run, the largest proper motion in
 * the list (Arcturus, ≈2.3″/year) moves it about 0.02°. This is a sky to be
 * oriented by and looked at. It is not an astrometric source, and nothing in
 * the app derives a time, a direction of prayer, or a date from it.
 *
 * THE NAMES. Most of these names are Arabic already — Aldebaran is الدَّبَران,
 * Altair is الطائر, Betelgeuse is إبط الجوزاء — because the catalogue that
 * reached Europe came through Arabic. The Arabic name is therefore the star's
 * own name here, not a translation of a Latin one, and the app's no-translation
 * constraint is satisfied by simply using it.
 *
 * Magnitude is on the usual inverted scale: smaller is brighter, Sirius at
 * −1.46, the faintest here around +2.9. Rendering maps it through a flux
 * relation rather than treating it as a linear brightness — see `magnitudeFlux`.
 */

export interface Star {
  /** Arabic name — the star's own name, used as the label. */
  name: string;
  /** Bayer/Flamsteed designation, for anyone checking these against a catalogue. */
  designation: string;
  /** Right ascension, degrees, J2000. */
  ra: number;
  /** Declination, degrees, J2000. */
  dec: number;
  /** Apparent visual magnitude. */
  mag: number;
}

export const BRIGHT_STARS: Star[] = [
  { name: 'الشِّعْرى اليمانية', designation: 'α CMa', ra: 101.287, dec: -16.716, mag: -1.46 },
  { name: 'سُهَيْل', designation: 'α Car', ra: 95.988, dec: -52.696, mag: -0.74 },
  { name: 'رِجْل القِنطَوْرِس', designation: 'α Cen', ra: 219.902, dec: -60.834, mag: -0.27 },
  { name: 'السِّماك الرامِح', designation: 'α Boo', ra: 213.915, dec: 19.182, mag: -0.05 },
  { name: 'النَّسْر الواقِع', designation: 'α Lyr', ra: 279.234, dec: 38.784, mag: 0.03 },
  { name: 'العَيُّوق', designation: 'α Aur', ra: 79.172, dec: 45.998, mag: 0.08 },
  { name: 'رِجْل الجَوْزاء', designation: 'β Ori', ra: 78.634, dec: -8.202, mag: 0.13 },
  { name: 'الشِّعْرى الشامية', designation: 'α CMi', ra: 114.825, dec: 5.225, mag: 0.34 },
  { name: 'آخِر النَّهْر', designation: 'α Eri', ra: 24.429, dec: -57.237, mag: 0.46 },
  { name: 'إبْط الجَوْزاء', designation: 'α Ori', ra: 88.793, dec: 7.407, mag: 0.5 },
  { name: 'حَضار', designation: 'β Cen', ra: 210.956, dec: -60.373, mag: 0.61 },
  { name: 'النَّسْر الطائِر', designation: 'α Aql', ra: 297.696, dec: 8.868, mag: 0.77 },
  { name: 'نَيِّر الصَّليب', designation: 'α Cru', ra: 186.65, dec: -63.099, mag: 0.77 },
  { name: 'الدَّبَران', designation: 'α Tau', ra: 68.98, dec: 16.509, mag: 0.85 },
  { name: 'السِّماك الأعْزَل', designation: 'α Vir', ra: 201.298, dec: -11.161, mag: 1.04 },
  { name: 'قَلْب العَقْرَب', designation: 'α Sco', ra: 247.352, dec: -26.432, mag: 1.09 },
  { name: 'رأس التَّوْأَم المؤخَّر', designation: 'β Gem', ra: 116.329, dec: 28.026, mag: 1.14 },
  { name: 'فَم الحُوت', designation: 'α PsA', ra: 344.413, dec: -29.622, mag: 1.16 },
  { name: 'ذَنَب الدَّجاجة', designation: 'α Cyg', ra: 310.358, dec: 45.28, mag: 1.25 },
  { name: 'ثاني الصَّليب', designation: 'β Cru', ra: 191.93, dec: -59.689, mag: 1.25 },
  { name: 'قَلْب الأسَد', designation: 'α Leo', ra: 152.093, dec: 11.967, mag: 1.35 },
  { name: 'العَذارى', designation: 'ε CMa', ra: 104.656, dec: -28.972, mag: 1.5 },
  { name: 'رأس التَّوْأَم المقدَّم', designation: 'α Gem', ra: 113.65, dec: 31.888, mag: 1.58 },
  { name: 'الشَّوْلَة', designation: 'λ Sco', ra: 263.402, dec: -37.104, mag: 1.62 },
  { name: 'ثالث الصَّليب', designation: 'γ Cru', ra: 187.791, dec: -57.113, mag: 1.63 },
  { name: 'النَّجيد', designation: 'γ Ori', ra: 81.283, dec: 6.35, mag: 1.64 },
  { name: 'النَّطْح', designation: 'β Tau', ra: 81.573, dec: 28.608, mag: 1.65 },
  { name: 'مِيابلاسيدوس', designation: 'β Car', ra: 138.3, dec: -69.717, mag: 1.67 },
  { name: 'النِّظام', designation: 'ε Ori', ra: 84.053, dec: -1.202, mag: 1.69 },
  { name: 'النَّيِّر', designation: 'α Gru', ra: 332.058, dec: -46.961, mag: 1.74 },
  { name: 'النِّطاق', designation: 'ζ Ori', ra: 85.19, dec: -1.943, mag: 1.77 },
  { name: 'الجَوْن', designation: 'ε UMa', ra: 193.507, dec: 55.96, mag: 1.77 },
  { name: 'الدُّبّ', designation: 'α UMa', ra: 165.932, dec: 61.751, mag: 1.79 },
  { name: 'مِرفَق الثُّرَيّا', designation: 'α Per', ra: 51.081, dec: 49.861, mag: 1.79 },
  { name: 'الوَزْن', designation: 'δ CMa', ra: 107.098, dec: -26.393, mag: 1.83 },
  { name: 'القَوْس الجَنوبي', designation: 'ε Sgr', ra: 276.043, dec: -34.385, mag: 1.85 },
  { name: 'أفيور', designation: 'ε Car', ra: 125.628, dec: -59.509, mag: 1.86 },
  { name: 'قائِد بَنات نَعْش', designation: 'η UMa', ra: 206.885, dec: 49.313, mag: 1.86 },
  { name: 'سَرْجَس', designation: 'θ Sco', ra: 264.33, dec: -42.998, mag: 1.87 },
  { name: 'مَنكِب ذي العِنان', designation: 'β Aur', ra: 89.882, dec: 44.947, mag: 1.9 },
  { name: 'أَتْرِيا', designation: 'α TrA', ra: 252.166, dec: -69.028, mag: 1.91 },
  { name: 'الهَنْعَة', designation: 'γ Gem', ra: 99.428, dec: 16.399, mag: 1.93 },
  { name: 'الطاووس', designation: 'α Pav', ra: 306.412, dec: -56.735, mag: 1.94 },
  { name: 'المِرْزَم', designation: 'β CMa', ra: 95.675, dec: -17.956, mag: 1.98 },
  { name: 'الفَرْد', designation: 'α Hya', ra: 141.897, dec: -8.659, mag: 1.98 },
  { name: 'الجَدْي', designation: 'α UMi', ra: 37.955, dec: 89.264, mag: 1.98 },
  { name: 'الحَمَل', designation: 'α Ari', ra: 31.793, dec: 23.462, mag: 2.0 },
  { name: 'ذَنَب قَيْتُس', designation: 'β Cet', ra: 10.897, dec: -17.987, mag: 2.04 },
  { name: 'النَّعائِم', designation: 'σ Sgr', ra: 283.816, dec: -26.297, mag: 2.05 },
  { name: 'مَنكِب القِنطَوْرِس', designation: 'θ Cen', ra: 211.671, dec: -36.37, mag: 2.06 },
  { name: 'المِراق', designation: 'β And', ra: 17.433, dec: 35.621, mag: 2.06 },
  { name: 'سُرَّة الفَرَس', designation: 'α And', ra: 2.097, dec: 29.09, mag: 2.06 },
  { name: 'سَيْف الجَبّار', designation: 'κ Ori', ra: 86.939, dec: -9.67, mag: 2.06 },
  { name: 'رأس الحَوّاء', designation: 'α Oph', ra: 263.734, dec: 12.56, mag: 2.08 },
  { name: 'الكَوْكَب', designation: 'β UMi', ra: 222.676, dec: 74.156, mag: 2.08 },
  { name: 'الجَبْهَة', designation: 'γ Leo', ra: 154.993, dec: 19.841, mag: 2.08 },
  { name: 'العَناق', designation: 'γ And', ra: 30.975, dec: 42.33, mag: 2.1 },
  { name: 'رأس الغُول', designation: 'β Per', ra: 47.042, dec: 40.956, mag: 2.12 },
  { name: 'ذَنَب الأسَد', designation: 'β Leo', ra: 177.265, dec: 14.572, mag: 2.14 },
  { name: 'سُهَيْل النَّعامة', designation: 'ζ Pup', ra: 120.896, dec: -40.003, mag: 2.21 },
  { name: 'المِئزَر', designation: 'ζ UMa', ra: 200.981, dec: 54.925, mag: 2.23 },
  { name: 'المِنْطَقَة', designation: 'δ Ori', ra: 83.002, dec: -0.299, mag: 2.23 },
  { name: 'نَيِّر الفَكَّة', designation: 'α CrB', ra: 233.672, dec: 26.715, mag: 2.23 },
  { name: 'الصَّدْر', designation: 'γ Cyg', ra: 305.557, dec: 40.257, mag: 2.23 },
  { name: 'التِّنّين', designation: 'γ Dra', ra: 269.152, dec: 51.489, mag: 2.23 },
  { name: 'صَدْر كَيْوان', designation: 'α Cas', ra: 10.127, dec: 56.537, mag: 2.24 },
  { name: 'الكَفّ الخَضيب', designation: 'β Cas', ra: 2.294, dec: 59.15, mag: 2.28 },
  { name: 'الإزار', designation: 'ε Boo', ra: 221.247, dec: 27.074, mag: 2.37 },
  { name: 'الأنْف', designation: 'ε Peg', ra: 326.046, dec: 9.875, mag: 2.39 },
  { name: 'الساق', designation: 'β Peg', ra: 345.944, dec: 28.083, mag: 2.42 },
  { name: 'المَرْكَب', designation: 'α Peg', ra: 346.19, dec: 15.205, mag: 2.48 },
  { name: 'الشَّرَطان', designation: 'β Ari', ra: 28.66, dec: 20.808, mag: 2.64 },
  { name: 'الجَنْب', designation: 'γ Peg', ra: 3.309, dec: 15.184, mag: 2.83 },
  { name: 'الثُّرَيّا', designation: 'η Tau', ra: 56.871, dec: 24.105, mag: 2.87 },
];

/**
 * Magnitude → relative flux, normalised so the brightest star in the catalogue
 * is 1. Pogson's ratio: five magnitudes is a factor of a hundred in flux.
 *
 * Sizing a point sprite by magnitude directly makes the sky look wrong, because
 * magnitude is logarithmic and the eye is not. Going through the flux and then
 * taking a root of it is what produces a field where Sirius reads as dominant
 * without the third-magnitude stars vanishing.
 */
export function magnitudeFlux(mag: number, brightest = -1.46): number {
  return 10 ** (0.4 * (brightest - mag));
}

/**
 * Colour from spectral appearance, as a hex triple.
 *
 * The catalogue carries no spectral class, so this is a deliberate
 * simplification and is named as one: the handful of stars that are visibly and
 * famously coloured are given their colour, and the rest take the mild
 * blue-white of the majority of naked-eye stars.
 */
const TINTED: Record<string, [number, number, number]> = {
  'α Ori': [1.0, 0.62, 0.42],   // إبط الجوزاء — red supergiant
  'α Sco': [1.0, 0.58, 0.40],   // قلب العقرب — red supergiant
  'α Tau': [1.0, 0.76, 0.55],   // الدبران — orange giant
  'α Boo': [1.0, 0.83, 0.62],   // السماك الرامح — orange giant
  'β Gem': [1.0, 0.86, 0.70],   // رأس التوأم المؤخر
  'α Hya': [1.0, 0.78, 0.60],   // الفرد
  'γ Dra': [1.0, 0.82, 0.63],   // التنين
  'α Cru': [0.70, 0.80, 1.0],   // hot blue
  'β Cru': [0.68, 0.78, 1.0],
  'ε Ori': [0.72, 0.82, 1.0],
  'ζ Ori': [0.72, 0.82, 1.0],
  'β Ori': [0.80, 0.87, 1.0],   // رجل الجوزاء — blue-white supergiant
  'α Lyr': [0.86, 0.91, 1.0],   // النسر الواقع — the A0V standard
};

export function starColour(star: Star): [number, number, number] {
  return TINTED[star.designation] ?? [0.86, 0.90, 1.0];
}
