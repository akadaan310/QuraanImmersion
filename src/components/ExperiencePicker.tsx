/**
 * منتقي الظواهر — the twenty phenomenon modules.
 *
 * Selecting a phenomenon swaps the scene AND reweights the Isnaad array, since
 * each phenomenon emphasises different vectors (clay leans on L3/L5, the pulsar
 * on L1/L2, the mirage on L4).
 */

import { PHENOMENA } from '@/data/phenomena';
import { toArabicNumerals } from '@/data/surahs';
import { useSession } from '@/state/store';

export function ExperiencePicker({ onPick }: { onPick?: () => void }) {
  const phenomenon = useSession((state) => state.phenomenon);
  const setPhenomenon = useSession((state) => state.setPhenomenon);
  const selectVerse = useSession((state) => state.selectVerse);

  return (
    <section className="hud-panel flex min-h-0 flex-col p-4" aria-label="منتقي الظواهر">
      <h2 className="font-kufi text-xs tracking-widest text-slate-200">الظواهر الكونية — عشرون وحدة</h2>

      <ul className="mt-3 min-h-0 flex-1 space-y-1.5 overflow-y-auto pl-1">
        {PHENOMENA.map((entry, index) => {
          const active = entry.id === phenomenon;
          return (
            <li key={entry.id}>
              <button
                type="button"
                onClick={() => {
                  setPhenomenon(entry.id);
                  // Jump to the phenomenon's anchor verse so the audio matches it.
                  const [anchorSurah, anchorAyah] = entry.anchors[0].split(':').map(Number);
                  selectVerse(anchorSurah, anchorAyah);
                  onPick?.();
                }}
                aria-pressed={active}
                className={`w-full rounded-md border px-3 py-2 text-right transition ${
                  active ? 'bg-white/5' : 'border-slate-800/70 hover:border-slate-600'
                }`}
                style={active ? { borderColor: entry.accent, boxShadow: `0 0 18px -8px ${entry.accent}` } : undefined}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-naskh text-sm text-slate-100">{entry.title}</span>
                  <span className="font-mono text-[10px] text-slate-600">{toArabicNumerals(index + 1)}</span>
                </div>
                {active && (
                  <p className="mt-1.5 font-kufi text-[10px] leading-relaxed text-slate-400">{entry.brief}</p>
                )}
                <p className="mt-1 font-mono text-[9px] text-slate-600" dir="ltr">
                  {entry.anchors.join('  ·  ')}
                </p>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
