/**
 * QuranAudioService — ayah-level audio stream resolution.
 *
 * Contract: one HTTP object per ayah. Nothing in this module ever resolves a
 * surah-length stream, because the Isnaad runtime opens and closes an execution
 * loop (L1 → L6) once per verse and needs discrete verse boundaries.
 *
 * Resolution order per reciter:
 *   0. operator override  (import.meta.env[VITE_AYAH_BASE_*] or localStorage)
 *   1. EveryAyah          (static folder candidates, probed in order)
 *   2. quran.com v4       (recitation id discovered by name at runtime)
 *   3. timed window       (surah stream + ayah timing table, for reciters that
 *                          no per-ayah CDN carries)
 *
 * The first candidate that actually plays is remembered per reciter, so the
 * probing cost is paid once per browser rather than once per ayah.
 */

import { RECITER_BY_ID, type Reciter, type ReciterId } from '@/data/reciters';

const QURAN_API = 'https://api.quran.com/api/v4';
const VERSES_CDN = 'https://verses.quran.com/';
const EVERYAYAH_CDN = 'https://everyayah.com/data/';
const MP3QURAN_API = 'https://mp3quran.net/api/v3';

const MEMO_KEY = 'isnaad.audio.route.v1';

export interface AyahAudioCandidate {
  url: string;
  /** Arabic provenance label for the HUD. */
  provider: string;
  /** Stable key used to memoise the winning route for a reciter. */
  routeKey: string;
  /**
   * Present only for timed-window sources: the ayah occupies [startSec, endSec)
   * of a longer stream, and the player must bound playback to that span.
   */
  window?: { startSec: number; endSec: number };
}

export interface AyahRef {
  surah: number;
  ayah: number;
}

function pad3(n: number): string {
  return String(n).padStart(3, '0');
}

export function everyAyahFile(surah: number, ayah: number): string {
  return `${pad3(surah)}${pad3(ayah)}.mp3`;
}

/* ------------------------------------------------------------------ memo --- */

type RouteMemo = Partial<Record<ReciterId, string>>;

function readMemo(): RouteMemo {
  try {
    return JSON.parse(localStorage.getItem(MEMO_KEY) ?? '{}') as RouteMemo;
  } catch {
    return {};
  }
}

function writeMemo(memo: RouteMemo): void {
  try {
    localStorage.setItem(MEMO_KEY, JSON.stringify(memo));
  } catch {
    /* storage unavailable — routing simply re-probes next session */
  }
}

/** Called by the player once a candidate has actually produced audio. */
export function rememberRoute(reciter: ReciterId, routeKey: string): void {
  const memo = readMemo();
  if (memo[reciter] === routeKey) return;
  memo[reciter] = routeKey;
  writeMemo(memo);
}

export function forgetRoute(reciter: ReciterId): void {
  const memo = readMemo();
  delete memo[reciter];
  writeMemo(memo);
}

/* ------------------------------------------------- operator override base --- */

function overrideBase(reciter: Reciter): string | null {
  const env = (import.meta.env as Record<string, string | undefined>)[reciter.envKey];
  if (env) return env;
  try {
    return localStorage.getItem(`isnaad.audio.base.${reciter.id}`);
  } catch {
    return null;
  }
}

/* --------------------------------------------- quran.com recitation ids ---- */

interface RecitationRecord {
  id: number;
  reciter_name?: string;
  style?: string;
}

let recitationIndex: Promise<RecitationRecord[]> | null = null;

function loadRecitations(): Promise<RecitationRecord[]> {
  if (!recitationIndex) {
    recitationIndex = fetch(`${QURAN_API}/resources/recitations`)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((body: { recitations?: RecitationRecord[] }) => body.recitations ?? [])
      .catch(() => [] as RecitationRecord[]);
  }
  return recitationIndex;
}

const recitationIdCache = new Map<ReciterId, number | null>();

/**
 * Discover a quran.com recitation id by matching the reciter's known name keys.
 * Discovery beats hardcoding: the upstream catalogue is renumbered over time.
 */
export async function resolveRecitationId(reciter: Reciter): Promise<number | null> {
  if (recitationIdCache.has(reciter.id)) return recitationIdCache.get(reciter.id) ?? null;
  const records = await loadRecitations();
  let found: number | null = null;
  for (const record of records) {
    const haystack = `${record.reciter_name ?? ''} ${record.style ?? ''}`.toLowerCase();
    if (!haystack.trim()) continue;
    if (reciter.matchKeys.some((key) => haystack.includes(key.toLowerCase()))) {
      found = record.id;
      break;
    }
  }
  recitationIdCache.set(reciter.id, found);
  return found;
}

async function quranComCandidate(reciter: Reciter, ref: AyahRef): Promise<AyahAudioCandidate | null> {
  const id = await resolveRecitationId(reciter);
  if (id == null) return null;
  try {
    const res = await fetch(`${QURAN_API}/recitations/${id}/by_ayah/${ref.surah}:${ref.ayah}`);
    if (!res.ok) return null;
    const body = (await res.json()) as { audio_files?: { url?: string }[] };
    const raw = body.audio_files?.[0]?.url;
    if (!raw) return null;
    const url = /^https?:\/\//.test(raw) ? raw : VERSES_CDN + raw.replace(/^\/+/, '');
    return { url, provider: 'شبكة قرآن دوت كوم', routeKey: `qurancom:${id}` };
  } catch {
    return null;
  }
}

/* --------------------------------------------------- timed ayah windows ---- */

interface TimingRow {
  ayah: number;
  start_time: number;
  end_time: number;
}

export type AyahWindows = Map<number, { startSec: number; endSec: number }>;

const timingCache = new Map<string, Promise<AyahWindows | null>>();

/**
 * Fetch the ayah timing table for one surah. Cached per (reciter, surah) so
 * stepping through a surah costs a single request for the whole recitation.
 */
export function loadAyahWindows(readId: number, surah: number): Promise<AyahWindows | null> {
  const key = `${readId}:${surah}`;
  const cached = timingCache.get(key);
  if (cached) return cached;

  const task = fetch(`${MP3QURAN_API}/ayat_timing?surah=${surah}&read=${readId}`)
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
    .then((rows: TimingRow[]) => {
      if (!Array.isArray(rows) || !rows.length) return null;
      const windows: AyahWindows = new Map();
      for (const row of rows) {
        // Timings are milliseconds from the head of the surah stream. Rows with a
        // non-positive span are unusable and are dropped rather than played.
        if (!(row.end_time > row.start_time)) continue;
        windows.set(row.ayah, { startSec: row.start_time / 1000, endSec: row.end_time / 1000 });
      }
      return windows.size ? windows : null;
    })
    .catch(() => null);

  timingCache.set(key, task);
  return task;
}

async function timedCandidate(reciter: Reciter, ref: AyahRef): Promise<AyahAudioCandidate | null> {
  const source = reciter.timedSource;
  if (!source) return null;

  const windows = await loadAyahWindows(source.readId, ref.surah);
  const span = windows?.get(ref.ayah);
  if (!span) return null;

  return {
    url: `${source.server.replace(/\/+$/, '')}/${pad3(ref.surah)}.mp3`,
    provider: 'نافذة زمنية على مستوى الآية',
    routeKey: `timed:${source.readId}`,
    window: span,
  };
}

/* ------------------------------------------------------------ candidates --- */

/**
 * Build the ordered candidate list for one ayah. A memoised winning route is
 * hoisted to the front so steady-state playback issues exactly one request.
 */
export async function resolveAyahCandidates(
  reciterId: ReciterId,
  ref: AyahRef,
): Promise<AyahAudioCandidate[]> {
  const reciter = RECITER_BY_ID[reciterId];
  const file = everyAyahFile(ref.surah, ref.ayah);
  const candidates: AyahAudioCandidate[] = [];

  const base = overrideBase(reciter);
  if (base) {
    candidates.push({
      url: `${base.replace(/\/+$/, '')}/${file}`,
      provider: 'مصدر مُعرَّف محلياً',
      routeKey: `override:${base}`,
    });
  }

  for (const folder of reciter.everyAyahFolders) {
    candidates.push({
      url: `${EVERYAYAH_CDN}${folder}/${file}`,
      provider: 'إيفري آية',
      routeKey: `everyayah:${folder}`,
    });
  }

  const remote = await quranComCandidate(reciter, ref);
  if (remote) candidates.push(remote);

  const timed = await timedCandidate(reciter, ref);
  if (timed) candidates.push(timed);

  const memo = readMemo()[reciterId];
  if (memo) {
    candidates.sort((a, b) => Number(b.routeKey === memo) - Number(a.routeKey === memo));
  }

  return candidates;
}

/**
 * Warm the HTTP cache for the ayah that will play next. Failures are silent:
 * this is an optimisation, never a correctness requirement.
 */
export async function prefetchAyah(reciterId: ReciterId, ref: AyahRef): Promise<void> {
  try {
    const [first] = await resolveAyahCandidates(reciterId, ref);
    if (!first) return;
    // A timed candidate points at a whole-surah stream that is already loaded and
    // seekable; re-fetching it would download tens of megabytes for nothing.
    if (first.window) return;
    await fetch(first.url, { method: 'GET', mode: 'cors', cache: 'force-cache' });
  } catch {
    /* prefetch is best-effort */
  }
}
