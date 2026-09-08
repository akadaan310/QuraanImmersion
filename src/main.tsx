import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

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
 * Debug bridge. The engines are module singletons with no React surface, so
 * without this there is no way to inspect or drive them from the console or from
 * an automated render harness. Nothing in the app reads it back.
 *
 * `session` is the Zustand store itself rather than a snapshot, because the two
 * external drivers — the browser console and the Termux CLI (`termux/`) — both
 * need to *act* on human-speed state, not merely read it: `getState().play()`,
 * `getState().selectVerse(18, 60)`. The catalogues ride along so a driver can
 * validate an id before handing it to a store that would index a table with it.
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
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
