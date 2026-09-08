/**
 * شريط الطيف — the L2 anchor, drawn straight from the AnalyserNode.
 *
 * A 2D canvas rather than a React tree: the spectrum is 1024 bins at 60fps, which
 * is not something to reconcile through a virtual DOM.
 */

import { useEffect, useRef } from 'react';

import { audioEngine } from '@/audio/AudioEngine';

export function SpectrumRibbon({ accent, height = 46 }: { accent: string; height?: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const raf = useRef(0);

  useEffect(() => {
    const element = canvas.current;
    if (!element) return;
    const context = element.getContext('2d');
    if (!context) return;

    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      element.width = element.clientWidth * ratio;
      element.height = height * ratio;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const draw = () => {
      const frame = audioEngine.frame;
      const width = element.clientWidth;
      context.clearRect(0, 0, width, height);

      const bins = 96;
      const step = Math.floor(frame.spectrum.length / bins);
      const barWidth = width / bins;

      for (let i = 0; i < bins; i += 1) {
        let sum = 0;
        for (let j = 0; j < step; j += 1) sum += frame.spectrum[i * step + j];
        const magnitude = sum / (step * 255);
        const barHeight = Math.max(1, Math.pow(magnitude, 0.75) * height);
        context.fillStyle = i / bins < frame.centroid ? accent : `${accent}55`;
        // RTL: low frequencies on the right, matching the reading direction.
        context.fillRect(width - (i + 1) * barWidth, height - barHeight, barWidth - 1, barHeight);
      }

      // Waveform overlay — the vocal envelope itself.
      context.beginPath();
      context.strokeStyle = 'rgba(226,232,240,0.5)';
      context.lineWidth = 1;
      for (let x = 0; x < width; x += 1) {
        const sample = frame.waveform[Math.floor((x / width) * frame.waveform.length)] ?? 0;
        const y = height / 2 + sample * height * 0.42;
        if (x === 0) context.moveTo(x, y);
        else context.lineTo(x, y);
      }
      context.stroke();

      raf.current = requestAnimationFrame(draw);
    };
    raf.current = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf.current);
      window.removeEventListener('resize', resize);
    };
  }, [accent, height]);

  return <canvas ref={canvas} className="w-full" style={{ height }} dir="ltr" />;
}
