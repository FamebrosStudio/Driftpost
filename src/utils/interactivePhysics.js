// Apple-style hold-and-nudge elastic physics + hardware-composited 0ms-lag SVG cursor system.
const HOLD_SELECTOR = [
  '.ws-stat', '.ws-welcome', '.ws-create-mode-card', '.cn-card', '.hist-row',
  '.setup-card', '.ws-mood-card', '.ws-cursor-card', '.feed-it-item', '.ws-panel',
  '.ws-primary', '.ws-secondary', '.ws-topnav-pill', '.ws-topbar-icon-btn',
  '.ws-wordmark', '.ws-user', '.continue-btn', '.s2-continue-btn', '.cn-next',
  '.s3-postall', '.s3-schedall', '.ws-route-stop',
].join(',');

const TEXT_INPUT_SELECTOR = 'input, textarea, select, option, [contenteditable="true"]';
const NATIVE_DRAG_IGNORE = '.crop-box, .crop-handle, .s2-resize-handle, .s2-rotate-handle, .s2-timeline-track, [draggable="true"]';
const CURSOR_STORAGE_KEY = 'driftpost-cursor-style';

function encodeSvgCursor(svgString, hx, hy, fallback) {
  const encoded = encodeURIComponent(svgString.replace(/\s+/g, ' ').trim());
  return `url("data:image/svg+xml,${encoded}") ${hx} ${hy}, ${fallback}`;
}

export const CURSOR_STYLES = [
  {
    id: 'precision',
    label: 'Precision Vector',
    note: 'Razor-sharp white & obsidian pointer with adaptive accent edge',
    hotspot: { x: 2, y: 2 },
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M2.5 2.2L19.6 10.7L12.1 13.1L9.2 20.4L2.5 2.2Z" fill="#ffffff" stroke="#09090b" stroke-width="1.5" stroke-linejoin="round"/></svg>`,
    pointerSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M2.5 2.2L19.6 10.7L12.1 13.1L9.2 20.4L2.5 2.2Z" fill="#ffffff" stroke="__ACCENT__" stroke-width="1.7" stroke-linejoin="round"/></svg>`,
  },
  {
    id: 'obsidian',
    label: 'Obsidian Blade',
    note: 'Stealth dark titanium dart with luminous accent core',
    hotspot: { x: 2, y: 2 },
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M2.4 2.1L20.2 9.8L12.6 12.6L9.8 20.2L2.4 2.1Z" fill="#0b0c10" stroke="__ACCENT__" stroke-width="1.5" stroke-linejoin="round"/><path d="M5.6 5.3L14.5 9.3L10.8 10.8L9.3 14.5L5.6 5.3Z" fill="__ACCENT__" opacity="0.9"/></svg>`,
    pointerSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M2.4 2.1L20.2 9.8L12.6 12.6L9.8 20.2L2.4 2.1Z" fill="#0b0c10" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round"/><path d="M5.6 5.3L14.5 9.3L10.8 10.8L9.3 14.5L5.6 5.3Z" fill="__ACCENT__"/></svg>`,
  },
  {
    id: 'reticle',
    label: 'Reticle Pro',
    note: 'Aerospace precision crosshair that locks onto interactive controls',
    hotspot: { x: 13, y: 13 },
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26" fill="none"><circle cx="13" cy="13" r="8.5" stroke="__ACCENT__" stroke-width="1.4" stroke-dasharray="3.5 2.5"/><path d="M13 2V6.5M13 19.5V24M2 13H6.5M19.5 13H24" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round"/><circle cx="13" cy="13" r="2" fill="__ACCENT__"/></svg>`,
    pointerSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26" fill="none"><circle cx="13" cy="13" r="9.5" stroke="__ACCENT__" stroke-width="1.7"/><path d="M4.5 4.5L8 8M21.5 4.5L18 8M4.5 21.5L8 18M21.5 21.5L18 18" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round"/><circle cx="13" cy="13" r="2.5" fill="#ffffff"/></svg>`,
  },
  {
    id: 'glass',
    label: 'Liquid Glass',
    note: 'Translucent Apple-style prism pointer with specular sheen',
    hotspot: { x: 2, y: 2 },
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none"><defs><linearGradient id="g1" x1="2" y1="2" x2="18" y2="20" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#ffffff" stop-opacity="0.94"/><stop offset="55%" stop-color="#cbd5e1" stop-opacity="0.58"/><stop offset="100%" stop-color="__ACCENT__" stop-opacity="0.78"/></linearGradient></defs><path d="M2.5 2.2L19.5 10.5L12.1 12.9L9.3 20.2L2.5 2.2Z" fill="url(#g1)" stroke="#ffffff" stroke-width="1.35" stroke-linejoin="round"/></svg>`,
    pointerSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none"><defs><linearGradient id="g2" x1="2" y1="2" x2="18" y2="20" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#ffffff" stop-opacity="0.96"/><stop offset="100%" stop-color="__ACCENT__" stop-opacity="0.9"/></linearGradient></defs><path d="M2.5 2.2L19.5 10.5L12.1 12.9L9.3 20.2L2.5 2.2Z" fill="url(#g2)" stroke="__ACCENT__" stroke-width="1.5" stroke-linejoin="round"/></svg>`,
  },
  {
    id: 'halo',
    label: 'Aura Ring',
    note: 'Centered micro-needle inside a reactive kinetic halo',
    hotspot: { x: 13, y: 13 },
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26" fill="none"><circle cx="13" cy="13" r="9.5" stroke="#ffffff" stroke-opacity="0.86" stroke-width="1.4"/><circle cx="13" cy="13" r="5" stroke="__ACCENT__" stroke-opacity="0.55" stroke-width="1.1"/><circle cx="13" cy="13" r="2.3" fill="#ffffff"/></svg>`,
    pointerSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26" fill="none"><circle cx="13" cy="13" r="10" stroke="__ACCENT__" stroke-width="1.8"/><circle cx="13" cy="13" r="5" stroke="#ffffff" stroke-opacity="0.7" stroke-width="1.1"/><circle cx="13" cy="13" r="2.6" fill="__ACCENT__"/></svg>`,
  },
  {
    id: 'system',
    label: 'System Default',
    note: 'Standard native operating system pointer',
    hotspot: { x: 2, y: 2 },
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M5 3L18 12.5L11.8 13.8L9 19.5L5 3Z" fill="currentColor" opacity="0.85"/></svg>`,
    pointerSvg: '',
  },
];

function getThemeAccentHex() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return '#3b82f6';
  const raw = window.getComputedStyle(document.documentElement).getPropertyValue('--go').trim();
  return raw || '#3b82f6';
}

export function getCursorStyle() {
  try {
    const saved = localStorage.getItem(CURSOR_STORAGE_KEY);
    if (saved && CURSOR_STYLES.some((c) => c.id === saved)) return saved;
  } catch {}
  return 'precision';
}

export function applyCursorStyle(styleId = getCursorStyle()) {
  const chosen = CURSOR_STYLES.find((c) => c.id === styleId) || CURSOR_STYLES[0];
  if (typeof document === 'undefined') return chosen.id;

  const oldEl = document.getElementById('dp-pro-cursor');
  if (oldEl) oldEl.remove();

  const isFine = typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: fine)').matches
    && document.documentElement.dataset.device !== 'mobile';

  if (!isFine || chosen.id === 'system') {
    delete document.documentElement.dataset.cursor;
    document.documentElement.dataset.cursorStyle = 'system';
    document.documentElement.style.removeProperty('--dp-cursor-default');
    document.documentElement.style.removeProperty('--dp-cursor-pointer');
    return chosen.id;
  }

  const accent = getThemeAccentHex();
  const defSvg = chosen.svg.replaceAll('__ACCENT__', accent);
  const ptrSvg = (chosen.pointerSvg || chosen.svg).replaceAll('__ACCENT__', accent);

  document.documentElement.dataset.cursor = 'custom';
  document.documentElement.dataset.cursorStyle = chosen.id;
  document.documentElement.style.setProperty(
    '--dp-cursor-default',
    encodeSvgCursor(defSvg, chosen.hotspot.x, chosen.hotspot.y, 'auto')
  );
  document.documentElement.style.setProperty(
    '--dp-cursor-pointer',
    encodeSvgCursor(ptrSvg, chosen.hotspot.x, chosen.hotspot.y, 'pointer')
  );
  return chosen.id;
}

export function setCursorStyle(styleId) {
  const id = applyCursorStyle(styleId);
  try { localStorage.setItem(CURSOR_STORAGE_KEY, id); } catch {}
  return id;
}

export function installInteractivePhysics() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__driftpostPhysicsInstalled) return;

  const isFinePointer = typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: fine)').matches;
  if (!isFinePointer || document.documentElement.dataset.device === 'mobile') return;

  window.__driftpostPhysicsInstalled = true;

  // Apply hardware-composited SVG cursor immediately & keep accent synced with mood/theme
  applyCursorStyle(getCursorStyle());
  const themeObserver = new MutationObserver(() => {
    applyCursorStyle(getCursorStyle());
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-mood', 'data-theme'],
  });

  // Apple-style hold-and-nudge elastic drag state
  let heldEl = null;
  let startX = 0;
  let startY = 0;

  const releaseHeld = () => {
    if (!heldEl) return;
    const el = heldEl;
    heldEl = null;
    el.style.transition = 'transform 460ms cubic-bezier(0.22, 1.38, 0.36, 1)';
    el.style.transform = '';
    el.classList.remove('dp-holding');
    window.setTimeout(() => {
      if (el !== heldEl) el.style.transition = '';
    }, 470);
  };

  window.addEventListener('pointermove', (e) => {
    if (!heldEl || e.pointerType === 'touch') return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const clampX = Math.max(-12, Math.min(12, dx * 0.22));
    const clampY = Math.max(-10, Math.min(10, dy * 0.22));
    heldEl.style.transition = 'none';
    heldEl.style.transform = `translate3d(${clampX.toFixed(2)}px, ${clampY.toFixed(2)}px, 0) scale(0.985)`;
  }, { passive: true });

  window.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' || e.button !== 0) return;
    const targetEl = e.target && e.target.nodeType === 1 ? e.target : null;
    if (targetEl?.closest?.(TEXT_INPUT_SELECTOR) || targetEl?.closest?.(NATIVE_DRAG_IGNORE)) return;
    const target = targetEl?.closest?.(HOLD_SELECTOR);
    if (!target || target.disabled) return;
    heldEl = target;
    startX = e.clientX;
    startY = e.clientY;
    target.classList.add('dp-holding');
  }, { passive: true });

  window.addEventListener('pointerup', releaseHeld, { passive: true });
  window.addEventListener('pointercancel', releaseHeld, { passive: true });
  window.addEventListener('blur', releaseHeld);
}
