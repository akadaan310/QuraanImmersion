/**
 * المشهد الرئيسي — the full interactive viewport.
 *
 * The canvas fills the frame; every panel is an overlay above it, so the
 * phenomenon is never boxed into a widget. Panels can be dismissed entirely
 * (ح) for an unobstructed field.
 */

import { useEffect } from 'react';
import { Link } from 'react-router-dom';

import { Viewport } from '@/components/Viewport';
import { IsnaadHUD } from '@/components/IsnaadHUD';
import { AyahPlate } from '@/components/AyahPlate';
import { ReciterSwitcher } from '@/components/ReciterSwitcher';
import { SurahAyahSelector } from '@/components/SurahAyahSelector';
import { ExperiencePicker } from '@/components/ExperiencePicker';
import { TransportBar } from '@/components/TransportBar';
import { PHENOMENON_BY_ID } from '@/data/phenomena';
import { useSession } from '@/state/store';

export function ImmersionRoute() {
  const phenomenon = useSession((state) => state.phenomenon);
  const surah = useSession((state) => state.surah);
  const ayah = useSession((state) => state.ayah);
  const inverted = useSession((state) => state.inverted);
  const hudVisible = useSession((state) => state.hudVisible);
  const toggleHud = useSession((state) => state.toggleHud);
  const toggleInverted = useSession((state) => state.toggleInverted);
  const ingestText = useSession((state) => state.ingestText);

  const definition = PHENOMENON_BY_ID[phenomenon];

  useEffect(() => {
    ingestText(surah);
  }, [surah, ingestText]);

  return (
    <main className="relative h-full w-full overflow-hidden bg-vacuum" dir="rtl">
      <div className="absolute inset-0">
        <Viewport phenomenon={phenomenon} inverted={inverted} />
      </div>

      {/* Crown: phenomenon identity + viewport mode. */}
      <header className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-4 p-4">
        <div className="pointer-events-auto hud-panel px-4 py-2">
          <p className="hud-label">الظاهرة النشطة</p>
          <h1 className="mt-1 font-naskh text-lg" style={{ color: definition.accent }}>
            {definition.title}
          </h1>
        </div>

        <div className="pointer-events-auto flex gap-2">
          <button
            type="button"
            onClick={toggleInverted}
            className="hud-panel px-3 py-2 font-kufi text-[11px] text-slate-300"
          >
            {inverted ? 'المنظور: الرتق (من الخارج)' : 'المنظور: مباشر'}
          </button>
          <button
            type="button"
            onClick={toggleHud}
            className="hud-panel px-3 py-2 font-kufi text-[11px] text-slate-300"
          >
            {hudVisible ? 'إخفاء اللوحات' : 'إظهار اللوحات'}
          </button>
          <Link
            to="/engine/isnaad"
            className="hud-panel px-3 py-2 font-kufi text-[11px] text-slate-300"
          >
            مصفوفة الإسناد
          </Link>
        </div>
      </header>

      {hudVisible && (
        <>
          {/* Right rail (leading edge in RTL): navigation. */}
          <aside className="absolute right-4 top-24 bottom-40 flex w-72 flex-col gap-3 overflow-hidden">
            <ReciterSwitcher />
            <SurahAyahSelector />
          </aside>

          {/* Left rail: state readout and the phenomenon index. */}
          <aside className="absolute left-4 top-24 bottom-40 flex w-72 flex-col gap-3 overflow-hidden">
            <IsnaadHUD accent={definition.accent} />
            <ExperiencePicker />
          </aside>
        </>
      )}

      {/* Bottom: the verse plate and its transport. */}
      <footer className="absolute inset-x-0 bottom-0 flex flex-col gap-3 p-4">
        <div className="mx-auto w-full max-w-3xl">
          <AyahPlate surah={surah} ayah={ayah} accent={definition.accent} />
        </div>
        <div className="mx-auto w-full max-w-3xl">
          <TransportBar accent={definition.accent} />
        </div>
      </footer>
    </main>
  );
}
