#!/usr/bin/env node
/**
 * Plays a real ayah for each of the four reciters and asserts that:
 *   1. a route resolved (no reciter falls back to silence),
 *   2. energy actually reached the AnalyserNode — the L2 vocal anchor is live,
 *   3. a timed-window reciter plays for EXACTLY the published span of the ayah.
 *
 * Recitation audio is fetched over the network by this script and replayed to the
 * browser, so the test does not depend on the browser's own egress path.
 *
 *   npm run preview   # in another shell
 *   npm run verify:audio
 */

import { BASE, launch } from './lib/harness.mjs';

const EVERYAYAH = 'https://everyayah.com/data';
const MP3QURAN = 'https://mp3quran.net/api/v3';
const KURDI_SERVER = 'https://server6.mp3quran.net/kurdi';

/** Per-ayah reciters, checked on 18:1. */
const PER_AYAH = [
  { id: 'husary', folder: 'Husary_128kbps' },
  { id: 'qatami', folder: 'Nasser_Alqatami_128kbps' },
  { id: 'dosari', folder: 'Yasser_Ad-Dussary_128kbps' },
];

/** Al-Kurdi has no per-ayah CDN object; his path is the timed window (surah 112). */
const TIMED_SURAH = 112;

const buffers = new Map();
async function grab(url) {
  if (buffers.has(url)) return buffers.get(url);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} → ${response.status}`);
  const body = Buffer.from(await response.arrayBuffer());
  buffers.set(url, body);
  return body;
}

console.log('fetching recitation fixtures…');
for (const { folder } of PER_AYAH) await grab(`${EVERYAYAH}/${folder}/018001.mp3`);
await grab(`${KURDI_SERVER}/${String(TIMED_SURAH).padStart(3, '0')}.mp3`);
const timingBody = await grab(`${MP3QURAN}/ayat_timing?surah=${TIMED_SURAH}&read=221`);
const timings = JSON.parse(timingBody.toString());
const expectedSpan = new Map(timings.map((row) => [row.ayah, (row.end_time - row.start_time) / 1000]));

const { browser, context } = await launch({ audio: true });

await context.route('**/*', async (route) => {
  const url = route.request().url();
  if (url.startsWith(BASE)) return route.continue();

  for (const [key, body] of buffers) {
    if (!url.startsWith(key.split('?')[0])) continue;
    if (key.includes('ayat_timing')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body });
    }
    // Real CDNs honour Range; so must this, or seeking re-downloads the stream.
    const range = route.request().headers().range;
    const match = range && /bytes=(\d*)-(\d*)/.exec(range);
    if (match) {
      const start = match[1] ? Number(match[1]) : 0;
      const end = match[2] ? Number(match[2]) : body.length - 1;
      return route.fulfill({
        status: 206,
        headers: {
          'Content-Type': 'audio/mpeg',
          'Accept-Ranges': 'bytes',
          'Content-Range': `bytes ${start}-${end}/${body.length}`,
          'Content-Length': String(end - start + 1),
        },
        body: body.subarray(start, end + 1),
      });
    }
    return route.fulfill({
      status: 200,
      headers: { 'Content-Type': 'audio/mpeg', 'Accept-Ranges': 'bytes' },
      body,
    });
  }
  return route.abort();
});

const page = await context.newPage();
await page.goto(BASE + '/', { waitUntil: 'load' });
await page.waitForTimeout(1200);

const probe = (reciter, surah, ayah, ms) =>
  page.evaluate(
    async ({ reciter, surah, ayah, ms }) => {
      const { audioEngine, isnaadEngine } = window.__ISNAAD__;
      audioEngine.stop();
      audioEngine.setAutoAdvance(false);
      audioEngine.setLoopVerse(false);
      await audioEngine.unlock();

      const seen = { provider: null, failed: false };
      const off = audioEngine.subscribe((event) => {
        if (event.type === 'verse-start') seen.provider = event.provider;
        if (event.type === 'route-failed') seen.failed = true;
      });

      await audioEngine.playVerse(reciter, surah, ayah);

      let peakLevel = 0;
      let peakL2 = 0;
      const started = performance.now();
      while (performance.now() - started < ms) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        peakLevel = Math.max(peakLevel, audioEngine.frame.level);
        peakL2 = Math.max(peakL2, isnaadEngine.snapshot.l2);
      }
      off();
      audioEngine.stop();
      return { ...seen, peakLevel: +peakLevel.toFixed(3), peakL2: +peakL2.toFixed(3) };
    },
    { reciter, surah, ayah, ms },
  );

let failures = 0;
console.log('\nreciter   provider                              level     L2');
for (const { id } of PER_AYAH) {
  const result = await probe(id, 18, 1, 4500);
  const ok = !result.failed && result.peakLevel > 0.01;
  if (!ok) failures += 1;
  console.log(
    `${ok ? '✓' : '✗'} ${id.padEnd(8)} ${String(result.provider ?? 'NONE').padEnd(36)} ` +
      `${String(result.peakLevel).padStart(5)} ${String(result.peakL2).padStart(6)}`,
  );
}
const kurdi = await probe('kurdi', TIMED_SURAH, 1, 3000);
const kurdiOk = !kurdi.failed && kurdi.peakLevel > 0.01;
if (!kurdiOk) failures += 1;
console.log(
  `${kurdiOk ? '✓' : '✗'} ${'kurdi'.padEnd(8)} ${String(kurdi.provider ?? 'NONE').padEnd(36)} ` +
    `${String(kurdi.peakLevel).padStart(5)} ${String(kurdi.peakL2).padStart(6)}`,
);

// Timed windows must be exact: measured in MEDIA time, so a buffering stall
// delays the verse rather than being mistaken for a boundary error.
const marks = await page.evaluate(
  async (surah) => {
    const { audioEngine } = window.__ISNAAD__;
    audioEngine.stop();
    audioEngine.setAutoAdvance(true);
    await audioEngine.unlock();
    const out = [];
    const off = audioEngine.subscribe((event) => {
      if (event.type === 'verse-start' || event.type === 'verse-end') {
        out.push({ kind: event.type, ayah: event.ayah, at: audioEngine.mediaTime });
      }
    });
    await audioEngine.playVerse('kurdi', surah, 1);
    await new Promise((resolve) => setTimeout(resolve, 16000));
    off();
    audioEngine.stop();
    return out;
  },
  TIMED_SURAH,
);

await browser.close();

const spans = new Map();
for (const mark of marks) {
  const entry = spans.get(mark.ayah) ?? {};
  entry[mark.kind] = mark.at;
  spans.set(mark.ayah, entry);
}

console.log('\ntimed windows — ayah played for its published span');
console.log('ayah   published   measured    delta');
let measured = 0;
for (const [ayah, span] of [...spans].sort((a, b) => a[0] - b[0])) {
  if (span['verse-start'] == null || span['verse-end'] == null) continue;
  const want = expectedSpan.get(ayah);
  const got = span['verse-end'] - span['verse-start'];
  const delta = Math.abs(got - want);
  const ok = delta < 0.12;
  measured += 1;
  if (!ok) failures += 1;
  console.log(
    `${String(ayah).padStart(4)}  ${want.toFixed(3).padStart(9)}s ${got.toFixed(3).padStart(9)}s  ` +
      `${delta.toFixed(3)}s ${ok ? '✓' : '✗'}`,
  );
}
if (measured < 2) {
  console.error('✗ the timed stream did not advance across verse boundaries');
  failures += 1;
}

console.log(failures ? `\n✗ ${failures} audio check(s) failed` : '\n✓ all four reciters play bounded to a single ayah with a live analyser');
process.exit(failures ? 1 : 0);
