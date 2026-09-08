/**
 * /experiences/:slug — a single phenomenon studied on its own.
 *
 * Same engine, same audio, but the spatial overlays are muted and the crystal is
 * optional, so the scene's own geometry can be inspected without the surrounding
 * apparatus.
 */

import { useEffect } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';

import { Viewport } from '@/components/Viewport';
import { AyahPlate } from '@/components/AyahPlate';
import { TransportBar } from '@/components/TransportBar';
import { IsnaadHUD } from '@/components/IsnaadHUD';
import { PHENOMENON_BY_ID, type PhenomenonId } from '@/data/phenomena';
import { useSession } from '@/state/store';

export function ExperienceRoute() {
  const { slug } = useParams<{ slug: string }>();
  const setPhenomenon = useSession((state) => state.setPhenomenon);
  const selectVerse = useSession((state) => state.selectVerse);
  const surah = useSession((state) => state.surah);
  const ayah = useSession((state) => state.ayah);
  const inverted = useSession((state) => state.inverted);

  const known = slug && slug in PHENOMENON_BY_ID ? (slug as PhenomenonId) : null;

  useEffect(() => {
    if (!known) return;
    setPhenomenon(known);
    const [anchorSurah, anchorAyah] = PHENOMENON_BY_ID[known].anchors[0].split(':').map(Number);
    selectVerse(anchorSurah, anchorAyah);
  }, [known, setPhenomenon, selectVerse]);

  if (!known) return <Navigate to="/" replace />;

  const definition = PHENOMENON_BY_ID[known];

  return (
    <main className="relative h-full w-full overflow-hidden bg-vacuum" dir="rtl">
      <div className="absolute inset-0">
        <Viewport phenomenon={known} inverted={inverted} overlays={false} />
      </div>

      <header className="absolute inset-x-0 top-0 flex items-start justify-between gap-4 p-4">
        <div className="hud-panel max-w-md px-4 py-3">
          <p className="hud-label">وحدة ظاهرة مفردة</p>
          <h1 className="mt-1 font-naskh text-xl" style={{ color: definition.accent }}>
            {definition.title}
          </h1>
          <p className="mt-2 font-kufi text-[11px] leading-relaxed text-slate-400">{definition.brief}</p>
          <p className="mt-2 font-mono text-[10px] text-slate-600" dir="ltr">
            {definition.anchors.join('  ·  ')}
          </p>
        </div>

        <Link to="/" className="hud-panel px-4 py-2 font-kufi text-[11px] text-slate-300">
          عودة إلى المشهد الكامل
        </Link>
      </header>

      <aside className="absolute left-4 top-40 w-72">
        <IsnaadHUD accent={definition.accent} />
      </aside>

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
