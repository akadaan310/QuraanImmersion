/**
 * مصفوفة الإسناد السداسية — the live six-vector readout.
 *
 * Reads IsnaadEngine.snapshot on its own rAF and writes DOM style directly. It
 * deliberately does NOT use React state: the vectors change every frame, and
 * re-rendering six components at 60fps would compete with the render loop for
 * the main thread.
 */

import { useEffect, useRef } from 'react';

import { isnaadEngine, VECTOR_LABELS, VECTOR_SIGILS } from '@/engine/isnaad/IsnaadEngine';
import { toArabicNumerals } from '@/data/surahs';

const ORDER = [0, 1, 2, 4, 5, 3] as const; // execution order, not index order

export function IsnaadHUD({ accent }: { accent: string }) {
  const bars = useRef<(HTMLElement | null)[]>([]);
  const values = useRef<(HTMLElement | null)[]>([]);
  const counter = useRef<HTMLSpanElement>(null);
  const raf = useRef(0);

  useEffect(() => {
    const tick = () => {
      const snapshot = isnaadEngine.snapshot;
      for (let i = 0; i < 6; i += 1) {
        const value = snapshot.vector[i];
        const bar = bars.current[i];
        if (bar) bar.style.width = `${Math.round(value * 100)}%`;
        const readout = values.current[i];
        if (readout) readout.textContent = value.toFixed(2);
      }
      if (counter.current) counter.current.textContent = toArabicNumerals(snapshot.executions);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, []);

  return (
    <section className="hud-panel p-4" aria-label="مصفوفة الإسناد">
      <header className="flex items-baseline justify-between">
        <h2 className="font-kufi text-xs tracking-widest text-slate-200">مصفوفة الإسناد السداسية</h2>
        <p className="hud-label">
          تنفيذات: <span ref={counter}>٠</span>
        </p>
      </header>

      <ul className="mt-4 space-y-3">
        {ORDER.map((index, row) => (
          <li key={index} className="grid grid-cols-[auto_1fr_auto] items-center gap-3">
            <span
              className="font-mono text-[11px] tabular-nums"
              style={{ color: row === 1 ? accent : undefined }}
            >
              {VECTOR_SIGILS[index]}
            </span>
            <div>
              <p className="mb-1 font-kufi text-[11px] text-slate-400">{VECTOR_LABELS[index]}</p>
              <div className="vector-rail">
                <i
                  ref={(element) => {
                    bars.current[index] = element;
                  }}
                  style={{ width: '0%' }}
                />
              </div>
            </div>
            <span
              ref={(element) => {
                values.current[index] = element;
              }}
              className="w-8 text-left font-mono text-[10px] text-cyan-300/70"
              dir="ltr"
            >
              0.00
            </span>
          </li>
        ))}
      </ul>

      <p className="mt-4 border-t border-slate-800 pt-3 font-kufi text-[10px] leading-relaxed text-slate-500">
        ل١ يفتح الحالة، ل٢ يقود الشادرات، ل٣ و ل٥ فرعان عنه، ل٦ يغلق الدارة، ل٤ يقيسه موضعك في المشهد.
      </p>
    </section>
  );
}
