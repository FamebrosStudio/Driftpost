import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import AppErrorBoundary from './AppErrorBoundary.jsx';
import './styles.css';
import './console-theme.css';
import './pointer-proximity.js';
import { applyDeviceAttributes } from './utils/device.js';
import { installInteractivePhysics } from './utils/interactivePhysics.js';

applyDeviceAttributes();
installInteractivePhysics();
try {
  const savedMood = localStorage.getItem('driftpost-console-mood');
  const savedTheme = localStorage.getItem('driftpost-console-theme');
  if (savedMood) {
    document.documentElement.dataset.mood = savedMood;
    document.documentElement.dataset.theme = savedMood === 'light' ? 'light' : 'dark';
  } else if (savedTheme) {
    document.documentElement.dataset.theme = savedTheme;
  }
  if (localStorage.getItem('driftpost-reduced-motion') === 'true') {
    document.documentElement.dataset.motion = 'reduced';
  }
} catch {}

// A tab can keep an older HTML/app bundle open after a deployment while the
// server has already replaced its lazy-loaded chunks. Recover once instead of
// leaving the user on a blank Suspense screen when that stale chunk is missing.
const CHUNK_RELOAD_KEY = 'driftpost:chunk-reload-at';
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  let shouldReload = true;
  try {
    const previous = Number(sessionStorage.getItem(CHUNK_RELOAD_KEY) || 0);
    shouldReload = !previous || Date.now() - previous > 30_000;
    if (shouldReload) sessionStorage.setItem(CHUNK_RELOAD_KEY, String(Date.now()));
  } catch {}
  if (shouldReload) window.location.reload();
});

createRoot(document.getElementById('root')).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>,
);
