/**
 * المرحلة الثالثة — ألواح: كشف المصفوفة.
 *
 * Overlapping HUD data planes are revealed with zero staged latency: all three
 * planes mount at once and are separated in depth, not in time, so the operator
 * reads the conceptual shift as a single simultaneous state rather than a
 * sequence of slides.
 */

const PLANES = [
  {
    key: 'fitya',
    glyph: 'فتى / فتية',
    role: 'متجهات ارتساء بينية',
    body: 'نقاط ارتباط تعمل عبر المستوى المداري والمستوى الأرضي في آنٍ واحد.',
    tint: 'from-cyan-400/25',
  },
  {
    key: 'asfar',
    glyph: 'أسفار',
    role: 'حزم بيانات وفهرسة فراغية',
    body: 'تدفّق شفري عالي السرعة يفهرس المواقع ويحمل الحمولة بين العقد.',
    tint: 'from-amber-400/25',
  },
  {
    key: 'sakhrah',
    glyph: 'الصخرة والحوت',
    role: 'مراسٍ جذبية وعقد ملاحة',
    body: 'كثافة جذبية عالية تثبّت نقطة الالتقاء، والحوت عقدة انتقال زمني.',
    tint: 'from-emerald-400/25',
  },
] as const;

export function StageAlwah({ onComplete }: { onComplete: () => void }) {
  return (
    <div className="grain relative flex h-full w-full flex-col items-center justify-center gap-10 bg-vacuum px-6 py-12">
      <p className="hud-label">بروتوكول المعايرة — المرحلة ٣ من ٣</p>
      <h2 className="font-uthmani text-4xl text-cyan-200">ألواح</h2>

      <div className="relative grid w-full max-w-5xl gap-5 md:grid-cols-3">
        {PLANES.map((plane, index) => (
          <article
            key={plane.key}
            className={`hud-panel animate-driftIn relative overflow-hidden p-6 bg-gradient-to-bl ${plane.tint} to-transparent`}
            style={{
              // Depth separation, not temporal: the planes overlap in space.
              transform: `translateY(${index * 10 - 10}px) translateX(${index * 6 - 6}px)`,
              animationDelay: '0ms',
            }}
          >
            <span className="pointer-events-none absolute inset-x-0 top-0 h-px animate-scanline bg-cyan-300/30" />
            <p className="hud-label" dir="ltr">
              PLANE {index + 1}
            </p>
            <h3 className="mt-3 font-uthmani text-3xl text-slate-100">{plane.glyph}</h3>
            <p className="mt-2 font-kufi text-xs tracking-wide text-cyan-300/80">{plane.role}</p>
            <p className="mt-4 font-naskh text-sm leading-loose text-slate-300">{plane.body}</p>
          </article>
        ))}
      </div>

      <button
        type="button"
        onClick={onComplete}
        className="rounded-full border border-cyan-300/60 bg-cyan-400/10 px-12 py-3 font-kufi text-sm tracking-widest text-cyan-100 shadow-glow"
      >
        دخول المشهد
      </button>
    </div>
  );
}
