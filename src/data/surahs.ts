/**
 * فهرس السور — Arabic-only surah index (name, ayah count, place of revelation).
 * No transliteration and no translation is stored here by design.
 */

export interface Surah {
  number: number;
  name: string;
  ayahCount: number;
  place: 'مكية' | 'مدنية';
}

type Row = [string, number, 0 | 1]; // 0 = مكية, 1 = مدنية

const ROWS: Row[] = [
  ['الفاتحة', 7, 0], ['البقرة', 286, 1], ['آل عمران', 200, 1], ['النساء', 176, 1],
  ['المائدة', 120, 1], ['الأنعام', 165, 0], ['الأعراف', 206, 0], ['الأنفال', 75, 1],
  ['التوبة', 129, 1], ['يونس', 109, 0], ['هود', 123, 0], ['يوسف', 111, 0],
  ['الرعد', 43, 1], ['إبراهيم', 52, 0], ['الحجر', 99, 0], ['النحل', 128, 0],
  ['الإسراء', 111, 0], ['الكهف', 110, 0], ['مريم', 98, 0], ['طه', 135, 0],
  ['الأنبياء', 112, 0], ['الحج', 78, 1], ['المؤمنون', 118, 0], ['النور', 64, 1],
  ['الفرقان', 77, 0], ['الشعراء', 227, 0], ['النمل', 93, 0], ['القصص', 88, 0],
  ['العنكبوت', 69, 0], ['الروم', 60, 0], ['لقمان', 34, 0], ['السجدة', 30, 0],
  ['الأحزاب', 73, 1], ['سبأ', 54, 0], ['فاطر', 45, 0], ['يس', 83, 0],
  ['الصافات', 182, 0], ['ص', 88, 0], ['الزمر', 75, 0], ['غافر', 85, 0],
  ['فصلت', 54, 0], ['الشورى', 53, 0], ['الزخرف', 89, 0], ['الدخان', 59, 0],
  ['الجاثية', 37, 0], ['الأحقاف', 35, 0], ['محمد', 38, 1], ['الفتح', 29, 1],
  ['الحجرات', 18, 1], ['ق', 45, 0], ['الذاريات', 60, 0], ['الطور', 49, 0],
  ['النجم', 62, 0], ['القمر', 55, 0], ['الرحمن', 78, 1], ['الواقعة', 96, 0],
  ['الحديد', 29, 1], ['المجادلة', 22, 1], ['الحشر', 24, 1], ['الممتحنة', 13, 1],
  ['الصف', 14, 1], ['الجمعة', 11, 1], ['المنافقون', 11, 1], ['التغابن', 18, 1],
  ['الطلاق', 12, 1], ['التحريم', 12, 1], ['الملك', 30, 0], ['القلم', 52, 0],
  ['الحاقة', 52, 0], ['المعارج', 44, 0], ['نوح', 28, 0], ['الجن', 28, 0],
  ['المزمل', 20, 0], ['المدثر', 56, 0], ['القيامة', 40, 0], ['الإنسان', 31, 1],
  ['المرسلات', 50, 0], ['النبأ', 40, 0], ['النازعات', 46, 0], ['عبس', 42, 0],
  ['التكوير', 29, 0], ['الانفطار', 19, 0], ['المطففين', 36, 0], ['الانشقاق', 25, 0],
  ['البروج', 22, 0], ['الطارق', 17, 0], ['الأعلى', 19, 0], ['الغاشية', 26, 0],
  ['الفجر', 30, 0], ['البلد', 20, 0], ['الشمس', 15, 0], ['الليل', 21, 0],
  ['الضحى', 11, 0], ['الشرح', 8, 0], ['التين', 8, 0], ['العلق', 19, 0],
  ['القدر', 5, 0], ['البينة', 8, 1], ['الزلزلة', 8, 1], ['العاديات', 11, 0],
  ['القارعة', 11, 0], ['التكاثر', 8, 0], ['العصر', 3, 0], ['الهمزة', 9, 0],
  ['الفيل', 5, 0], ['قريش', 4, 0], ['الماعون', 7, 0], ['الكوثر', 3, 0],
  ['الكافرون', 6, 0], ['النصر', 3, 1], ['المسد', 5, 0], ['الإخلاص', 4, 0],
  ['الفلق', 5, 0], ['الناس', 6, 0],
];

export const SURAHS: Surah[] = ROWS.map(([name, ayahCount, place], i) => ({
  number: i + 1,
  name,
  ayahCount,
  place: place === 1 ? 'مدنية' : 'مكية',
}));

export function getSurah(n: number): Surah {
  return SURAHS[Math.min(Math.max(n, 1), 114) - 1];
}

export function ayahCountOf(surah: number): number {
  return getSurah(surah).ayahCount;
}

/** سورة الكهف — the calibration protocol pins this as the primary processing centre. */
export const PRIMARY_PROCESSING_CORE = 18;

/** Arabic-Indic numerals, used for every ayah marker and counter in the UI. */
const ARABIC_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];

export function toArabicNumerals(value: number | string): string {
  return String(value).replace(/\d/g, (d) => ARABIC_DIGITS[Number(d)]);
}

export function verseKey(surah: number, ayah: number): string {
  return `${surah}:${ayah}`;
}

/** Clamp a (surah, ayah) pair onto the real mushaf grid. */
export function clampVerse(surah: number, ayah: number): { surah: number; ayah: number } {
  const s = Math.min(Math.max(Math.round(surah), 1), 114);
  const a = Math.min(Math.max(Math.round(ayah), 1), ayahCountOf(s));
  return { surah: s, ayah: a };
}

/** Advance one ayah, rolling into the next surah, or null at the end of the mushaf. */
export function nextVerse(surah: number, ayah: number): { surah: number; ayah: number } | null {
  if (ayah < ayahCountOf(surah)) return { surah, ayah: ayah + 1 };
  if (surah < 114) return { surah: surah + 1, ayah: 1 };
  return null;
}

export function prevVerse(surah: number, ayah: number): { surah: number; ayah: number } | null {
  if (ayah > 1) return { surah, ayah: ayah - 1 };
  if (surah > 1) return { surah: surah - 1, ayah: ayahCountOf(surah - 1) };
  return null;
}
