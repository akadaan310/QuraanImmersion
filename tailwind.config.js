/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        vacuum: '#030712',
        abyss: '#0b0f19',
        hull: '#111827',
        plate: '#1f2937',
        cyanGlow: '#22d3ee',
        cyanDeep: '#0891b2',
        amberGlow: '#fbbf24',
        amberDeep: '#b45309',
        signal: '#67e8f9',
      },
      fontFamily: {
        uthmani: ['"Amiri Quran"', '"KFGQPC Uthmanic Script HAFS"', '"Scheherazade New"', '"Noto Naskh Arabic"', 'serif'],
        naskh: ['"Noto Naskh Arabic"', '"Amiri"', 'serif'],
        kufi: ['"Noto Kufi Arabic"', '"Reem Kufi"', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 24px -4px rgba(34,211,238,0.45)',
        amber: '0 0 24px -4px rgba(251,191,36,0.45)',
      },
      keyframes: {
        breathe: {
          '0%,100%': { opacity: '0.35' },
          '50%': { opacity: '1' },
        },
        scanline: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100%)' },
        },
        driftIn: {
          '0%': { opacity: '0', transform: 'translateY(12px) scale(0.98)' },
          '100%': { opacity: '1', transform: 'translateY(0) scale(1)' },
        },
      },
      animation: {
        breathe: 'breathe 3.6s ease-in-out infinite',
        scanline: 'scanline 5s linear infinite',
        driftIn: 'driftIn 900ms cubic-bezier(0.16,1,0.3,1) both',
      },
    },
  },
  plugins: [],
};
