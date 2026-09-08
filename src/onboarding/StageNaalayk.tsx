/**
 * المرحلة الثانية — إخلع نعليك: إعادة المعايرة الإدراكية.
 *
 * An interactive modal that disables the terrestrial frame of reference. The
 * operator must actively release each terrestrial lock; the stage does not
 * advance on a timer, because the recalibration is the operator's act.
 */

import { useState } from 'react';

const LOCKS = [
  { id: 'coords', label: 'إلغاء الإحداثيات الأرضية' },
  { id: 'temporal', label: 'تفعيل أجهزة الانتقال الزمني (يوشع بن نون ، إبراهيم)' },
  { id: 'core', label: 'ضبط سورة الكهف كمركز معالجة رئيسي' },
] as const;

const DECLARATION =
  'أخلع نعليك... إلغاء الإحداثيات الأرضية... تفعيل أجهزة الانتقال الزمني (يوشع بن نون ، إبراهيم)... ضبط سورة الكهف كمركز معالجة رئيسي.';

export function StageNaalayk({ onComplete }: { onComplete: () => void }) {
  const [released, setReleased] = useState<string[]>([]);
  const complete = released.length === LOCKS.length;

  const release = (id: string) => {
    setReleased((previous) => (previous.includes(id) ? previous : [...previous, id]));
  };

  return (
    <div className="grain relative flex h-full w-full items-center justify-center bg-vacuum px-6">
      <div className="hud-panel animate-driftIn w-full max-w-2xl p-8 sm:p-10">
        <p className="hud-label">بروتوكول المعايرة — المرحلة ٢ من ٣</p>

        <h2 className="mt-6 font-uthmani text-3xl text-amber-200 sm:text-4xl">إخلع نعليك</h2>

        <p className="mt-6 font-naskh text-base leading-loose text-slate-300 sm:text-lg">{DECLARATION}</p>

        <ul className="mt-8 space-y-3">
          {LOCKS.map((lock) => {
            const done = released.includes(lock.id);
            return (
              <li key={lock.id}>
                <button
                  type="button"
                  onClick={() => release(lock.id)}
                  aria-pressed={done}
                  className={`flex w-full items-center justify-between gap-4 rounded-md border px-4 py-3 text-right font-kufi text-sm transition ${
                    done
                      ? 'border-cyan-300/50 bg-cyan-400/10 text-cyan-100'
                      : 'border-slate-700 text-slate-400 hover:border-cyan-400/40 hover:text-slate-200'
                  }`}
                >
                  <span>{lock.label}</span>
                  <span className="font-mono text-[10px] tracking-widest" dir="ltr">
                    {done ? 'RELEASED' : 'LOCKED'}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <button
          type="button"
          disabled={!complete}
          onClick={onComplete}
          className={`mt-8 w-full rounded-full px-8 py-3 font-kufi text-sm tracking-widest transition ${
            complete
              ? 'border border-amber-300/60 bg-amber-400/10 text-amber-100 shadow-amber'
              : 'cursor-not-allowed border border-slate-800 text-slate-600'
          }`}
        >
          {complete ? 'الإطار المرجعي مُعطَّل — متابعة' : 'حرِّر جميع المراسي الأرضية'}
        </button>
      </div>
    </div>
  );
}
