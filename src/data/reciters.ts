/**
 * القُرّاء — Ayah-level recitation sources.
 *
 * Every source in this file resolves audio at the AYAH level (one HTTP object per
 * verse), never at surah level. Surah-length streams cannot drive the per-ayah
 * Isnaad state machine, so they are deliberately excluded.
 *
 * Resolution is a chain, not a single hardcoded URL:
 *   1. quran.com v4 `/resources/recitations` is queried at runtime and matched by
 *      name, so reciter ids are discovered rather than guessed.
 *   2. EveryAyah folder candidates are probed in order as a static fallback.
 *   3. A timed-window source, for reciters no per-ayah CDN carries: the surah
 *      stream is range-requested and played between the ayah's start and end
 *      timestamps. The verse boundary is still exact, so the Isnaad loop opens
 *      and closes per ayah exactly as it does for a per-ayah object.
 *   4. A user-supplied base (localStorage / env) always wins if present.
 *
 * Verified at build time (2026): EveryAyah carries Husary, al-Qatami and
 * ad-Dosari as per-ayah objects; it does NOT carry Raad al-Kurdi, and neither
 * does quran.com or alquran.cloud — hence the timed-window source for him.
 */

export type ReciterId = 'husary' | 'kurdi' | 'qatami' | 'dosari';

export interface Reciter {
  id: ReciterId;
  /** Arabic display name — the only name ever rendered in the UI. */
  name: string;
  /** Arabic descriptor of the recitation register (رواية / أسلوب). */
  register: string;
  /** Match keys used to discover the reciter inside the quran.com recitations resource. */
  matchKeys: string[];
  /** EveryAyah `data/<folder>/SSSAAA.mp3` folder candidates, most preferred first. */
  everyAyahFolders: string[];
  /**
   * Fallback for reciters with no per-ayah CDN objects: a surah stream plus an
   * ayah timing table. Playback is still bounded to one ayah.
   */
  timedSource?: {
    /** mp3quran `read` id, used to fetch the ayah timing table. */
    readId: number;
    /** Server directory holding `SSS.mp3` surah files. */
    server: string;
  };
  /** Environment variable holding an operator-supplied ayah base URL override. */
  envKey: string;
  /** HUD accent, also used as the L2 vocal-anchor tint inside the shaders. */
  accent: string;
}

export const RECITERS: Reciter[] = [
  {
    id: 'husary',
    name: 'محمود خليل الحصري',
    register: 'مرتل — رواية حفص',
    matchKeys: ['husary', 'husari', 'khalil al-husary', 'الحصري'],
    everyAyahFolders: ['Husary_128kbps', 'Husary_64kbps', 'Husary_Mujawwad_64kbps', 'Husary_Muallim_128kbps'],
    envKey: 'VITE_AYAH_BASE_HUSARY',
    accent: '#22d3ee',
  },
  {
    id: 'kurdi',
    name: 'رعد الكردي',
    register: 'مرتل',
    matchKeys: ['raad', 'kurdi', 'al-kurdi', 'alkurdi', 'الكردي'],
    everyAyahFolders: [],
    timedSource: { readId: 221, server: 'https://server6.mp3quran.net/kurdi/' },
    envKey: 'VITE_AYAH_BASE_KURDI',
    accent: '#a78bfa',
  },
  {
    id: 'qatami',
    name: 'ناصر القطامي',
    register: 'مرتل',
    matchKeys: ['qatami', 'alqatami', 'al-qatami', 'nasser', 'القطامي'],
    everyAyahFolders: ['Nasser_Alqatami_128kbps', 'Nasser_Alqatami_64kbps'],
    envKey: 'VITE_AYAH_BASE_QATAMI',
    accent: '#fbbf24',
  },
  {
    id: 'dosari',
    name: 'ياسر الدوسري',
    register: 'مرتل',
    matchKeys: ['dossary', 'dossari', 'dussary', 'dosari', 'yasser', 'الدوسري'],
    everyAyahFolders: ['Yasser_Ad-Dussary_128kbps', 'Yasser_Ad-Dussary_64kbps'],
    envKey: 'VITE_AYAH_BASE_DOSARI',
    accent: '#34d399',
  },
];

export const RECITER_BY_ID = Object.fromEntries(RECITERS.map((r) => [r.id, r])) as Record<ReciterId, Reciter>;

export const DEFAULT_RECITER: ReciterId = 'husary';
