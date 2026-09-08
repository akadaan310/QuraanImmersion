/**
 * /engine/isnaad — the six-vector array laid out as the execution graph it is.
 *
 * The diagram is live: each node's fill is that vector's current value, so the
 * dependency structure (L3 and L5 hanging off L2, L6 closing over both, L4
 * gating what is witnessed) can be watched while a verse executes.
 */

import { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';

import { isnaadEngine, VECTOR_LABELS, VECTOR_SIGILS } from '@/engine/isnaad/IsnaadEngine';
import { TransportBar } from '@/components/TransportBar';
import { AyahPlate } from '@/components/AyahPlate';
import { PHENOMENON_BY_ID } from '@/data/phenomena';
import { useSession } from '@/state/store';

const NOTES: Record<number, string> = {
  0: 'مُطلِق الحالة الهندسية — يفتح تنفيذ الآية ويثبّت الأمر.',
  1: 'محلّل الصوت الحيّ — يقود كل موحّدات الشادر لحظة بلحظة.',
  2: 'تجسيد الموصوف — كثافة الطين، حواجز الحديد، انبثاق الضوء.',
  3: 'موضع المراقب وكاميرته داخل المشهد ثلاثي الأبعاد.',
  4: 'عقد المستمعين غير المرئيين — تستجيب متأخرةً عن الصوت.',
  5: 'ردّ السلام — دارة مغلقة تُقفل بانتهاء الآية فيتمدد المجال.',
};

function VectorNode({ index, accent }: { index: number; accent: string }) {
  const fill = useRef<HTMLDivElement>(null);
  const value = useRef<HTMLSpanElement>(null);
  const raf = useRef(0);

  useEffect(() => {
    const tick = () => {
      const level = isnaadEngine.snapshot.vector[index];
      if (fill.current) fill.current.style.transform = `scaleX(${level.toFixed(3)})`;
      if (value.current) value.current.textContent = level.toFixed(2);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [index]);

  return (
    <article className="hud-panel relative overflow-hidden p-4">
      <div
        ref={fill}
        className="pointer-events-none absolute inset-0 origin-right opacity-20"
        style={{ background: `linear-gradient(270deg, ${accent}, transparent)`, transform: 'scaleX(0)' }}
      />
      <div className="relative flex items-baseline justify-between gap-3">
        <h2 className="font-naskh text-sm text-slate-100">
          <span className="ml-2 font-mono text-xs" style={{ color: accent }}>
            {VECTOR_SIGILS[index]}
          </span>
          {VECTOR_LABELS[index]}
        </h2>
        <span ref={value} className="font-mono text-xs text-cyan-300/80" dir="ltr">
          0.00
        </span>
      </div>
      <p className="relative mt-2 font-kufi text-[11px] leading-relaxed text-slate-400">{NOTES[index]}</p>
    </article>
  );
}

function Connector({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-1">
      <span className="h-px w-8 bg-cyan-400/25" />
      <span className="font-kufi text-[10px] tracking-widest text-cyan-300/50">{label}</span>
      <span className="h-px w-8 bg-cyan-400/25" />
    </div>
  );
}

export function IsnaadRoute() {
  const phenomenon = useSession((state) => state.phenomenon);
  const surah = useSession((state) => state.surah);
  const ayah = useSession((state) => state.ayah);
  const accent = PHENOMENON_BY_ID[phenomenon].accent;

  return (
    <main className="h-full w-full overflow-y-auto bg-vacuum px-4 py-6" dir="rtl">
      <div className="mx-auto flex max-w-4xl flex-col gap-3">
        <header className="flex items-start justify-between gap-4">
          <div>
            <p className="hud-label">وحدة زمن التشغيل</p>
            <h1 className="mt-1 font-naskh text-2xl text-slate-100">مصفوفة الإسناد السداسية</h1>
          </div>
          <Link to="/" className="hud-panel px-4 py-2 font-kufi text-[11px] text-slate-300">
            عودة إلى المشهد الكامل
          </Link>
        </header>

        <VectorNode index={0} accent={accent} />
        <Connector label="يفتح" />
        <VectorNode index={1} accent={accent} />
        <Connector label="يتفرّع" />

        <div className="grid gap-3 sm:grid-cols-2">
          <VectorNode index={2} accent={accent} />
          <VectorNode index={4} accent={accent} />
        </div>

        <Connector label="يلتقيان" />
        <VectorNode index={5} accent={accent} />
        <Connector label="يُشهَد" />
        <VectorNode index={3} accent={accent} />

        <div className="mt-4">
          <AyahPlate surah={surah} ayah={ayah} accent={accent} />
        </div>
        <TransportBar accent={accent} />
      </div>
    </main>
  );
}
