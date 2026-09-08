/**
 * المرحلة الأولى — الإستعاذة: الخلوص السمعي والبصري.
 *
 * The viewport collapses to #030712 and the Web Audio graph is opened by the
 * user's gesture (browsers require one). A procedural noise bed is then swept
 * through a BiquadFilterNode from the open band down to a sub-bass floor: the
 * high-frequency field is audibly cleared before anything else is admitted.
 */

import { useEffect, useRef, useState } from 'react';

import { audioEngine } from '@/audio/AudioEngine';
import { ISTIADHA } from '@/services/QuranTextService';

const CLEARANCE_SECONDS = 5;

export function StageIstiadha({ onComplete }: { onComplete: () => void }) {
  const [phase, setPhase] = useState<'idle' | 'clearing' | 'clear'>('idle');
  const [cutoff, setCutoff] = useState(12000);
  const raf = useRef(0);

  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const begin = async () => {
    setPhase('clearing');
    await audioEngine.unlock();
    audioEngine.runAcousticClearance(CLEARANCE_SECONDS);

    // Mirror the scheduled AudioParam ramp in the readout so the operator can
    // watch the band actually close rather than read a decorative animation.
    const started = performance.now();
    const tick = () => {
      const elapsed = (performance.now() - started) / 1000;
      const t = Math.min(elapsed / (CLEARANCE_SECONDS * 0.82), 1);
      setCutoff(Math.round(12000 * Math.pow(55 / 12000, t)));
      if (t < 1) {
        raf.current = requestAnimationFrame(tick);
      } else {
        setPhase('clear');
      }
    };
    raf.current = requestAnimationFrame(tick);
  };

  return (
    <div className="grain relative flex h-full w-full flex-col items-center justify-center gap-10 bg-vacuum px-6 text-center">
      <div
        className="pointer-events-none absolute inset-0 transition-opacity duration-1000"
        style={{
          opacity: phase === 'idle' ? 0.5 : 0.14,
          background: 'radial-gradient(circle at 50% 45%, rgba(34,211,238,0.14), transparent 62%)',
        }}
      />

      <p className="hud-label">بروتوكول المعايرة — المرحلة ١ من ٣</p>

      <p className="ayah-glyph max-w-3xl text-2xl leading-loose text-slate-200 sm:text-4xl">{ISTIADHA}</p>

      {phase === 'idle' ? (
        <button
          type="button"
          onClick={begin}
          className="rounded-full border border-cyan-400/40 px-10 py-3 font-kufi text-sm tracking-widest text-cyan-200 shadow-glow transition hover:border-cyan-300 hover:bg-cyan-400/10"
        >
          ابدأ الخلوص السمعي
        </button>
      ) : (
        <div className="flex w-full max-w-md flex-col items-center gap-3">
          <div className="vector-rail">
            <i style={{ width: `${100 - (Math.log(cutoff / 55) / Math.log(12000 / 55)) * 100}%` }} />
          </div>
          <p className="font-mono text-xs tracking-widest text-cyan-300/70" dir="ltr">
            LPF {cutoff} Hz
          </p>
          <p className="font-kufi text-xs text-slate-400">
            {phase === 'clearing' ? 'يجري كنس الترددات العالية…' : 'المجال خالٍ — أُذن بالدخول.'}
          </p>
        </div>
      )}

      {phase === 'clear' && (
        <button
          type="button"
          onClick={onComplete}
          className="animate-driftIn rounded-full border border-cyan-300/60 bg-cyan-400/10 px-10 py-3 font-kufi text-sm tracking-widest text-cyan-100"
        >
          متابعة
        </button>
      )}
    </div>
  );
}
