/**
 * QuranTextService — Uthmani script retrieval.
 *
 * HARD CONSTRAINT: this service resolves ORIGINAL ARABIC ONLY. No translation
 * endpoint, translation parameter, or translation field is ever requested or
 * read. `assertArabicOnly` is the enforcement point: any payload carrying Latin
 * letters is rejected rather than rendered, so a future upstream change cannot
 * silently leak translated text into the viewport.
 */

const QURAN_API = 'https://api.quran.com/api/v4';
const ALQURAN_CLOUD = 'https://api.alquran.cloud/v1';

const CACHE_PREFIX = 'isnaad.uthmani.v1.';

export interface AyahText {
  surah: number;
  ayah: number;
  /** Uthmani Arabic glyph run. */
  text: string;
}

/** Latin letters are the tell-tale of a translation payload. */
const LATIN = /[A-Za-z]/;

export function assertArabicOnly(text: string): string {
  if (LATIN.test(text)) {
    throw new Error('rejected non-Arabic payload: the viewport renders Uthmani script only');
  }
  return text;
}

const memory = new Map<number, AyahText[]>();

function readSessionCache(surah: number): AyahText[] | null {
  try {
    const raw = sessionStorage.getItem(CACHE_PREFIX + surah);
    return raw ? (JSON.parse(raw) as AyahText[]) : null;
  } catch {
    return null;
  }
}

function writeSessionCache(surah: number, verses: AyahText[]): void {
  try {
    sessionStorage.setItem(CACHE_PREFIX + surah, JSON.stringify(verses));
  } catch {
    /* quota or private mode — in-memory cache still serves the session */
  }
}

async function fromQuranCom(surah: number): Promise<AyahText[]> {
  const res = await fetch(`${QURAN_API}/quran/verses/uthmani?chapter_number=${surah}`);
  if (!res.ok) throw new Error(`quran.com ${res.status}`);
  const body = (await res.json()) as { verses?: { verse_key: string; text_uthmani: string }[] };
  const verses = body.verses ?? [];
  if (!verses.length) throw new Error('quran.com returned no verses');
  return verses.map((verse) => {
    const [s, a] = verse.verse_key.split(':').map(Number);
    return { surah: s, ayah: a, text: assertArabicOnly(verse.text_uthmani.trim()) };
  });
}

async function fromAlQuranCloud(surah: number): Promise<AyahText[]> {
  const res = await fetch(`${ALQURAN_CLOUD}/surah/${surah}/quran-uthmani`);
  if (!res.ok) throw new Error(`alquran.cloud ${res.status}`);
  const body = (await res.json()) as { data?: { ayahs?: { numberInSurah: number; text: string }[] } };
  const ayahs = body.data?.ayahs ?? [];
  if (!ayahs.length) throw new Error('alquran.cloud returned no verses');
  return ayahs.map((entry) => ({
    surah,
    ayah: entry.numberInSurah,
    text: assertArabicOnly(entry.text.trim()),
  }));
}

const inflight = new Map<number, Promise<AyahText[]>>();

/** Load one surah of Uthmani text, memoised across the session. */
export function loadSurahText(surah: number): Promise<AyahText[]> {
  const cached = memory.get(surah) ?? readSessionCache(surah);
  if (cached) {
    memory.set(surah, cached);
    return Promise.resolve(cached);
  }

  const pending = inflight.get(surah);
  if (pending) return pending;

  const task = fromQuranCom(surah)
    .catch(() => fromAlQuranCloud(surah))
    .then((verses) => {
      memory.set(surah, verses);
      writeSessionCache(surah, verses);
      inflight.delete(surah);
      return verses;
    })
    .catch((error) => {
      inflight.delete(surah);
      throw error;
    });

  inflight.set(surah, task);
  return task;
}

export async function loadAyahText(surah: number, ayah: number): Promise<AyahText | null> {
  const verses = await loadSurahText(surah);
  return verses.find((verse) => verse.ayah === ayah) ?? null;
}

/** Synchronous peek for render paths that must not suspend. */
export function peekAyahText(surah: number, ayah: number): AyahText | null {
  const verses = memory.get(surah) ?? readSessionCache(surah);
  if (!verses) return null;
  memory.set(surah, verses);
  return verses.find((verse) => verse.ayah === ayah) ?? null;
}

/** ٱلْبَسْمَلَة — rendered as the opening plate of every surah except التوبة. */
export const BASMALA = 'بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ';

/** ٱلِٱسْتِعَاذَة — spoken plate of the onboarding acoustic clearance stage. */
export const ISTIADHA = 'أَعُوذُ بِٱللَّهِ مِنَ ٱلشَّيْطَٰنِ ٱلرَّجِيمِ';
