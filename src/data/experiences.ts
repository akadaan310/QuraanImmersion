/**
 * التجارب — the experiences.
 *
 * An experience is a ROUTE: an ordered set of ayat, drawn from anywhere in the
 * muṣḥaf, flown as waypoints one after another. The audio for each verse is
 * resolved independently, exactly as it always was, so a route that jumps from
 * Ṭā-Hā to ash-Shuʿarāʾ to al-Kahf plays three separate ayah-level streams and
 * the Isnaad loop opens and closes once per verse throughout.
 *
 * THE UNIVERSE IS FIXED; THE ROUTES ARE NOT
 * -----------------------------------------
 * Where an ayah sits in space is decided once, by the lattice in
 * `journey/waypoints.ts`, and never by the experience. 20:9 is at the same
 * coordinate whether it is reached through سورة طه or through نار الطور. So the
 * experiences are genuinely different paths through one cosmology rather than
 * different cosmologies — and an ayah that appears in four routes is the same
 * place four times, which is the point.
 *
 * COVERAGE
 * --------
 * Two families, and together they reach every ayah:
 *
 *   · 114 surah routes, GENERATED from the verified surah table. Their union is
 *     all 6236 ayat, each exactly once — asserted by a test, not assumed.
 *   · Curated thematic routes that cut across the muṣḥaf: several for موسى, as
 *     asked, and the cosmological readings the engine was built for.
 *
 * The thematic routes are additional paths, never a replacement: nothing is
 * reachable only through them and nothing is unreachable without them.
 *
 * ON THE REFERENCES
 * -----------------
 * The thematic ranges below were compiled by hand. A test validates every one
 * against the surah table, so a reference outside its surah's ayah count fails
 * the build — but that check is arithmetic, not exegesis. It cannot know whether
 * 26:60–68 is the right span for فرق البحر. Those spans are worth checking
 * against a muṣḥaf before anyone leans on them.
 *
 * NO TRANSLATION. Titles and descriptions are Arabic, original, and describe the
 * ROUTE — where it goes and what stands along it. They are not renderings of the
 * ayat, and the repository's guard would fail the build if they became one.
 */

import { PHENOMENA, type PhenomenonId } from './phenomena';
import { SURAHS, ayahCountOf, getSurah, toArabicNumerals } from './surahs';

export interface AyahRef {
  surah: number;
  ayah: number;
  /**
   * The phenomenon standing at this waypoint within this route. Omitted on the
   * surah routes, where the lattice's own binding decides.
   */
  phenomenon?: PhenomenonId;
}

export type ExperienceGroup = 'كوني' | 'أنبياء' | 'سور';

export interface Experience {
  id: string;
  /** Arabic title. */
  title: string;
  /** Two- or three-word Arabic sigil for dense rows. */
  sigil: string;
  /** One Arabic line on where the route goes. */
  brief: string;
  group: ExperienceGroup;
  accent: string;
  /** How many waypoints the route has. */
  count: number;
  /**
   * The route, expanded on demand.
   *
   * A surah route is up to 286 references and there are 114 of them; building
   * all 6236 objects at module load costs a measurable pause on a phone before
   * a single frame has been drawn, for a list the observer may never open.
   */
  ayat: () => AyahRef[];
}

// ------------------------------------------------------------------ builders

/** An inclusive ayah range within one surah. */
function span(surah: number, from: number, to: number, phenomenon?: PhenomenonId): AyahRef[] {
  const last = Math.min(to, ayahCountOf(surah));
  const refs: AyahRef[] = [];
  for (let ayah = Math.max(1, from); ayah <= last; ayah += 1) refs.push({ surah, ayah, phenomenon });
  return refs;
}

/** A single ayah. */
function one(surah: number, ayah: number, phenomenon?: PhenomenonId): AyahRef {
  return { surah, ayah, phenomenon };
}

interface ThematicSpec {
  id: string;
  title: string;
  sigil: string;
  brief: string;
  group: ExperienceGroup;
  accent: string;
  route: () => AyahRef[];
}

function thematic(spec: ThematicSpec): Experience {
  // The count is needed before the route is expanded — it is shown in the
  // drawer for every experience at once — so it is measured once, here, and the
  // expansion itself stays lazy.
  const materialised = spec.route();
  return {
    id: spec.id,
    title: spec.title,
    sigil: spec.sigil,
    brief: spec.brief,
    group: spec.group,
    accent: spec.accent,
    count: materialised.length,
    ayat: () => materialised,
  };
}

// --------------------------------------------------------- thematic routes

/**
 * موسى — eight routes, because the account is not one episode.
 *
 * Each is a distinct movement with its own physics, and each is met at a
 * different phenomenon: fire that does not consume, a rod that becomes a body,
 * a sea that parts into two standing walls, a companion whose reasons arrive
 * after his acts.
 */
const MUSA: Experience[] = [
  thematic({
    id: 'musa-nar-tuwa',
    title: 'موسى — النار في الوادي المقدّس',
    sigil: 'نار طوى',
    brief: 'من إيناس النار إلى النداء — طه ٩ إلى ١٦، ثم النمل والقصص.',
    group: 'أنبياء',
    accent: '#f59e0b',
    route: () => [
      ...span(20, 9, 16, 'shajarah-mubarakah'),
      ...span(27, 7, 12, 'noor-ala-noor'),
      ...span(28, 29, 35, 'shajarah-mubarakah'),
    ],
  }),
  thematic({
    id: 'musa-asa',
    title: 'موسى — العصا واليد',
    sigil: 'العصا',
    brief: 'تحوّل الجسم وانقلاب الحالة — طه، الأعراف، الشعراء.',
    group: 'أنبياء',
    accent: '#22d3ee',
    route: () => [
      ...span(20, 17, 23, 'teen-lazib'),
      ...span(7, 106, 108, 'hadeed-bas'),
      ...span(26, 30, 35, 'teen-lazib'),
    ],
  }),
  thematic({
    id: 'musa-farq-bahr',
    title: 'موسى — فرق البحر',
    sigil: 'فرق البحر',
    brief: 'انفلاق الماء وقيامه طودين — الشعراء ٦٠ إلى ٦٨، ثم طه والدخان.',
    group: 'أنبياء',
    accent: '#0ea5e9',
    route: () => [
      ...span(26, 60, 68, 'marj-bahrayn'),
      ...span(20, 77, 79, 'bahr-masjoor'),
      ...span(44, 23, 24, 'tayy-sijill'),
      one(2, 50, 'marj-bahrayn'),
    ],
  }),
  thematic({
    id: 'musa-khidr',
    title: 'موسى — ومجمع البحرين',
    sigil: 'الخضر',
    brief: 'الرحلة التي تسبق فيها الأفعالُ عللَها — الكهف ٦٠ إلى ٨٢.',
    group: 'أنبياء',
    accent: '#14b8a6',
    route: () => [
      ...span(18, 60, 65, 'marj-bahrayn'),
      ...span(18, 66, 70, 'sarab-bee-qee-ah'),
      ...span(18, 71, 78, 'zulumat-lujjiy'),
      ...span(18, 79, 82, 'noor-ala-noor'),
    ],
  }),
  thematic({
    id: 'musa-tajalli',
    title: 'موسى — والتجلّي للجبل',
    sigil: 'التجلّي',
    brief: 'الميقات، والسؤال، ودكّ الجبل — الأعراف ١٤٢ إلى ١٤٥.',
    group: 'أنبياء',
    accent: '#a78bfa',
    route: () => [
      ...span(7, 142, 145, 'sa-iqah'),
      ...span(2, 55, 56, 'sa-iqah'),
    ],
  }),
  thematic({
    id: 'musa-yamm',
    title: 'موسى — في اليمّ',
    sigil: 'اليمّ',
    brief: 'القذف في التابوت وردّه إلى أمّه — القصص ٧ إلى ١٣، وطه ٣٧ إلى ٤٠.',
    group: 'أنبياء',
    accent: '#38bdf8',
    route: () => [
      ...span(28, 7, 13, 'bahr-masjoor'),
      ...span(20, 37, 40, 'hijr-mahjoor'),
    ],
  }),
  thematic({
    id: 'musa-firawn',
    title: 'موسى — وفرعون والصرح',
    sigil: 'الصرح',
    brief: 'الطغيان يبني ارتفاعاً ليبلغ الأسباب — القصص وغافر والنازعات.',
    group: 'أنبياء',
    accent: '#ef4444',
    route: () => [
      ...span(79, 15, 26, 'dayyiq-haraj'),
      ...span(28, 38, 40, 'awtad'),
      ...span(40, 36, 37, 'kisaf-sama'),
    ],
  }),
  thematic({
    id: 'musa-uyoon',
    title: 'موسى — اثنتا عشرة عيناً',
    sigil: 'العيون',
    brief: 'انبجاس الماء من الحجر، وتمييز كلّ أُناسٍ مشربهم — البقرة والأعراف.',
    group: 'أنبياء',
    accent: '#34d399',
    route: () => [
      one(2, 60, 'zubar-hadeed'),
      ...span(7, 160, 160, 'zubar-hadeed'),
      ...span(2, 57, 57, 'sahab-thiqal'),
    ],
  }),
];

/** The other prophetic routes. */
const PROPHETS: Experience[] = [
  thematic({
    id: 'ibrahim-malakut',
    title: 'إبراهيم — ملكوت السماوات',
    sigil: 'الملكوت',
    brief: 'الكوكب ثم القمر ثم الشمس، وكلٌّ يأفل — الأنعام ٧٥ إلى ٧٩.',
    group: 'أنبياء',
    accent: '#c084fc',
    route: () => span(6, 75, 79, 'mawaqi-nujum'),
  }),
  thematic({
    id: 'ibrahim-tayr',
    title: 'إبراهيم — أربعة من الطير',
    sigil: 'الطير',
    brief: 'التجزئة ثم الاستدعاء ثم الإتيان سعياً — البقرة ٢٦٠.',
    group: 'أنبياء',
    accent: '#f472b6',
    route: () => [one(2, 260, 'teen-lazib'), one(2, 259, 'tayy-sijill')],
  }),
  thematic({
    id: 'dhul-qarnayn',
    title: 'ذو القرنين — المشرقان والسدّ',
    sigil: 'السدّ',
    brief: 'بلوغ مغرب الشمس ومطلعها، ثم زُبَر الحديد بين الصدفين — الكهف ٨٣ إلى ٩٨.',
    group: 'أنبياء',
    accent: '#94a3b8',
    route: () => [
      ...span(18, 83, 88, 'sarab-bee-qee-ah'),
      ...span(18, 89, 91, 'najm-thaqib'),
      ...span(18, 92, 98, 'zubar-hadeed'),
    ],
  }),
  thematic({
    id: 'sulayman-reeh',
    title: 'سليمان — الريح والقطر',
    sigil: 'الريح',
    brief: 'غدوّها شهر ورواحها شهر، وعين القطر — سبأ والنمل.',
    group: 'أنبياء',
    accent: '#fbbf24',
    route: () => [
      ...span(34, 12, 14, 'hadeed-bas'),
      ...span(27, 16, 19, 'mawaqi-nujum'),
      ...span(27, 38, 40, 'tayy-sijill'),
    ],
  }),
  thematic({
    id: 'nuh-tufan',
    title: 'نوح — الطوفان',
    sigil: 'الطوفان',
    brief: 'التقاء ماء السماء بماء الأرض على أمر قد قُدر — القمر وهود.',
    group: 'أنبياء',
    accent: '#0891b2',
    route: () => [
      ...span(54, 9, 17, 'bahr-masjoor'),
      ...span(11, 40, 44, 'marj-bahrayn'),
    ],
  }),
  thematic({
    id: 'yunus-zulumat',
    title: 'يونس — في الظلمات',
    sigil: 'الظلمات',
    brief: 'النداء من ظلمات بعضها فوق بعض — الأنبياء والصافات.',
    group: 'أنبياء',
    accent: '#1e40af',
    route: () => [
      ...span(21, 87, 88, 'zulumat-lujjiy'),
      ...span(37, 139, 148, 'zulumat-lujjiy'),
    ],
  }),
  thematic({
    id: 'ahl-kahf',
    title: 'أهل الكهف — الزمن الموقوف',
    sigil: 'الكهف',
    brief: 'ثلاثمائة سنين وازدادوا تسعاً، والشمس تزاور عن كهفهم — الكهف ٩ إلى ٢٦.',
    group: 'أنبياء',
    accent: '#64748b',
    route: () => [
      ...span(18, 9, 18, 'tayy-sijill'),
      ...span(18, 19, 26, 'hijr-mahjoor'),
    ],
  }),
  thematic({
    id: 'maryam-isa',
    title: 'مريم — والمكان الشرقيّ',
    sigil: 'مريم',
    brief: 'الانتباذ شرقيّاً، والحجاب، والنفخ — مريم ١٦ إلى ٣٤.',
    group: 'أنبياء',
    accent: '#e879f9',
    route: () => [
      ...span(19, 16, 26, 'noor-ala-noor'),
      ...span(19, 27, 34, 'shajarah-mubarakah'),
    ],
  }),
  thematic({
    id: 'adam-asma',
    title: 'آدم — الأسماء كلّها',
    sigil: 'الأسماء',
    brief: 'التعليم ثم العرض ثم الإنباء — البقرة ٣٠ إلى ٣٤، وطه.',
    group: 'أنبياء',
    accent: '#b45309',
    route: () => [
      ...span(2, 30, 34, 'teen-lazib'),
      ...span(20, 115, 123, 'hijr-mahjoor'),
    ],
  }),
  thematic({
    id: 'yusuf-kawakib',
    title: 'يوسف — أحد عشر كوكباً',
    sigil: 'الكواكب',
    brief: 'الرؤيا في مطلعها وتأويلها في منتهاها — يوسف ٤ و١٠٠.',
    group: 'أنبياء',
    accent: '#fde047',
    route: () => [one(12, 4, 'mawaqi-nujum'), one(12, 100, 'mawaqi-nujum')],
  }),
  thematic({
    id: 'dawud-hadeed',
    title: 'داود — وألنّا له الحديد',
    sigil: 'الحديد',
    brief: 'الجبال والطير معه، والحديد يلين في يده — سبأ والأنبياء.',
    group: 'أنبياء',
    accent: '#a1a1aa',
    route: () => [
      ...span(34, 10, 11, 'hadeed-bas'),
      ...span(21, 79, 80, 'zubar-hadeed'),
    ],
  }),
];

/** The cosmological readings — the routes the engine was built for. */
const COSMIC: Experience[] = [
  thematic({
    id: 'ratq-fatq',
    title: 'الرتق والفتق',
    sigil: 'الرتق',
    brief: 'الحالة المرتوقة وفتقها، ثم الاستواء إلى السماء وهي دخان — الأنبياء وفصّلت والذاريات.',
    group: 'كوني',
    accent: '#22d3ee',
    route: () => [
      one(21, 30, 'ratq-fatq'),
      ...span(41, 9, 12, 'ratq-fatq'),
      one(51, 47, 'ratq-fatq'),
      ...span(79, 27, 33, 'saqf-mahfooz'),
    ],
  }),
  thematic({
    id: 'mawaqi-nujum',
    title: 'مواقع النجوم',
    sigil: 'المواقع',
    brief: 'القسم بالمواقع، والطارق، والحفظ من كلّ شيطان رجيم — الواقعة والطارق والصافات والحجر.',
    group: 'كوني',
    accent: '#818cf8',
    route: () => [
      ...span(56, 75, 76, 'mawaqi-nujum'),
      ...span(86, 1, 4, 'najm-thaqib'),
      ...span(37, 6, 10, 'najm-thaqib'),
      ...span(15, 16, 18, 'saqf-mahfooz'),
    ],
  }),
  thematic({
    id: 'saqf-mahfooz',
    title: 'السقف المحفوظ',
    sigil: 'السقف',
    brief: 'السماء سقفاً محفوظاً، وحفظاً، وما ترى فيها من فطور — الأنبياء وفصّلت والملك.',
    group: 'كوني',
    accent: '#60a5fa',
    route: () => [
      one(21, 32, 'saqf-mahfooz'),
      one(41, 12, 'saqf-mahfooz'),
      ...span(67, 3, 5, 'saqf-mahfooz'),
    ],
  }),
  thematic({
    id: 'marj-bahrayn',
    title: 'مرج البحرين',
    sigil: 'البرزخ',
    brief: 'بحران يلتقيان وبينهما برزخ لا يبغيان — الرحمن والفرقان والنمل.',
    group: 'كوني',
    accent: '#2dd4bf',
    route: () => [
      ...span(55, 19, 22, 'marj-bahrayn'),
      one(25, 53, 'marj-bahrayn'),
      one(27, 61, 'marj-bahrayn'),
      one(35, 12, 'bahr-masjoor'),
    ],
  }),
  thematic({
    id: 'noor-ala-noor',
    title: 'نور على نور',
    sigil: 'المشكاة',
    brief: 'المشكاة والزجاجة والشجرة، ثم ظلمات في بحر لجّي — النور ٣٥ و٤٠.',
    group: 'كوني',
    accent: '#fcd34d',
    route: () => [
      one(24, 35, 'noor-ala-noor'),
      one(24, 40, 'zulumat-lujjiy'),
      ...span(24, 41, 44, 'sahab-thiqal'),
    ],
  }),
  thematic({
    id: 'hadeed',
    title: 'الحديد — فيه بأس شديد',
    sigil: 'الحديد',
    brief: 'الإنزال، والبأس، والمنافع — الحديد ٢٥ وما يجاورها في الكهف وسبأ.',
    group: 'كوني',
    accent: '#f87171',
    route: () => [
      one(57, 25, 'hadeed-bas'),
      one(18, 96, 'zubar-hadeed'),
      ...span(34, 10, 11, 'zubar-hadeed'),
    ],
  }),
  thematic({
    id: 'zaman',
    title: 'الزمن — اختلاف المقادير',
    sigil: 'الزمن',
    brief: 'يومٌ كألف سنة، وخمسين ألف سنة، ولبثٌ يُسأل عنه — الحج والسجدة والمعارج والكهف والبقرة.',
    group: 'كوني',
    accent: '#a78bfa',
    route: () => [
      one(22, 47, 'tayy-sijill'),
      one(32, 5, 'tayy-sijill'),
      one(70, 4, 'tayy-sijill'),
      one(18, 25, 'hijr-mahjoor'),
      one(2, 259, 'teen-lazib'),
      ...span(23, 112, 114, 'dayyiq-haraj'),
    ],
  }),
  thematic({
    id: 'infitar',
    title: 'الساعة — انفراط النظام',
    sigil: 'التكوير',
    brief: 'التكوير والانكدار والانفطار والانشقاق — التكوير والانفطار والانشقاق والقارعة.',
    group: 'كوني',
    accent: '#fb7185',
    route: () => [
      ...span(81, 1, 14, 'sa-iqah'),
      ...span(82, 1, 5, 'kisaf-sama'),
      ...span(84, 1, 5, 'tayy-sijill'),
      ...span(101, 1, 11, 'sa-iqah'),
    ],
  }),
  thematic({
    id: 'tayy-sijill',
    title: 'طيّ السماء كطيّ السجلّ',
    sigil: 'الطيّ',
    brief: 'الطيّ ثم الإعادة، وبدء الخلق يُستأنف — الأنبياء ١٠٤ والزمر ٦٧.',
    group: 'كوني',
    accent: '#c4b5fd',
    route: () => [
      one(21, 104, 'tayy-sijill'),
      one(39, 67, 'tayy-sijill'),
      ...span(14, 48, 48, 'ratq-fatq'),
    ],
  }),
  thematic({
    id: 'awtad',
    title: 'الجبال أوتاداً',
    sigil: 'الأوتاد',
    brief: 'الأوتاد والرواسي، والجبال تمرّ مرّ السحاب — النبأ والنحل والنمل.',
    group: 'كوني',
    accent: '#84cc16',
    route: () => [
      ...span(78, 6, 7, 'awtad'),
      one(16, 15, 'awtad'),
      one(27, 88, 'sahab-thiqal'),
      one(31, 10, 'awtad'),
    ],
  }),
  thematic({
    id: 'sahab-thiqal',
    title: 'السحاب الثقال',
    sigil: 'السحاب',
    brief: 'الإزجاء ثم التأليف ثم الرُّكام، وسنا برقه — النور والروم والأعراف وفاطر.',
    group: 'كوني',
    accent: '#7dd3fc',
    route: () => [
      one(24, 43, 'sahab-thiqal'),
      one(30, 48, 'sahab-thiqal'),
      one(7, 57, 'sahab-thiqal'),
      one(35, 9, 'sahab-thiqal'),
      one(13, 12, 'sa-iqah'),
    ],
  }),
  thematic({
    id: 'meezan',
    title: 'الميزان',
    sigil: 'الميزان',
    brief: 'وضع الميزان وألّا يُطغى فيه، والموازين القسط — الرحمن والأنبياء والقارعة.',
    group: 'كوني',
    accent: '#fbbf24',
    route: () => [
      ...span(55, 7, 9, 'awtad'),
      one(21, 47, 'mawaqi-nujum'),
      ...span(101, 6, 9, 'sa-iqah'),
    ],
  }),
  thematic({
    id: 'sarab',
    title: 'سراباً بقيعة',
    sigil: 'السراب',
    brief: 'ما يُحسب ماءً حتى يُبلغ، وما يُحسب ثابتاً وهو يمرّ — النور والنمل.',
    group: 'كوني',
    accent: '#fdba74',
    route: () => [
      ...span(24, 39, 40, 'sarab-bee-qee-ah'),
      one(78, 20, 'sarab-bee-qee-ah'),
    ],
  }),
  thematic({
    id: 'shajarah',
    title: 'الشجرة المباركة',
    sigil: 'الزيتونة',
    brief: 'لا شرقيّة ولا غربيّة، يكاد زيتها يضيء ولو لم تمسسه نار — النور، والطور، والتين.',
    group: 'كوني',
    accent: '#a3e635',
    route: () => [
      one(24, 35, 'shajarah-mubarakah'),
      ...span(23, 20, 20, 'shajarah-mubarakah'),
      ...span(95, 1, 3, 'shajarah-mubarakah'),
    ],
  }),
  thematic({
    id: 'kisaf-sama',
    title: 'كِسَفاً من السماء',
    sigil: 'الكِسَف',
    brief: 'الإسقاط، والخسف، والإمساك أن تقع على الأرض — سبأ والحج والإسراء.',
    group: 'كوني',
    accent: '#f97316',
    route: () => [
      one(34, 9, 'kisaf-sama'),
      one(22, 65, 'saqf-mahfooz'),
      ...span(17, 92, 93, 'kisaf-sama'),
    ],
  }),
  thematic({
    id: 'hijr-mahjoor',
    title: 'حجراً محجوراً',
    sigil: 'الحجر',
    brief: 'الفصل الذي لا يُتجاوز، وبرزخٌ إلى يوم يُبعثون — الفرقان والمؤمنون.',
    group: 'كوني',
    accent: '#94a3b8',
    route: () => [
      one(25, 22, 'hijr-mahjoor'),
      one(25, 53, 'hijr-mahjoor'),
      ...span(23, 99, 100, 'hijr-mahjoor'),
    ],
  }),
  thematic({
    id: 'dayyiq-haraj',
    title: 'ضيّقاً حرجاً',
    sigil: 'الضيق',
    brief: 'كأنّما يصّعّد في السماء — الأنعام ١٢٥، وما يقابله من الشرح.',
    group: 'كوني',
    accent: '#fb923c',
    route: () => [
      one(6, 125, 'dayyiq-haraj'),
      ...span(94, 1, 4, 'ratq-fatq'),
    ],
  }),
  thematic({
    id: 'bahr-masjoor',
    title: 'البحر المسجور',
    sigil: 'المسجور',
    brief: 'القسم بالسقف المرفوع والبحر المسجور، والبحار تُسجَّر — الطور والتكوير.',
    group: 'كوني',
    accent: '#0d9488',
    route: () => [
      ...span(52, 1, 8, 'bahr-masjoor'),
      one(81, 6, 'bahr-masjoor'),
    ],
  }),
  thematic({
    id: 'siru-fi-al-ard',
    title: 'سيروا في الأرض',
    sigil: 'السير',
    brief: 'الأمر بالسير والنظر في بدء الخلق — العنكبوت والأنعام والروم والملك.',
    group: 'كوني',
    accent: '#4ade80',
    route: () => [
      one(29, 20, 'ratq-fatq'),
      one(6, 11, 'awtad'),
      one(30, 42, 'sarab-bee-qee-ah'),
      ...span(67, 15, 15, 'awtad'),
      ...span(22, 46, 46, 'dayyiq-haraj'),
    ],
  }),
];

// ------------------------------------------------------------- surah routes

/**
 * One route per surah, generated from the verified table.
 *
 * These are what make the coverage complete: their union is every ayah in the
 * muṣḥaf, each exactly once. The phenomenon is left to the lattice, so a surah
 * flown end to end passes through the whole catalogue of scenes in the order the
 * traversal gives them rather than in one chosen here.
 */
const SURAH_ACCENTS = PHENOMENA.map((phenomenon) => phenomenon.accent);

export const SURAH_EXPERIENCES: Experience[] = SURAHS.map((surah) => ({
  id: `surah-${surah.number}`,
  title: surah.name,
  sigil: surah.name,
  brief: `${surah.place} · ${toArabicNumerals(surah.ayahCount)} آية`,
  group: 'سور' as const,
  accent: SURAH_ACCENTS[(surah.number - 1) % SURAH_ACCENTS.length],
  count: surah.ayahCount,
  ayat: () => span(surah.number, 1, surah.ayahCount),
}));

// -------------------------------------------------------------- the registry

export const THEMATIC_EXPERIENCES: Experience[] = [...COSMIC, ...MUSA, ...PROPHETS];

export const EXPERIENCES: Experience[] = [...THEMATIC_EXPERIENCES, ...SURAH_EXPERIENCES];

export const EXPERIENCE_BY_ID: Record<string, Experience> = Object.fromEntries(
  EXPERIENCES.map((experience) => [experience.id, experience]),
);

/** Where the journey opens. الكهف is the surah the engine's core was built on. */
export const DEFAULT_EXPERIENCE = 'musa-khidr';

export const GROUPS: { id: ExperienceGroup; title: string; brief: string }[] = [
  { id: 'كوني', title: 'قراءات كونية', brief: 'مسارات تعبر المصحف بحسب الظاهرة' },
  { id: 'أنبياء', title: 'مسارات الأنبياء', brief: 'المشاهد مجموعةً من مواضعها المتفرّقة' },
  { id: 'سور', title: 'السور', brief: 'كلّ سورة مساراً كاملاً — ١١٤ مساراً تغطّي المصحف' },
];

export function experiencesOf(group: ExperienceGroup): Experience[] {
  return EXPERIENCES.filter((experience) => experience.group === group);
}

/** The surah route that contains a given ayah — the fallback route for any verse. */
export function surahExperienceFor(surah: number): Experience {
  return SURAH_EXPERIENCES[Math.min(Math.max(surah, 1), 114) - 1];
}

/**
 * Position of an ayah within a route, or −1.
 *
 * Used when the journey is already at a verse and the observer opens a
 * different route that happens to contain it: the route is entered at that
 * verse rather than restarted from its beginning.
 */
export function positionOf(experience: Experience, surah: number, ayah: number): number {
  return experience.ayat().findIndex((ref) => ref.surah === surah && ref.ayah === ayah);
}

/** Human-readable label for a waypoint: سورة ثم رقم الآية بالأرقام العربية. */
export function labelOf(ref: AyahRef): string {
  return `${getSurah(ref.surah).name} · ${toArabicNumerals(ref.ayah)}`;
}
