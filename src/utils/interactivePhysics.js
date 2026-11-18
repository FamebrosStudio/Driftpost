// Driftpost hold-and-nudge elastic physics + hardware-composited SVG cursor system.
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

// Shared event-specific SVG builders themed to each cursor style's palette
function buildSharedEventSvgs(fill, stroke, accent) {
  return {
    text: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M8.5 4.5H15.5M8.5 19.5H15.5M12 4.5V19.5" stroke="${stroke}" stroke-width="2.6" stroke-linecap="round"/><path d="M8.5 4.5H15.5M8.5 19.5H15.5M12 4.5V19.5" stroke="${accent}" stroke-width="1.4" stroke-linecap="round"/></svg>`,
    grab: `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M8.5 11.5V6.5a1.25 1.25 0 0 1 2.5 0v4M11 10.5V5.5a1.25 1.25 0 0 1 2.5 0v5M13.5 10.5V6.5a1.25 1.25 0 0 1 2.5 0v5M16 11.5V8.5a1.25 1.25 0 0 1 2.5 0v5.5c0 3.4-2.4 6-5.8 6h-1.2c-2.5 0-4.4-1.3-5.6-3.5l-1.4-2.6a1.2 1.2 0 0 1 2-1.3L8.5 15v-3.5Z" fill="${fill}" stroke="${stroke}" stroke-width="1.4" stroke-linejoin="round"/></svg>`,
    grabbing: `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M7.5 12.5V9.5a1.25 1.25 0 0 1 2.5 0v1.5M10 11V8.5a1.25 1.25 0 0 1 2.5 0V11M12.5 11V8.5a1.25 1.25 0 0 1 2.5 0V11M15 11.5V9.5a1.25 1.25 0 0 1 2.5 0v4.5c0 3.2-2.2 5.5-5.3 5.5h-1.2c-2.3 0-4-1.2-5.1-3.2l-1-1.9a1.2 1.2 0 0 1 2-1.2l.6.7v-1.9Z" fill="${fill}" stroke="${accent}" stroke-width="1.5" stroke-linejoin="round"/></svg>`,
    notAllowed: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" fill="${fill}" stroke="#ef4444" stroke-width="1.8"/><path d="M6.6 17.4L17.4 6.6" stroke="#ef4444" stroke-width="1.8" stroke-linecap="round"/></svg>`,
    wait: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8.5" fill="${fill}" stroke="${stroke}" stroke-width="1.4"/><path d="M12 3.5A8.5 8.5 0 0 1 20.5 12" stroke="${accent}" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="12" r="2" fill="${accent}"/></svg>`,
    crosshair: `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26" fill="none"><path d="M13 3V9M13 17V23M3 13H9M17 13H23" stroke="${stroke}" stroke-width="2.6" stroke-linecap="round"/><path d="M13 3V9M13 17V23M3 13H9M17 13H23" stroke="${accent}" stroke-width="1.4" stroke-linecap="round"/><circle cx="13" cy="13" r="1.8" fill="${fill}" stroke="${stroke}" stroke-width="1"/></svg>`,
  };
}

export const CURSOR_STYLES = [
  {
    id: 'precision',
    label: 'Precision Vector',
    note: 'Razor-sharp white & obsidian pointer across every event state',
    hotspot: { x: 2, y: 2 },
    palette: { fill: '#ffffff', stroke: '#09090b' },
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M2.5 2.2L19.6 10.7L12.1 13.1L9.2 20.4L2.5 2.2Z" fill="#ffffff" stroke="#09090b" stroke-width="1.5" stroke-linejoin="round"/></svg>`,
    pointerSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M2.5 2.2L19.6 10.7L12.1 13.1L9.2 20.4L2.5 2.2Z" fill="#ffffff" stroke="__ACCENT__" stroke-width="1.75" stroke-linejoin="round"/></svg>`,
    activeSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M3.2 2.8L18.2 10.3L11.7 12.4L9.1 18.8L3.2 2.8Z" fill="__ACCENT__" stroke="#09090b" stroke-width="1.5" stroke-linejoin="round"/></svg>`,
  },
  {
    id: 'obsidian',
    label: 'Obsidian Blade',
    note: 'Stealth dark titanium dart with luminous accent core & states',
    hotspot: { x: 2, y: 2 },
    palette: { fill: '#0b0c10', stroke: '#e2e8f0' },
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M2.4 2.1L20.2 9.8L12.6 12.6L9.8 20.2L2.4 2.1Z" fill="#0b0c10" stroke="__ACCENT__" stroke-width="1.5" stroke-linejoin="round"/><path d="M5.6 5.3L14.5 9.3L10.8 10.8L9.3 14.5L5.6 5.3Z" fill="__ACCENT__" opacity="0.9"/></svg>`,
    pointerSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M2.4 2.1L20.2 9.8L12.6 12.6L9.8 20.2L2.4 2.1Z" fill="#0b0c10" stroke="#ffffff" stroke-width="1.5" stroke-linejoin="round"/><path d="M5.6 5.3L14.5 9.3L10.8 10.8L9.3 14.5L5.6 5.3Z" fill="__ACCENT__"/></svg>`,
    activeSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M3 2.7L18.6 9.5L12 12L9.5 18.6L3 2.7Z" fill="__ACCENT__" stroke="#ffffff" stroke-width="1.4" stroke-linejoin="round"/></svg>`,
  },
  {
    id: 'reticle',
    label: 'Reticle Pro',
    note: 'Aerospace crosshair that locks on hover, click, drag & crop',
    hotspot: { x: 13, y: 13 },
    palette: { fill: '#0b0c10', stroke: '#ffffff' },
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26" fill="none"><circle cx="13" cy="13" r="8.5" stroke="__ACCENT__" stroke-width="1.4" stroke-dasharray="3.5 2.5"/><path d="M13 2V6.5M13 19.5V24M2 13H6.5M19.5 13H24" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round"/><circle cx="13" cy="13" r="2" fill="__ACCENT__"/></svg>`,
    pointerSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26" fill="none"><circle cx="13" cy="13" r="9.5" stroke="__ACCENT__" stroke-width="1.7"/><path d="M4.5 4.5L8 8M21.5 4.5L18 8M4.5 21.5L8 18M21.5 21.5L18 18" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round"/><circle cx="13" cy="13" r="2.5" fill="#ffffff"/></svg>`,
    activeSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26" fill="none"><circle cx="13" cy="13" r="6.5" stroke="#ffffff" stroke-width="1.8"/><circle cx="13" cy="13" r="2.8" fill="__ACCENT__"/></svg>`,
  },
  {
    id: 'glass',
    label: 'Liquid Glass',
    note: 'Translucent frosted prism pointer with specular sheen',
    hotspot: { x: 2, y: 2 },
    palette: { fill: '#e2e8f0', stroke: '#0f172a' },
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none"><defs><linearGradient id="g1" x1="2" y1="2" x2="18" y2="20" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#ffffff" stop-opacity="0.94"/><stop offset="55%" stop-color="#cbd5e1" stop-opacity="0.58"/><stop offset="100%" stop-color="__ACCENT__" stop-opacity="0.78"/></linearGradient></defs><path d="M2.5 2.2L19.5 10.5L12.1 12.9L9.3 20.2L2.5 2.2Z" fill="url(#g1)" stroke="#ffffff" stroke-width="1.35" stroke-linejoin="round"/></svg>`,
    pointerSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24" fill="none"><defs><linearGradient id="g2" x1="2" y1="2" x2="18" y2="20" gradientUnits="userSpaceOnUse"><stop offset="0%" stop-color="#ffffff" stop-opacity="0.96"/><stop offset="100%" stop-color="__ACCENT__" stop-opacity="0.9"/></linearGradient></defs><path d="M2.5 2.2L19.5 10.5L12.1 12.9L9.3 20.2L2.5 2.2Z" fill="url(#g2)" stroke="__ACCENT__" stroke-width="1.5" stroke-linejoin="round"/></svg>`,
    activeSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"><path d="M3.2 2.8L18.2 10.3L11.7 12.4L9.1 18.8L3.2 2.8Z" fill="__ACCENT__" fill-opacity="0.88" stroke="#ffffff" stroke-width="1.4" stroke-linejoin="round"/></svg>`,
  },
  {
    id: 'halo',
    label: 'Aura Ring',
    note: 'Centered micro-needle inside a reactive kinetic halo',
    hotspot: { x: 13, y: 13 },
    palette: { fill: '#0f172a', stroke: '#ffffff' },
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26" fill="none"><circle cx="13" cy="13" r="9.5" stroke="#ffffff" stroke-opacity="0.86" stroke-width="1.4"/><circle cx="13" cy="13" r="5" stroke="__ACCENT__" stroke-opacity="0.55" stroke-width="1.1"/><circle cx="13" cy="13" r="2.3" fill="#ffffff"/></svg>`,
    pointerSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26" fill="none"><circle cx="13" cy="13" r="10" stroke="__ACCENT__" stroke-width="1.8"/><circle cx="13" cy="13" r="5" stroke="#ffffff" stroke-opacity="0.7" stroke-width="1.1"/><circle cx="13" cy="13" r="2.6" fill="__ACCENT__"/></svg>`,
    activeSvg: `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26" fill="none"><circle cx="13" cy="13" r="7" stroke="__ACCENT__" stroke-width="2"/><circle cx="13" cy="13" r="3" fill="#ffffff"/></svg>`,
  },
  {
    id: 'system',
    label: 'System Default',
    note: 'Standard native operating system pointer',
    hotspot: { x: 2, y: 2 },
    palette: { fill: '#ffffff', stroke: '#09090b' },
    svg: `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M5 3L18 12.5L11.8 13.8L9 19.5L5 3Z" fill="currentColor" opacity="0.85"/></svg>`,
    pointerSvg: '',
    activeSvg: '',
  },
];

const CURSOR_VAR_KEYS = [
  '--dp-cursor-default',
  '--dp-cursor-pointer',
  '--dp-cursor-active',
  '--dp-cursor-text',
  '--dp-cursor-grab',
  '--dp-cursor-grabbing',
  '--dp-cursor-not-allowed',
  '--dp-cursor-wait',
  '--dp-cursor-crosshair',
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

  const rootStyle = document.documentElement.style;
  if (!isFine || chosen.id === 'system') {
    delete document.documentElement.dataset.cursor;
    document.documentElement.dataset.cursorStyle = 'system';
    for (const k of CURSOR_VAR_KEYS) rootStyle.removeProperty(k);
    return chosen.id;
  }

  const accent = getThemeAccentHex();
  const defSvg = chosen.svg.replaceAll('__ACCENT__', accent);
  const ptrSvg = (chosen.pointerSvg || chosen.svg).replaceAll('__ACCENT__', accent);
  const actSvg = (chosen.activeSvg || chosen.pointerSvg || chosen.svg).replaceAll('__ACCENT__', accent);
  const shared = buildSharedEventSvgs(chosen.palette.fill, chosen.palette.stroke, accent);

  document.documentElement.dataset.cursor = 'custom';
  document.documentElement.dataset.cursorStyle = chosen.id;
  rootStyle.setProperty('--dp-cursor-default', encodeSvgCursor(defSvg, chosen.hotspot.x, chosen.hotspot.y, 'auto'));
  rootStyle.setProperty('--dp-cursor-pointer', encodeSvgCursor(ptrSvg, chosen.hotspot.x, chosen.hotspot.y, 'pointer'));
  rootStyle.setProperty('--dp-cursor-active', encodeSvgCursor(actSvg, chosen.hotspot.x, chosen.hotspot.y, 'pointer'));
  rootStyle.setProperty('--dp-cursor-text', encodeSvgCursor(shared.text, 12, 12, 'text'));
  rootStyle.setProperty('--dp-cursor-grab', encodeSvgCursor(shared.grab, 12, 12, 'grab'));
  rootStyle.setProperty('--dp-cursor-grabbing', encodeSvgCursor(shared.grabbing, 12, 12, 'grabbing'));
  rootStyle.setProperty('--dp-cursor-not-allowed', encodeSvgCursor(shared.notAllowed, 12, 12, 'not-allowed'));
  rootStyle.setProperty('--dp-cursor-wait', encodeSvgCursor(shared.wait, 12, 12, 'wait'));
  rootStyle.setProperty('--dp-cursor-crosshair', encodeSvgCursor(shared.crosshair, 13, 13, 'crosshair'));
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

  // Apply hardware-composited SVG cursors immediately & keep accent synced with mood/theme
  applyCursorStyle(getCursorStyle());
  const themeObserver = new MutationObserver(() => {
    applyCursorStyle(getCursorStyle());
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-mood', 'data-theme'],
  });

  // Apple-style hold-and-nudge elastic drag state + press/drag cursor states
  let heldEl = null;
  let startX = 0;
  let startY = 0;

  const releaseHeld = () => {
    document.documentElement.classList.remove('dp-is-pressing', 'dp-is-dragging');
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
    if (Math.hypot(dx, dy) > 4) document.documentElement.classList.add('dp-is-dragging');
    const clampX = Math.max(-12, Math.min(12, dx * 0.22));
    const clampY = Math.max(-10, Math.min(10, dy * 0.22));
    heldEl.style.transition = 'none';
    heldEl.style.transform = `translate3d(${clampX.toFixed(2)}px, ${clampY.toFixed(2)}px, 0) scale(0.985)`;
  }, { passive: true });

  window.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' || e.button !== 0) return;
    document.documentElement.classList.add('dp-is-pressing');
    const targetEl = e.target && e.target.nodeType === 1 ? e.target : null;
    if (
      document.documentElement.dataset.motion !== 'reduced'
      && document.documentElement.dataset.reducedMotion !== 'true'
      && targetEl?.closest?.('button, a, [role="button"], [role="tab"], [role="radio"], .ws-mood-card, .ws-cursor-card, .ws-topnav-pill')
    ) {
      const burst = document.createElement('span');
      burst.className = 'dp-click-burst';
      burst.style.left = `${e.clientX}px`;
      burst.style.top = `${e.clientY}px`;
      document.body.appendChild(burst);
      window.setTimeout(() => burst.remove(), 400);
    }
    if (targetEl?.closest?.(TEXT_INPUT_SELECTOR) || targetEl?.closest?.(NATIVE_DRAG_IGNORE)) return;
    // Never nudge/drag an outer card when the user is clicking a button, link, or dropdown inside it.
    const innerControl = targetEl?.closest?.('button, a, summary, [role="button"], .dp-collapse, .cn-acct, .cn-drop');
    const target = targetEl?.closest?.(HOLD_SELECTOR);
    if (!target || target.disabled) return;
    if (innerControl && innerControl !== target && target.contains(innerControl)) return;
    const glowWrapper = target.parentElement?.classList?.contains('border-glow-inner')
      ? target.closest('.border-glow-card')
      : null;
    heldEl = glowWrapper || target;
    startX = e.clientX;
    startY = e.clientY;
    heldEl.classList.add('dp-holding');
  }, { passive: true });

  window.addEventListener('pointerup', releaseHeld, { passive: true });
  window.addEventListener('pointercancel', releaseHeld, { passive: true });
  window.addEventListener('blur', releaseHeld);
}
