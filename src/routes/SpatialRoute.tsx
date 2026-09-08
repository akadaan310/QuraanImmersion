/**
 * /engine/spatial — the spatial topology module in isolation.
 *
 * Shows الرتق, حبالهم and دار القرار without a phenomenon competing for
 * attention: useful when tuning rope tension or containment strength.
 */

import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Link } from 'react-router-dom';

import { EngineDriver, CORE_RADIUS } from '@/engine/EngineDriver';
import { InvertedViewport } from '@/engine/spatial/InvertedViewport';
import { StarTreeRopes } from '@/engine/spatial/StarTreeRopes';
import { DefensiveAxis } from '@/engine/spatial/DefensiveAxis';
import { TransportBar } from '@/components/TransportBar';
import { AyahPlate } from '@/components/AyahPlate';
import { useSession } from '@/state/store';

const ACCENT = '#22d3ee';

const MODULES = [
  { title: 'الرتق', body: 'الكون مطوي في كرة بلورية، والمراقب خارجها يُسقِط الدورات نحو النواة.' },
  { title: 'حبالهم', body: 'أوتار طاقة بين مواقع النجوم ومراسي الشجر، شدّها من سعة التلاوة.' },
  { title: 'دار القرار', body: 'مصفوفة تثبيت تعزل البثّ المضاد وتقفل التوازن البنيوي.' },
];

export function SpatialRoute() {
  const surah = useSession((state) => state.surah);
  const ayah = useSession((state) => state.ayah);

  return (
    <main className="relative h-full w-full overflow-hidden bg-vacuum" dir="rtl">
      <div className="absolute inset-0">
        <Canvas
          dpr={[1, 2]}
          gl={{ antialias: true, alpha: false }}
          camera={{ position: [0, 1.8, 10], fov: 55, near: 0.1, far: 100 }}
        >
          <color attach="background" args={['#030712']} />
          <EngineDriver />
          <InvertedViewport accent={ACCENT} radius={CORE_RADIUS} />
          <DefensiveAxis accent={ACCENT} radius={CORE_RADIUS * 0.78} />
          <StarTreeRopes accent={ACCENT} radius={CORE_RADIUS * 1.55} />
          <OrbitControls
            enablePan={false}
            enableDamping
            minDistance={CORE_RADIUS * 1.35}
            maxDistance={CORE_RADIUS * 4.2}
          />
        </Canvas>
      </div>

      <header className="absolute inset-x-0 top-0 flex items-start justify-between gap-4 p-4">
        <div className="hud-panel max-w-lg p-4">
          <p className="hud-label">وحدة الطوبولوجيا الفراغية</p>
          <ul className="mt-3 space-y-3">
            {MODULES.map((entry) => (
              <li key={entry.title}>
                <h2 className="font-naskh text-base text-cyan-200">{entry.title}</h2>
                <p className="mt-1 font-kufi text-[11px] leading-relaxed text-slate-400">{entry.body}</p>
              </li>
            ))}
          </ul>
        </div>
        <Link to="/" className="hud-panel px-4 py-2 font-kufi text-[11px] text-slate-300">
          عودة إلى المشهد الكامل
        </Link>
      </header>

      <footer className="absolute inset-x-0 bottom-0 flex flex-col gap-3 p-4">
        <div className="mx-auto w-full max-w-3xl">
          <AyahPlate surah={surah} ayah={ayah} accent={ACCENT} />
        </div>
        <div className="mx-auto w-full max-w-3xl">
          <TransportBar accent={ACCENT} />
        </div>
      </footer>
    </main>
  );
}
