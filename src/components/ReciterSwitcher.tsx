/**
 * مبدّل القارئ — ayah-level source selection.
 *
 * Switching mid-verse re-resolves the audio route and rebinds the analyser, so
 * the L2 vocal anchor changes identity without interrupting the Isnaad state.
 */

import { RECITERS } from '@/data/reciters';
import { useSession } from '@/state/store';

export function ReciterSwitcher() {
  const reciter = useSession((state) => state.reciter);
  const setReciter = useSession((state) => state.setReciter);
  const provider = useSession((state) => state.provider);
  const routeFailed = useSession((state) => state.routeFailed);

  return (
    <section className="hud-panel p-4" aria-label="اختيار القارئ">
      <h2 className="font-kufi text-xs tracking-widest text-slate-200">القارئ</h2>

      <ul className="mt-3 grid grid-cols-2 gap-2">
        {RECITERS.map((entry) => {
          const active = entry.id === reciter;
          return (
            <li key={entry.id}>
              <button
                type="button"
                onClick={() => setReciter(entry.id)}
                aria-pressed={active}
                className={`w-full rounded-md border px-3 py-2 text-right transition ${
                  active ? 'bg-white/5' : 'border-slate-800 hover:border-slate-600'
                }`}
                style={active ? { borderColor: entry.accent, boxShadow: `0 0 18px -8px ${entry.accent}` } : undefined}
              >
                <span className="block font-naskh text-sm text-slate-100">{entry.name}</span>
                <span className="mt-0.5 block font-kufi text-[10px] text-slate-500">{entry.register}</span>
              </button>
            </li>
          );
        })}
      </ul>

      <p className="mt-3 font-kufi text-[10px] leading-relaxed text-slate-500">
        {routeFailed
          ? 'تعذّر الوصول إلى مصدر الآية لهذا القارئ — جرّب قارئاً آخر أو تحقق من الشبكة.'
          : provider
            ? `المصدر النشط: ${provider} — جلب على مستوى الآية.`
            : 'الجلب يتم آية بآية لا سورة كاملة.'}
      </p>
    </section>
  );
}
