/**
 * شريط التشغيل — ayah transport.
 *
 * Every control here operates on ONE ayah: play, repeat, step. There is no
 * surah-length playback mode, because the Isnaad loop is defined per verse.
 */

import { useEffect, useRef } from 'react';

import { audioEngine } from '@/audio/AudioEngine';
import { useSession } from '@/state/store';
import { SpectrumRibbon } from './SpectrumRibbon';

export function TransportBar({ accent }: { accent: string }) {
  const playing = useSession((state) => state.playing);
  const loopVerse = useSession((state) => state.loopVerse);
  const autoAdvance = useSession((state) => state.autoAdvance);
  const volume = useSession((state) => state.volume);

  const toggleTransport = useSession((state) => state.toggleTransport);
  const advance = useSession((state) => state.advance);
  const retreat = useSession((state) => state.retreat);
  const setLoopVerse = useSession((state) => state.setLoopVerse);
  const setAutoAdvance = useSession((state) => state.setAutoAdvance);
  const setVolume = useSession((state) => state.setVolume);

  const progress = useRef<HTMLElement>(null);
  const raf = useRef(0);

  useEffect(() => {
    const tick = () => {
      if (progress.current) {
        progress.current.style.width = `${Math.round(audioEngine.frame.progress * 100)}%`;
      }
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, []);

  // Space toggles transport; arrows step the mushaf. Ignored while typing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.code === 'Space') {
        event.preventDefault();
        toggleTransport();
      }
      // RTL: ArrowLeft advances, ArrowRight retreats.
      if (event.code === 'ArrowLeft') advance();
      if (event.code === 'ArrowRight') retreat();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleTransport, advance, retreat]);

  return (
    <section className="hud-panel px-2 py-2 sm:px-4 sm:py-3" aria-label="شريط التشغيل">
      <SpectrumRibbon accent={accent} height={28} />

      <div className="vector-rail my-3">
        <i ref={progress} style={{ width: '0%' }} />
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-between sm:gap-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={retreat}
            className="rounded-md border border-slate-800 px-2.5 py-1.5 font-kufi text-[10px] text-slate-300 hover:border-slate-600 sm:px-3 sm:text-[11px]"
          >
            الآية السابقة
          </button>

          <button
            type="button"
            onClick={toggleTransport}
            className="rounded-md border px-4 py-1.5 font-kufi text-[10px] sm:px-5 sm:text-[11px]"
            style={{ borderColor: accent, color: accent, boxShadow: `0 0 20px -10px ${accent}` }}
          >
            {playing ? 'إيقاف مؤقت' : 'تشغيل الآية'}
          </button>

          <button
            type="button"
            onClick={advance}
            className="rounded-md border border-slate-800 px-2.5 py-1.5 font-kufi text-[10px] text-slate-300 hover:border-slate-600 sm:px-3 sm:text-[11px]"
          >
            الآية التالية
          </button>
        </div>

        <div className="hidden items-center gap-4 sm:flex">
          <label className="flex items-center gap-2 font-kufi text-[11px] text-slate-400">
            <input
              type="checkbox"
              checked={loopVerse}
              onChange={(event) => setLoopVerse(event.target.checked)}
              className="accent-cyan-400"
            />
            تكرار الآية
          </label>

          <label className="flex items-center gap-2 font-kufi text-[11px] text-slate-400">
            <input
              type="checkbox"
              checked={autoAdvance}
              onChange={(event) => setAutoAdvance(event.target.checked)}
              className="accent-cyan-400"
            />
            تسلسل تلقائي
          </label>

          <label className="flex items-center gap-2 font-kufi text-[11px] text-slate-400">
            المستوى
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={volume}
              onChange={(event) => setVolume(Number(event.target.value))}
              className="w-24 accent-cyan-400"
              dir="ltr"
            />
          </label>
        </div>
      </div>
    </section>
  );
}
