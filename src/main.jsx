import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import AppErrorBoundary from './AppErrorBoundary.jsx';
import './styles.css';
import './console-theme.css';
import './pointer-proximity.js';
import { applyDeviceAttributes } from './utils/device.js';
import { applyCursorStyle, installInteractivePhysics } from './utils/interactivePhysics.js';

applyDeviceAttributes();

const applyStoredPreferences = () => {
  try {
    const savedMood = localStorage.getItem('driftpost-console-mood');
    const savedTheme = localStorage.getItem('driftpost-console-theme');
    if (savedMood) {
      document.documentElement.dataset.mood = savedMood;
      document.documentElement.dataset.theme = savedMood === 'light' ? 'light' : 'dark';
    } else if (savedTheme) {
      document.documentElement.dataset.theme = savedTheme;
    }
    document.documentElement.dataset.motion = localStorage.getItem('driftpost-reduced-motion') === 'true' ? 'reduced' : 'full';
  } catch {}
};

applyStoredPreferences();
installInteractivePhysics();

// Keep theme, motion, and cursor preferences synced across open Driftpost tabs.
window.addEventListener('storage', (event) => {
  if (!event.key) return;
  if (event.key === 'driftpost-console-mood' || event.key === 'driftpost-console-theme' || event.key === 'driftpost-reduced-motion') {
    applyStoredPreferences();
    applyCursorStyle();
  } else if (event.key === 'driftpost-cursor-style') {
    applyCursorStyle(event.newValue || undefined);
  }
});

// A tab can keep an older HTML/app bundle open after a deployment while the
// server has already replaced its lazy-loaded chunks. Recover once instead of
// leaving the user on a blank Suspense screen when that stale chunk is missing.
const CHUNK_RELOAD_KEY = 'driftpost:chunk-reload-at';
const reloadOnceForStaleChunk = () => {
  let shouldReload = true;
  try {
    const previous = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) || 0);
    shouldReload = !previous || Date.now() - previous > 30_000;
    if (shouldReload) sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
  } catch {}
  if (shouldReload) window.location.reload();
};

window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  reloadOnceForStaleChunk();
});

window.addEventListener('unhandledrejection', (event) => {
  const msg = String(event?.reason?.message || event?.reason || '');
  if (/dynamically imported module|ChunkLoadError|Importing a module script failed/i.test(msg)) {
    event.preventDefault?.();
    reloadOnceForStaleChunk();
  }
});

createRoot(document.getElementById('root')).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>,
);
