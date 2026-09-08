/**
 * لوح الآية — the Uthmani text plate.
 *
 * Renders the current ayah in original Arabic script and NOTHING ELSE. There is
 * no translation slot, no transliteration slot, and no place to add one: the
 * component's only text input is `AyahText.text`, which QuranTextService has
 * already rejected if it contained Latin characters.
 */

import { useEffect, useState } from 'react';

import { loadAyahText, peekAyahText, BASMALA, type AyahText } from '@/services/QuranTextService';
import { getSurah, toArabicNumerals } from '@/data/surahs';

export function AyahPlate({ surah, ayah, accent }: { surah: number; ayah: number; accent: string }) {
  const [verse, setVerse] = useState<AyahText | null>(() => peekAyahText(surah, ayah));
  const [failed, setFailed] = useState(false);
  const definition = getSurah(surah);

  useEffect(() => {
    let live = true;
    const cached = peekAyahText(surah, ayah);
    setVerse(cached);
    setFailed(false);

    loadAyahText(surah, ayah)
      .then((result) => {
        if (live) setVerse(result);
      })
      .catch(() => {
        if (live) setFailed(true);
      });

    return () => {
      live = false;
    };
  }, [surah, ayah]);

  // التوبة is the one surah not opened with the basmala.
  const showBasmala = ayah === 1 && surah !== 9 && surah !== 1;

  return (
    // translate="no" + notranslate repeat the document-level lockdown at the one
    // element that must never be rewritten. Chrome was observed translating the
    // Basmala here in production; belt and braces is warranted for this node.
    <section className="hud-panel px-6 py-5 notranslate" translate="no" aria-label="نص الآية">
      <header className="flex items-baseline justify-between gap-4">
        <h2 className="font-uthmani text-xl text-slate-100">
          سورة {definition.name}
          <span className="mr-3 font-kufi text-[11px] text-slate-500">{definition.place}</span>
        </h2>
        <span
          className="rounded-full border px-3 py-1 font-mono text-[11px]"
          style={{ borderColor: `${accent}55`, color: accent }}
        >
          {toArabicNumerals(surah)} : {toArabicNumerals(ayah)}
        </span>
      </header>

      {showBasmala && (
        <p className="ayah-glyph mt-4 text-center text-lg text-slate-400/80">{BASMALA}</p>
      )}

      <p className="ayah-glyph mt-4 text-center text-2xl leading-[2.4] text-slate-100 sm:text-3xl">
        {verse ? (
          <>
            {verse.text}
            <span className="mr-2 align-middle font-mono text-sm text-cyan-300/70">
              ﴿{toArabicNumerals(ayah)}﴾
            </span>
          </>
        ) : failed ? (
          <span className="font-kufi text-sm text-rose-300/80">تعذّر جلب الرسم العثماني.</span>
        ) : (
          <span className="animate-breathe font-kufi text-sm text-slate-500">…يجري تحميل الرسم العثماني</span>
        )}
      </p>
    </section>
  );
}
