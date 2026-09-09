import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from './App';
import { bindEngineToSession, useSession } from '@/state/store';
import { audioEngine } from '@/audio/AudioEngine';
import { isnaadEngine } from '@/engine/isnaad/IsnaadEngine';
import { PHENOMENA } from '@/data/phenomena';
import { RECITERS } from '@/data/reciters';
import './index.css';

// One subscription for the page lifetime: AudioEngine events → session store.
bindEngineToSession();

/**
 * Debug bridge.
 *
 * The engines are module singletons with no React surface, and the interface
 * itself now offers nothing but the isnaad orientations — no transport, no
 * picker, no route. So this is the only way to inspect or drive the journey:
 * from the browser console, from the verification harness, or from the Termux
 * CLI over the bridge in `termux/`.
 *
 * `session` is the store itself rather than a snapshot, because every external
 * driver needs to ACT on human-speed state — `getState().selectVerse(18, 60)`,
 * `getState().adopt('l5')` — and not merely read it. The catalogues ride along
 * so a driver can validate an id before handing it to a store that would
 * otherwise index a table with it.
 */
declare global {
  interface Window {
    __ISNAAD__?: {
      audioEngine: typeof audioEngine;
      isnaadEngine: typeof isnaadEngine;
      session: typeof useSession;
      phenomena: typeof PHENOMENA;
      reciters: typeof RECITERS;
    };
  }
}
window.__ISNAAD__ = { audioEngine, isnaadEngine, session: useSession, phenomena: PHENOMENA, reciters: RECITERS };

const container = document.getElementById('root');
if (!container) throw new Error('root container missing');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
