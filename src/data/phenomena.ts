/**
 * العشرون ظاهرة — the interactive WebGL phenomenon registry.
 *
 * `brief` is a technical description of what the SIMULATION does. It is never a
 * rendering of verse meaning: verse text itself appears only as Uthmani Arabic,
 * fetched by QuranTextService, and is never accompanied by any translation.
 */

export type PhenomenonId =
  | 'ratq-fatq' | 'teen-lazib' | 'mawaqi-nujum' | 'saqf-mahfooz' | 'bahr-masjoor'
  | 'marj-bahrayn' | 'hadeed-bas' | 'zulumat-lujjiy' | 'najm-thaqib' | 'zubar-hadeed'
  | 'tayy-sijill' | 'sarab-bee-qee-ah' | 'noor-ala-noor' | 'sahab-thiqal' | 'shajarah-mubarakah'
  | 'awtad' | 'dayyiq-haraj' | 'kisaf-sama' | 'hijr-mahjoor' | 'sa-iqah';

export interface Phenomenon {
  id: PhenomenonId;
  /** Arabic title rendered in the picker and the viewport crown. */
  title: string;
  /** Short Arabic sigil for dense HUD rows. */
  sigil: string;
  /** Arabic description of the computational behaviour of the scene. */
  brief: string;
  /** Anchor verse keys "surah:ayah" — used to preload the ayah audio pipeline. */
  anchors: string[];
  /** Scene accent, injected into shaders as uAccent. */
  accent: string;
  /**
   * Isnaad emphasis profile: how strongly each of the six vectors weighs on this
   * phenomenon's uniforms. Index 0 → L1 … index 5 → L6.
   */
  isnaadWeights: [number, number, number, number, number, number];
}

export const PHENOMENA: Phenomenon[] = [
  {
    id: 'ratq-fatq',
    title: 'الرتق والفتق',
    sigil: 'رتق',
    brief: 'تمدد رؤوس المضلعات الكروية انطلاقاً من نواة مرتوقة، مدفوعاً بالترددات تحت الصوتية للتلاوة.',
    anchors: ['21:30'],
    accent: '#22d3ee',
    isnaadWeights: [1.0, 0.9, 0.85, 0.5, 0.6, 0.7],
  },
  {
    id: 'teen-lazib',
    title: 'طين لازب',
    sigil: 'طين',
    brief: 'محاكاة جسيمات لزجة عالية التماسك، تُوزَّن كثافتها بمتجهي الهدف L3 والمستمع غير المرئي L5.',
    anchors: ['37:11'],
    accent: '#b45309',
    isnaadWeights: [0.8, 0.85, 1.0, 0.4, 0.9, 0.5],
  },
  {
    id: 'mawaqi-nujum',
    title: 'مواقع النجوم',
    sigil: 'نجوم',
    brief: 'شبكة عقد نجمية مترابطة تُرسم بخطوط طاقة، مع تصعيد سطوع العقدة عند ذروة السعة.',
    anchors: ['56:75', '56:76'],
    accent: '#67e8f9',
    isnaadWeights: [0.9, 0.8, 0.6, 0.7, 0.8, 0.6],
  },
  {
    id: 'saqf-mahfooz',
    title: 'السقف المحفوظ',
    sigil: 'سقف',
    brief: 'قبة طاقة تصد الحطام المداري الوارد؛ شدة الصد تتبع الطاقة الكلية للإطار الصوتي.',
    anchors: ['21:32'],
    accent: '#38bdf8',
    isnaadWeights: [1.0, 0.7, 0.7, 0.8, 0.5, 0.6],
  },
  {
    id: 'bahr-masjoor',
    title: 'البحر المسجور',
    sigil: 'مسجور',
    brief: 'تظليل حجمي لسطح مائي فوق شبكة صهارة متوهجة؛ الحرارة السفلية تنبض مع الترددات المنخفضة.',
    anchors: ['52:6'],
    accent: '#f97316',
    isnaadWeights: [0.8, 0.9, 0.9, 0.5, 0.6, 0.6],
  },
  {
    id: 'marj-bahrayn',
    title: 'مرج البحرين يلتقيان',
    sigil: 'برزخ',
    brief: 'مائعان بكثافتين مختلفتين يلتقيان دون امتزاج؛ حدّ الملوحة يُحسب كحاجز إزاحة في الشادر.',
    anchors: ['55:19', '55:20'],
    accent: '#2dd4bf',
    isnaadWeights: [0.9, 0.8, 0.9, 0.6, 0.5, 0.8],
  },
  {
    id: 'hadeed-bas',
    title: 'الحديد فيه بأس شديد',
    sigil: 'حديد',
    brief: 'تجمّع جسيمات معدنية حول خطوط مجال مغناطيسي، مع استخلاص النواة عند الذروات الحادة.',
    anchors: ['57:25'],
    accent: '#94a3b8',
    isnaadWeights: [0.9, 0.9, 1.0, 0.6, 0.4, 0.5],
  },
  {
    id: 'zulumat-lujjiy',
    title: 'ظلمات في بحر لُجّي',
    sigil: 'ظلمات',
    brief: 'طبقات توهين ضوئي متتابعة مع تشتت داخلي ضعيف؛ عمق الاختراق عكسي مع كثافة الطبقة.',
    anchors: ['24:40'],
    accent: '#1e3a8a',
    isnaadWeights: [0.7, 0.8, 0.8, 0.9, 0.6, 0.5],
  },
  {
    id: 'najm-thaqib',
    title: 'النجم الثاقب',
    sigil: 'ثاقب',
    brief: 'حزمة اتجاهية نابضة تُقاد بالترددات العالية؛ كل نبضة تثقب طبقات العتمة المحيطة.',
    anchors: ['86:1', '86:2', '86:3'],
    accent: '#e0f2fe',
    isnaadWeights: [1.0, 1.0, 0.7, 0.5, 0.7, 0.6],
  },
  {
    id: 'zubar-hadeed',
    title: 'زُبَر الحديد والصدفين',
    sigil: 'سد',
    brief: 'تجميع بنيوي متدرّج لكتل حديدية بين صدفين، ثم صبّ نحاس منصهر يلحم الفواصل.',
    anchors: ['18:96'],
    accent: '#d97706',
    isnaadWeights: [1.0, 0.8, 1.0, 0.7, 0.4, 0.7],
  },
  {
    id: 'tayy-sijill',
    title: 'طي السماء كطي السجل',
    sigil: 'طي',
    brief: 'شادر ثني للشبكة الفراغية يلف المستوى ثلاثي الأبعاد إلى أسطوانة سجلّ متصاعدة.',
    anchors: ['21:104'],
    accent: '#c084fc',
    isnaadWeights: [1.0, 0.85, 0.6, 0.6, 0.7, 0.9],
  },
  {
    id: 'sarab-bee-qee-ah',
    title: 'سراباً بقيعة',
    sigil: 'سراب',
    brief: 'تشويه حراري مترجرج فوق سبخة ملحية لا نهائية؛ الانكسار يتبدد كلما اقترب المراقب.',
    anchors: ['24:39'],
    accent: '#fcd34d',
    isnaadWeights: [0.7, 0.8, 0.9, 1.0, 0.4, 0.5],
  },
  {
    id: 'noor-ala-noor',
    title: 'نور على نور',
    sigil: 'نور',
    brief: 'تراكب ضوئي متعدد المرات مع انكسار زجاجي وتوهج تداخلي بين طبقتي إضاءة.',
    anchors: ['24:35'],
    accent: '#fde68a',
    isnaadWeights: [1.0, 0.9, 0.8, 0.7, 0.8, 1.0],
  },
  {
    id: 'sahab-thiqal',
    title: 'سحاب ثقال',
    sigil: 'سحاب',
    brief: 'منظومة جسيمات سحابية كثيفة تتراكم كتلتها حتى التفريغ، مع أقواس ضوئية متزامنة.',
    anchors: ['13:12'],
    accent: '#93c5fd',
    isnaadWeights: [0.85, 0.95, 0.8, 0.6, 0.6, 0.7],
  },
  {
    id: 'shajarah-mubarakah',
    title: 'الشجرة المباركة والزيت',
    sigil: 'زيت',
    brief: 'مائع ذاتي الإضاءة بلا احتراق؛ الإشعاع ينبع من داخل السائل لا من مصدر خارجي.',
    anchors: ['24:35'],
    accent: '#facc15',
    isnaadWeights: [0.9, 0.9, 0.9, 0.6, 0.7, 0.8],
  },
  {
    id: 'awtad',
    title: 'أوتاداً',
    sigil: 'وتد',
    brief: 'هندسة تثبيت تحت سطحية تغرس جذور الجبال في الوشاح وتُخمد اهتزاز اللوح.',
    anchors: ['78:7'],
    accent: '#a3a3a3',
    isnaadWeights: [0.9, 0.7, 1.0, 0.8, 0.4, 0.5],
  },
  {
    id: 'dayyiq-haraj',
    title: 'ضيقاً حرجاً',
    sigil: 'ضيق',
    brief: 'انكماش مجال الرؤية طردياً مع الارتفاع، مع رفع ضغط العدسة وخنق المدى البصري.',
    anchors: ['6:125'],
    accent: '#64748b',
    isnaadWeights: [0.8, 0.8, 0.7, 1.0, 0.5, 0.6],
  },
  {
    id: 'kisaf-sama',
    title: 'كِسَفاً من السماء',
    sigil: 'كسف',
    brief: 'تشظٍّ لهندسة سماوية وسقوط الشظايا على مسارات جذبية محسوبة لحظياً.',
    anchors: ['17:92', '34:9'],
    accent: '#f87171',
    isnaadWeights: [1.0, 0.9, 0.9, 0.7, 0.5, 0.6],
  },
  {
    id: 'hijr-mahjoor',
    title: 'حجراً محجوراً',
    sigil: 'حجر',
    brief: 'حاجز جسيمي غير نفوذ يفصل نطاقين غير متوافقين ويرد كل محاولة عبور.',
    anchors: ['25:22', '25:53'],
    accent: '#818cf8',
    isnaadWeights: [1.0, 0.7, 0.9, 0.7, 0.8, 0.7],
  },
  {
    id: 'sa-iqah',
    title: 'الصاعقة',
    sigil: 'صعق',
    brief: 'انهيار طوبولوجي للشبكة عند ذروة الطاقة الصوتية، ثم إعادة التحام تدريجية.',
    anchors: ['41:13'],
    accent: '#f0abfc',
    isnaadWeights: [1.0, 1.0, 0.8, 0.8, 0.6, 0.9],
  },
];

export const PHENOMENON_BY_ID = Object.fromEntries(PHENOMENA.map((p) => [p.id, p])) as Record<
  PhenomenonId,
  Phenomenon
>;

export const DEFAULT_PHENOMENON: PhenomenonId = 'ratq-fatq';
