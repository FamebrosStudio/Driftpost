// Apple-style hold-and-nudge elastic physics + zero-lag pro cursor system (desktop pointer only).
const HOLD_SELECTOR = [
  '.ws-stat', '.ws-welcome', '.ws-create-mode-card', '.cn-card', '.hist-row',
  '.setup-card', '.ws-mood-card', '.feed-it-item', '.ws-panel',
  '.ws-primary', '.ws-secondary', '.ws-topnav-pill', '.ws-topbar-icon-btn',
  '.ws-wordmark', '.ws-user', '.continue-btn', '.s2-continue-btn', '.cn-next',
  '.s3-postall', '.s3-schedall', '.ws-route-stop',
].join(',');

const TEXT_INPUT_SELECTOR = 'input, textarea, select, option, [contenteditable="true"]';
const INTERACTIVE_SELECTOR = 'button, a, summary, [role="button"], [role="tab"], [role="menuitem"], [role="radio"], .ws-wordmark, .s2-switch';
const NATIVE_DRAG_IGNORE = '.crop-box, .crop-handle, .s2-resize-handle, .s2-rotate-handle, .s2-timeline-track, [draggable="true"]';
const CURSOR_STORAGE_KEY = 'driftpost-cursor-style';

export const CURSOR_STYLES = [
  {
    id: 'precision',
    label: 'Precision Vector',
    note: 'Razor-sharp white & obsidian pointer with adaptive accent edge',
    hotspot: { x: 2, y: 2 },
    svg: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path d="M2.5 2.2L19.6 10.7L12.1 13.1L9.2 20.4L2.5 2.2Z" fill="#ffffff" stroke="#09090b" stroke-width="1.5" stroke-linejoin="round"/>
    </svg>`,
  },
  {
    id: 'obsidian',
    label: 'Obsidian Blade',
    note: 'Stealth dark titanium dart with luminous accent core',
    hotspot: { x: 2, y: 2 },
    svg: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path d="M2.4 2.1L20.2 9.8L12.6 12.6L9.8 20.2L2.4 2.1Z" fill="#0b0c10" stroke="var(--go, #7dd3fc)" stroke-width="1.5" stroke-linejoin="round"/>
      <path d="M5.4 5.1L14.8 9.4L10.9 10.9L9.4 14.8L5.4 5.1Z" fill="var(--go, #7dd3fc)" opacity="0.9"/>
    </svg>`,
  },
  {
    id: 'reticle',
    label: 'Reticle Pro',
    note: 'Aerospace precision crosshair that locks onto interactive controls',
    hotspot: { x: 13, y: 13 },
    svg: `<svg width="26" height="26" viewBox="0 0 26 26" fill="none">
      <circle class="dp-cur-ring" cx="13" cy="13" r="8.5" stroke="var(--go, #7dd3fc)" stroke-width="1.4" stroke-dasharray="3.5 2.5"/>
      <path d="M13 2V6.5M13 19.5V24M2 13H6.5M19.5 13H24" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round"/>
      <circle cx="13" cy="13" r="2" fill="var(--go, #7dd3fc)"/>
    </svg>`,
  },
  {
    id: 'glass',
    label: 'Liquid Glass',
    note: 'Translucent Apple-style prism pointer with specular sheen',
    hotspot: { x: 2, y: 2 },
    svg: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none">
      <defs>
        <linearGradient id="dpGlassGrad" x1="2" y1="2" x2="18" y2="20" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#ffffff" stop-opacity="0.92"/>
          <stop offset="55%" stop-color="#e2e8f0" stop-opacity="0.52"/>
          <stop offset="100%" stop-color="var(--go, #7dd3fc)" stop-opacity="0.72"/>
        </linearGradient>
      </defs>
      <path d="M2.5 2.2L19.5 10.5L12.1 12.9L9.3 20.2L2.5 2.2Z" fill="url(#dpGlassGrad)" stroke="#ffffff" stroke-width="1.35" stroke-linejoin="round"/>
    </svg>`,
  },
  {
    id: 'halo',
    label: 'Aura Ring',
    note: 'Centered micro-needle inside a reactive kinetic halo',
    hotspot: { x: 13, y: 13 },
    svg: `<svg width="26" height="26" viewBox="0 0 26 26" fill="none">
      <circle class="dp-cur-ring" cx="13" cy="13" r="9.5" stroke="#ffffff" stroke-opacity="0.82" stroke-width="1.35"/>
      <circle cx="13" cy="13" r="5" stroke="var(--go, #7dd3fc)" stroke-opacity="0.45" stroke-width="1"/>
      <circle cx="13" cy="13" r="2.2" fill="#ffffff"/>
    </svg>`,
  },
  {
    id: 'system',
    label: 'System Default',
    note: 'Standard native operating system pointer',
    hotspot: { x: 2, y: 2 },
    svg: `<svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path d="M5 3L18 12.5L11.8 13.8L9 19.5L5 3Z" fill="currentColor" opacity="0.85"/>
    </svg>`,
  },
];

let activeCursorEl = null;
let currentCursorStyle = 'precision';

export function getCursorStyle() {
  try {
    const saved = localStorage.getItem(CURSOR_STORAGE_KEY);
    if (saved && CURSOR_STYLES.some((c) => c.id === saved)) return saved;
  } catch {}
  return 'precision';
}

export function applyCursorStyle(styleId) {
  const chosen = CURSOR_STYLES.find((c) => c.id === styleId) || CURSOR_STYLES[0];
  currentCursorStyle = chosen.id;
  if (typeof document === 'undefined') return chosen.id;

  const isFine = typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: fine)').matches
    && document.documentElement.dataset.device !== 'mobile';

  if (!isFine || chosen.id === 'system') {
    delete document.documentElement.dataset.cursor;
    document.documentElement.dataset.cursorStyle = 'system';
    if (activeCursorEl) {
      activeCursorEl.classList.remove('is-visible');
      activeCursorEl.style.display = 'none';
    }
    return chosen.id;
  }

  document.documentElement.dataset.cursor = 'custom';
  document.documentElement.dataset.cursorStyle = chosen.id;
  if (activeCursorEl) {
    activeCursorEl.style.display = '';
    activeCursorEl.dataset.style = chosen.id;
    activeCursorEl.style.marginLeft = `${-chosen.hotspot.x}px`;
    activeCursorEl.style.marginTop = `${-chosen.hotspot.y}px`;
    activeCursorEl.innerHTML = chosen.svg;
    const svg = activeCursorEl.querySelector('svg');
    if (svg) svg.style.transformOrigin = `${chosen.hotspot.x}px ${chosen.hotspot.y}px`;
  }
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

  // 1. Zero-lag pro cursor element
  const cursorEl = document.createElement('div');
  cursorEl.id = 'dp-pro-cursor';
  cursorEl.setAttribute('aria-hidden', 'true');
  document.body.appendChild(cursorEl);
  activeCursorEl = cursorEl;

  applyCursorStyle(getCursorStyle());

  let cursorVisible = false;
  let lastOverText = false;
  let lastOverInteractive = false;

  const moveCursorNow = (x, y) => {
    if (currentCursorStyle === 'system') return;
    cursorEl.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    if (!cursorVisible) {
      cursorVisible = true;
      cursorEl.classList.add('is-visible');
    }
  };

  // 2. Hold-and-nudge elastic drag state
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

  // Sub-frame hardware pointer updates when supported by browser
  if ('onpointerrawupdate' in window) {
    window.addEventListener('pointerrawupdate', (e) => {
      if (e.pointerType === 'touch' || currentCursorStyle === 'system') return;
      moveCursorNow(e.clientX, e.clientY);
    }, { passive: true });
  }

  window.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;

    if (currentCursorStyle !== 'system') {
      moveCursorNow(e.clientX, e.clientY);
      const targetEl = e.target && e.target.nodeType === 1 ? e.target : null;
      const overText = Boolean(targetEl?.closest?.(TEXT_INPUT_SELECTOR));
      if (overText !== lastOverText) {
        lastOverText = overText;
        cursorEl.classList.toggle('is-hidden', overText);
      }
      const overInteractive = !overText && Boolean(targetEl?.closest?.(INTERACTIVE_SELECTOR));
      if (overInteractive !== lastOverInteractive) {
        lastOverInteractive = overInteractive;
        cursorEl.classList.toggle('is-pointer', overInteractive);
      }
    }

    if (heldEl) {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const clampX = Math.max(-12, Math.min(12, dx * 0.22));
      const clampY = Math.max(-10, Math.min(10, dy * 0.22));
      heldEl.style.transition = 'none';
      heldEl.style.transform = `translate3d(${clampX.toFixed(2)}px, ${clampY.toFixed(2)}px, 0) scale(0.985)`;
    }
  }, { passive: true });

  window.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' || e.button !== 0) return;
    if (currentCursorStyle !== 'system') cursorEl.classList.add('is-down');
    const targetEl = e.target && e.target.nodeType === 1 ? e.target : null;
    if (targetEl?.closest?.(TEXT_INPUT_SELECTOR) || targetEl?.closest?.(NATIVE_DRAG_IGNORE)) return;
    const target = targetEl?.closest?.(HOLD_SELECTOR);
    if (!target || target.disabled) return;
    heldEl = target;
    startX = e.clientX;
    startY = e.clientY;
    target.classList.add('dp-holding');
  }, { passive: true });

  window.addEventListener('pointerup', () => {
    cursorEl.classList.remove('is-down');
    releaseHeld();
  }, { passive: true });

  window.addEventListener('pointercancel', () => {
    cursorEl.classList.remove('is-down');
    releaseHeld();
  }, { passive: true });

  document.addEventListener('mouseleave', () => {
    cursorVisible = false;
    cursorEl.classList.remove('is-visible', 'is-down');
    releaseHeld();
  });

  window.addEventListener('blur', () => {
    cursorVisible = false;
    cursorEl.classList.remove('is-visible', 'is-down');
    releaseHeld();
  });
}
