/**
 * Shared browser harness for the verification scripts.
 *
 * Chromium is resolved from PW_CHROMIUM_PATH when set (CI images often ship a
 * pre-installed browser), otherwise Playwright's own download is used.
 */

import { chromium } from 'playwright';

export const BASE = process.env.VERIFY_BASE ?? 'http://localhost:4173';

export const PHENOMENON_SLUGS = [
  'ratq-fatq', 'teen-lazib', 'mawaqi-nujum', 'saqf-mahfooz', 'bahr-masjoor',
  'marj-bahrayn', 'hadeed-bas', 'zulumat-lujjiy', 'najm-thaqib', 'zubar-hadeed',
  'tayy-sijill', 'sarab-bee-qee-ah', 'noor-ala-noor', 'sahab-thiqal', 'shajarah-mubarakah',
  'awtad', 'dayyiq-haraj', 'kisaf-sama', 'hijr-mahjoor', 'sa-iqah',
];

export async function launch({ audio = false } = {}) {
  const executablePath = process.env.PW_CHROMIUM_PATH || undefined;
  const args = [
    // Software GL, so the shaders are exercised on machines without a GPU.
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
  ];
  if (audio) args.push('--autoplay-policy=no-user-gesture-required');

  const browser = await chromium.launch({ executablePath, args });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });

  // Mark the session unlocked. The one gesture the app asks for exists because
  // a browser will not open an AudioContext without it; these scripts drive the
  // analysis path directly and never need the real graph.
  await context.addInitScript(() => {
    try {
      localStorage.setItem('isnaad.unlocked.v2', 'yes');
    } catch {
      /* private mode — the gate simply shows, which the scripts tolerate */
    }
  });

  return { browser, context };
}

/**
 * Stand the journey at one phenomenon and adopt the closest standpoint.
 *
 * There are no routes any more: a scene is reached by pinning it at the current
 * station. `l2` — إسناد الصوت والربط — puts the camera inside the station, which
 * is what makes the screenshot a picture of the scene rather than of the Earth
 * behind it.
 */
export const STAND_AT = (slug) => {
  const bridge = window.__ISNAAD__;
  if (!bridge) throw new Error('debug bridge missing — is this a production build of the app?');
  bridge.session.getState().pinPhenomenon(slug);
  bridge.session.getState().adopt('l2');
  bridge.session.setState({ veil: false });
};

/** Push a synthetic recitation frame through the real analysis path. */
export const DRIVE_SYNTHETIC_AUDIO = () => {
  const bridge = window.__ISNAAD__;
  if (!bridge) throw new Error('debug bridge missing — is this a production build of the app?');
  const { audioEngine, isnaadEngine } = bridge;
  const real = audioEngine.analyse.bind(audioEngine);
  let t = 0;
  audioEngine.analyse = () => {
    const f = real();
    t += 1 / 60;
    const env = 0.55 + 0.35 * Math.sin(t * 2.1);
    f.dt = 1 / 60;
    f.time = t;
    f.level = env;
    f.peak = Math.min(1, env + 0.2);
    f.transient = Math.max(0, Math.sin(t * 7)) * 0.8;
    f.flux = 0.4;
    f.centroid = 0.45 + 0.2 * Math.sin(t * 0.7);
    f.subBass = 0.55 * env;
    f.bass = 0.7 * env;
    f.lowMid = 0.6 * env;
    f.mid = 0.65 * env;
    f.highMid = 0.5 * env;
    f.treble = 0.45 * env;
    f.playing = true;
    f.duration = 8;
    f.elapsed = t % 8;
    f.progress = (t % 8) / 8;
    for (let i = 0; i < f.spectrum.length; i += 1) f.spectrum[i] = Math.max(0, 200 * env * Math.exp(-i / 180));
    for (let i = 0; i < f.waveform.length; i += 1) {
      f.waveform[i] = env * 0.5 * Math.sin((i / f.waveform.length) * 90 + t * 8);
    }
    return f;
  };
  isnaadEngine.beginExecution();
};
