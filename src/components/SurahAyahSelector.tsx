/**
 * محدّد السورة والآية — Arabic-only mushaf navigation.
 */

import { useMemo, useState } from 'react';

import { SURAHS, ayahCountOf, toArabicNumerals } from '@/data/surahs';
import { useSession } from '@/state/store';

export function SurahAyahSelector() {
  const surah = useSession((state) => state.surah);
  const ayah = useSession((state) => state.ayah);
  const selectVerse = useSession((state) => state.selectVerse);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const needle = query.trim();
    if (!needle) return SURAHS;
    return SURAHS.filter((entry) => entry.name.includes(needle));
  }, [query]);

  const count = ayahCountOf(surah);

  return (
    <section className="hud-panel flex min-h-0 flex-col p-4" aria-label="محدّد السورة والآية">
      <h2 className="font-kufi text-xs tracking-widest text-slate-200">السورة والآية</h2>

      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="ابحث باسم السورة"
        className="mt-3 w-full rounded-md border border-slate-800 bg-black/30 px-3 py-2 font-naskh text-sm text-slate-200 outline-none placeholder:text-slate-600 focus:border-cyan-400/50"
      />

      <ul className="mt-3 max-h-44 min-h-0 flex-1 overflow-y-auto pl-1">
        {filtered.map((entry) => {
          const active = entry.number === surah;
          return (
            <li key={entry.number}>
              <button
                type="button"
                onClick={() => selectVerse(entry.number, 1)}
                className={`flex w-full items-baseline justify-between gap-3 rounded px-2 py-1.5 text-right font-naskh text-sm transition ${
                  active ? 'bg-cyan-400/10 text-cyan-100' : 'text-slate-300 hover:bg-white/5'
                }`}
              >
                <span>
                  <span className="ml-2 font-mono text-[10px] text-slate-500">
                    {toArabicNumerals(entry.number)}
                  </span>
                  {entry.name}
                </span>
                <span className="font-mono text-[10px] text-slate-600">
                  {toArabicNumerals(entry.ayahCount)}
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="mt-4 border-t border-slate-800 pt-3">
        <div className="flex items-center justify-between">
          <label htmlFor="ayah-slider" className="hud-label">
            رقم الآية
          </label>
          <span className="font-mono text-xs text-cyan-300/80">
            {toArabicNumerals(ayah)} / {toArabicNumerals(count)}
          </span>
        </div>
        <input
          id="ayah-slider"
          type="range"
          min={1}
          max={count}
          value={ayah}
          onChange={(event) => selectVerse(surah, Number(event.target.value))}
          className="mt-2 w-full accent-cyan-400"
          dir="ltr"
        />
      </div>
    </section>
  );
}
