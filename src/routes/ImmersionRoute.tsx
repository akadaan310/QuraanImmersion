/**
 * المشهد الرئيسي — the full interactive viewport.
 *
 * MOBILE-FIRST. The canvas IS the experience, so on a phone it gets the whole
 * screen and every panel is off by default. The earlier layout pinned two
 * 288px rails plus a header row and a footer stack with `absolute`, which on a
 * 410px-wide phone overlapped each other and buried the WebGL surface entirely
 * — the immersion was rendering perfectly and was simply invisible underneath
 * the HUD.
 *
 * So the rails only exist at lg and above. Below that the panels live in a
 * bottom sheet that is closed until asked for, and the only permanent chrome is
 * a compact verse plate and transport.
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

import { Viewport } from '@/components/Viewport';
import { IsnaadHUD } from '@/components/IsnaadHUD';
import { AyahPlate } from '@/components/AyahPlate';
import { ReciterSwitcher } from '@/components/ReciterSwitcher';
import { SurahAyahSelector } from '@/components/SurahAyahSelector';
import { ExperiencePicker } from '@/components/ExperiencePicker';
import { BahraynHUD } from '@/components/BahraynHUD';
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

  /** Mobile-only slide-up sheet. Closed by default: the canvas comes first. */
  const [sheetOpen, setSheetOpen] = useState(false);

  const definition = PHENOMENON_BY_ID[phenomenon];

  useEffect(() => {
    ingestText(surah);
  }, [surah, ingestText]);

  return (
    <main className="relative h-full w-full overflow-hidden bg-vacuum" dir="rtl">
      <div className="absolute inset-0">
        <Viewport phenomenon={phenomenon} inverted={inverted} />
      </div>

      {/* Crown. On a phone this is one compact row that must not wrap into the
          canvas, so the labels shorten and the desktop-only actions drop out. */}
      <header className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-2 p-2 sm:p-4">
        <div className="pointer-events-auto hud-panel max-w-[55%] px-3 py-1.5 sm:px-4 sm:py-2">
          <p className="hud-label hidden sm:block">الظاهرة النشطة</p>
          <h1
            className="truncate font-naskh text-sm sm:mt-1 sm:text-lg"
            style={{ color: definition.accent }}
          >
            {definition.title}
          </h1>
        </div>

        <div className="pointer-events-auto flex flex-wrap justify-end gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={toggleInverted}
            className="hud-panel px-2.5 py-1.5 font-kufi text-[10px] text-slate-300 sm:px-3 sm:py-2 sm:text-[11px]"
          >
            {inverted ? 'الرتق' : 'مباشر'}
          </button>
          {/* The rails only exist at lg; below that the sheet replaces them. */}
          <button
            type="button"
            onClick={toggleHud}
            className="hud-panel hidden px-3 py-2 font-kufi text-[11px] text-slate-300 lg:block"
          >
            {hudVisible ? 'إخفاء اللوحات' : 'إظهار اللوحات'}
          </button>
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="hud-panel px-2.5 py-1.5 font-kufi text-[10px] text-slate-300 lg:hidden"
          >
            اللوحات
          </button>
          <Link
            to="/engine/isnaad"
            className="hud-panel hidden px-3 py-2 font-kufi text-[11px] text-slate-300 lg:block"
          >
            مصفوفة الإسناد
          </Link>
        </div>
      </header>

      {/* Desktop rails. Hidden below lg, where they would overlap each other
          and cover the canvas on any phone-width screen. */}
      {hudVisible && (
        <>
          <aside className="absolute right-4 top-24 bottom-44 hidden w-72 flex-col gap-3 overflow-y-auto pl-1 lg:flex">
            <ReciterSwitcher />
            <SurahAyahSelector />
          </aside>

          <aside className="absolute left-4 top-24 bottom-44 hidden w-72 flex-col gap-3 overflow-y-auto pr-1 lg:flex">
            <IsnaadHUD accent={definition.accent} />
            <BahraynHUD />
            <ExperiencePicker />
          </aside>
        </>
      )}

      {/* Permanent chrome: the verse and its transport, compact on a phone. */}
      <footer className="absolute inset-x-0 bottom-0 flex flex-col gap-2 p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] sm:gap-3 sm:p-4">
        <div className="mx-auto w-full max-w-3xl">
          <AyahPlate surah={surah} ayah={ayah} accent={definition.accent} />
        </div>
        <div className="mx-auto w-full max-w-3xl">
          <TransportBar accent={definition.accent} />
        </div>
      </footer>

      {/* Mobile sheet. Scrolls its own content and never steals the canvas
          unless the observer asked for it. */}
      {sheetOpen && (
        <div className="absolute inset-0 z-20 flex flex-col lg:hidden">
          <button
            type="button"
            aria-label="إغلاق اللوحات"
            onClick={() => setSheetOpen(false)}
            className="h-16 w-full bg-black/50 backdrop-blur-sm"
          />
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto bg-vacuum/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-md">
            <div className="flex items-center justify-between">
              <span className="hud-label">اللوحات</span>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                className="hud-panel px-3 py-1.5 font-kufi text-[11px] text-slate-300"
              >
                إغلاق
              </button>
            </div>
            <IsnaadHUD accent={definition.accent} />
            <BahraynHUD />
            <ReciterSwitcher />
            <SurahAyahSelector />
            <ExperiencePicker onPick={() => setSheetOpen(false)} />
          </div>
        </div>
      )}
    </main>
  );
}
