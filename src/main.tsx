import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import App from './App';
import { bindEngineToSession } from '@/state/store';
import { audioEngine } from '@/audio/AudioEngine';
import { isnaadEngine } from '@/engine/isnaad/IsnaadEngine';
import './index.css';

// One subscription for the page lifetime: AudioEngine events → session store.
bindEngineToSession();

/**
 * Debug bridge. The engines are module singletons with no React surface, so
 * without this there is no way to inspect or drive them from the console or from
 * an automated render harness. Read-only by convention; nothing in the app reads
 * it back.
 */
declare global {
  interface Window {
    __ISNAAD__?: { audioEngine: typeof audioEngine; isnaadEngine: typeof isnaadEngine };
  }
}
window.__ISNAAD__ = { audioEngine, isnaadEngine };

const container = document.getElementById('root');
if (!container) throw new Error('root container missing');

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
