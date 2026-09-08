/**
 * BahraynHUD — a readout of the two clock seas. It contains no inputs.
 *
 * Every number here is derived: each sea's lambda comes from the Isnaad vectors
 * that correspond to it, its clock wells come from the recitation's onsets, and
 * the upper sea's link state comes from real round trips to the deployed
 * endpoint. Nothing on this panel can be adjusted, because nothing about the
 * experience is adjustable — it follows the recitation.
 *
 * Two of these numbers matter more than the rest:
 *
 *   barrierViolations  the running proof of لا يبغيان. Recomputed from the live
 *                      coordinate arrays every report; if it ever leaves zero
 *                      the seas have mixed and the model has failed. It is
 *                      shown rather than hidden in a test.
 *
 *   rttMs              the upper sea's real distance. Its clocks make an actual
 *                      round trip through the deployment, and this is how long
 *                      that took — not a decoration.
 */

import { useEffect, useState } from 'react';

import { PHASE_LABEL, Phase } from '@/hypermath/dilation';
import { SEA_LABEL, type SeaId, type SeaStats } from '@/hypermath/DualSea';
import { continuumStats, drivenLambda, upperLink } from '@/hypermath/continuum';
import type { LinkState } from '@/services/UpperSeaSync';
import { toArabicNumerals } from '@/data/surahs';
import type { DualSeaStats } from '@/hypermath/DualSea';

const PHASE_COLOR: Record<Phase, string> = {
  [Phase.SubCritical]: '#22d3ee',
  [Phase.Collapse]: '#818cf8',
  [Phase.SuperCritical]: '#fbbf24',
};

const LINK_LABEL: Record<LinkState, string> = {
  idle: 'في انتظار أول إطار',
  live: 'متصل — الساعات العليا تعبر السحابة',
  degraded: 'اضطراب في الوصلة — البحر يواصل محلياً',
  offline: 'الوصلة منقطعة — البحر يواصل محلياً',
};

const LINK_COLOR: Record<LinkState, string> = {
  idle: '#64748b',
  live: '#34d399',
  degraded: '#fbbf24',
  offline: '#f87171',
};

/** Compact scientific rendering; log-rates reach 1e6 and beyond. */
function sci(value: number): string {
  if (!Number.isFinite(value)) return '∞';
  if (value === 0) return '0';
  if (Math.abs(value) < 1000) return value.toFixed(2);
  return value.toExponential(2);
}

function SeaPanel({ id, stats, lambda }: { id: SeaId; stats: SeaStats | null; lambda: number }) {
  const phase = stats?.phase ?? Phase.SubCritical;
  const accent = PHASE_COLOR[phase];
  // A bar, not a slider: it reports where the recitation has driven lambda.
  const sweep = Math.min(Math.max((lambda - 0.5) / 5.0, 0), 1);
  const criticalAt = (3.0 - 0.5) / 5.0;

  return (
    <div className="rounded-md border p-3" style={{ borderColor: `${accent}55` }}>
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="font-naskh text-sm text-slate-100">{SEA_LABEL[id]}</h3>
        <span className="font-kufi text-[10px]" style={{ color: accent }}>
          {PHASE_LABEL[phase]}
        </span>
      </div>

      <div className="mt-3">
        <div className="flex items-baseline justify-between">
          <span className="hud-label">معامل القيمة الذاتية λ</span>
          <span className="font-mono text-[11px]" style={{ color: accent }} dir="ltr">
            {lambda.toFixed(2)}
          </span>
        </div>
        <div className="relative mt-1 h-[6px] w-full overflow-hidden rounded-full bg-slate-800">
          <i className="absolute inset-y-0 right-0 block rounded-full transition-[width] duration-150"
             style={{ width: `${sweep * 100}%`, background: accent }} />
          {/* The critical threshold, marked in place so the crossing is visible. */}
          <span className="absolute inset-y-0 w-px bg-white/50"
                style={{ right: `${criticalAt * 100}%` }} aria-hidden />
        </div>
      </div>

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
        <dt>آبار مفتوحة</dt>
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
  const [seaStats, setSeaStats] = useState<DualSeaStats | null>(null);
  const [lambda, setLambda] = useState({ lower: 1, upper: 1 });
  const [link, setLink] = useState(() => ({ ...upperLink() }));

  // All three change at frame or network rate. None belongs in the store, so
  // they are sampled here at reading speed — which also means this readout is
  // correct in every scene, since the continuum is global.
  useEffect(() => {
    const id = window.setInterval(() => {
      setSeaStats(continuumStats());
      setLambda(drivenLambda());
      setLink({ ...upperLink() });
    }, 180);
    return () => window.clearInterval(id);
  }, []);

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
        البحران يتبعان التلاوة وحدها: λ من متجهات الإسناد، وآبار الساعات من نبضات الصوت.
      </p>

      <div className="mt-3 space-y-3">
        <SeaPanel id="upper" stats={seaStats?.upper ?? null} lambda={lambda.upper} />

        {/* The link the upper sea's clocks actually travel over. */}
        <div className="rounded-md border px-3 py-2"
             style={{ borderColor: `${LINK_COLOR[link.state]}44` }}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="font-kufi text-[10px]" style={{ color: LINK_COLOR[link.state] }}>
              {LINK_LABEL[link.state]}
            </span>
            <span className="font-mono text-[10px] text-slate-400" dir="ltr">
              {link.state === 'live' ? `${link.rttMs.toFixed(0)} ms` : '—'}
            </span>
          </div>
          {link.state === 'live' && (
            <p className="mt-1 font-mono text-[9px] text-slate-600" dir="ltr">
              {toArabicNumerals(link.acked)} frames · {link.ratio.toFixed(2)}x
              {link.region ? ` · ${link.region}` : ''}
            </p>
          )}
        </div>

        {/* البرزخ — the live invariant, between the two seas where it belongs. */}
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

        <SeaPanel id="lower" stats={seaStats?.lower ?? null} lambda={lambda.lower} />
      </div>
    </section>
  );
}
