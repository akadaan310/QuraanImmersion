/**
 * BahraynHUD — live readout and controls for the two clock seas.
 *
 * One control per sea (lambda), and one number that matters more than any of
 * them: `barrierViolations`. That count is the running proof of لا يبغيان — it
 * is recomputed from the live coordinate arrays every report, and if it ever
 * leaves zero the two seas have mixed and the whole model has failed. It is
 * shown to the observer rather than hidden in a test.
 */

import { PHASE_LABEL, Phase } from '@/hypermath/dilation';
import { SEA_LABEL, type SeaId, type SeaStats } from '@/hypermath/DualSea';
import { toArabicNumerals } from '@/data/surahs';
import { useSession } from '@/state/store';

const PHASE_COLOR: Record<Phase, string> = {
  [Phase.SubCritical]: '#22d3ee',
  [Phase.Collapse]: '#818cf8',
  [Phase.SuperCritical]: '#fbbf24',
};

/** Compact scientific rendering; log-rates reach 1e6 and beyond. */
function sci(value: number): string {
  if (!Number.isFinite(value)) return '∞';
  if (value === 0) return '0';
  if (Math.abs(value) < 1000) return value.toFixed(2);
  return value.toExponential(2);
}

function SeaPanel({ id, stats }: { id: SeaId; stats: SeaStats | null }) {
  const lambda = useSession((s) => (id === 'lower' ? s.lambdaLower : s.lambdaUpper));
  const setLambda = useSession((s) => s.setLambda);
  const lastTapSea = useSession((s) => s.lastTapSea);
  const tapCounter = useSession((s) => s.tapCounter);

  const phase = stats?.phase ?? Phase.SubCritical;
  const accent = PHASE_COLOR[phase];
  const justTapped = lastTapSea === id;

  return (
    <div
      className="rounded-md border p-3 transition"
      style={{
        borderColor: `${accent}55`,
        boxShadow: justTapped ? `0 0 22px -8px ${accent}` : undefined,
      }}
      key={`${id}-${justTapped ? tapCounter : 0}`}
    >
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-naskh text-sm text-slate-100">{SEA_LABEL[id]}</h3>
        <span className="font-kufi text-[10px]" style={{ color: accent }}>
          {PHASE_LABEL[phase]}
        </span>
      </div>

      <label className="mt-3 block">
        <span className="flex items-baseline justify-between">
          <span className="hud-label">معامل القيمة الذاتية λ</span>
          <span className="font-mono text-[11px]" style={{ color: accent }} dir="ltr">
            {lambda.toFixed(2)}
          </span>
        </span>
        <input
          type="range"
          min={0.1}
          max={6}
          step={0.01}
          value={lambda}
          onChange={(event) => setLambda(id, Number(event.target.value))}
          className="mt-1 w-full"
          style={{ accentColor: accent }}
          dir="ltr"
          aria-label={`${SEA_LABEL[id]} — λ`}
        />
      </label>

      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 font-kufi text-[10px] text-slate-400">
        <dt>أقصى لوغاريتم الزمن</dt>
        <dd className="text-left font-mono text-cyan-300/80" dir="ltr">
          {stats ? sci(stats.logTauMax) : '—'}
        </dd>
        <dt>أقصى لوغاريتم المعدل</dt>
        <dd className="text-left font-mono text-cyan-300/80" dir="ltr">
          {stats ? sci(stats.logRateMax) : '—'}
        </dd>
        <dt>ساعات متجمدة</dt>
        <dd className="text-left font-mono" dir="ltr">
          {stats ? toArabicNumerals(stats.frozen) : '—'}
        </dd>
        <dt>عقد منفردة</dt>
        <dd className="text-left font-mono" dir="ltr">
          {stats ? toArabicNumerals(stats.singular) : '—'}
        </dd>
        <dt>نقرات</dt>
        <dd className="text-left font-mono" dir="ltr">
          {stats ? toArabicNumerals(stats.taps) : '—'}
        </dd>
      </dl>

      {stats?.exceedsFloat64 && (
        <p className="mt-2 rounded border border-amber-400/30 bg-amber-400/5 px-2 py-1 font-kufi text-[9px] leading-relaxed text-amber-200/90">
          تجاوز هذا البحر مدى الفاصلة العائمة المزدوجة — الحالة محفوظة لوغاريتمياً،
          ولولا ذلك لانهارت إلى لا نهاية.
        </p>
      )}
    </div>
  );
}

export function BahraynHUD() {
  const seaStats = useSession((s) => s.seaStats);
  const phenomenon = useSession((s) => s.phenomenon);

  // The continuum only runs inside its own scene; showing stale numbers
  // elsewhere would be worse than showing none.
  if (phenomenon !== 'marj-bahrayn') return null;

  const violations = seaStats?.barrierViolations ?? 0;
  const intact = violations === 0;

  return (
    <section className="hud-panel p-4" aria-label="بحرا الساعات">
      <header className="flex items-baseline justify-between">
        <h2 className="font-kufi text-xs tracking-widest text-slate-200">
          مرج البحرين — بحرا الساعات
        </h2>
        <span className="hud-label">
          {seaStats ? `خطوة ${toArabicNumerals(seaStats.steps)}` : '—'}
        </span>
      </header>

      <p className="mt-2 font-kufi text-[10px] leading-relaxed text-slate-500">
        انقر على أيّ بحر لفتح بئر ساعات فيه. أثر النقرة يتبع طور ذلك البحر وحده،
        ولا يعبر البرزخ.
      </p>

      <div className="mt-3 space-y-3">
        <SeaPanel id="upper" stats={seaStats?.upper ?? null} />

        {/* البرزخ — the live invariant, between the two panels where it belongs. */}
        <div
          className="rounded-md border px-3 py-2 text-center"
          style={{
            borderColor: intact ? 'rgba(34,211,238,0.35)' : 'rgba(244,63,94,0.6)',
            background: intact ? 'transparent' : 'rgba(244,63,94,0.08)',
          }}
        >
          <p className="font-naskh text-sm text-cyan-200">برزخ لا يبغيان</p>
          <p className="mt-1 font-kufi text-[10px] text-slate-400">
            {intact ? (
              <>لم تعبر أيّ خليّة الحاجز — العزل قائم</>
            ) : (
              <span className="text-rose-300">
                خرق: {toArabicNumerals(violations)} خليّة عبرت الحاجز
              </span>
            )}
          </p>
        </div>

        <SeaPanel id="lower" stats={seaStats?.lower ?? null} />
      </div>
    </section>
  );
}
