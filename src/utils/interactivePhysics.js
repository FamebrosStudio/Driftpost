// Apple-style hold-and-nudge elastic physics + professional precision vector cursor (desktop pointer only).
const HOLD_SELECTOR = [
  '.ws-stat', '.ws-welcome', '.ws-create-mode-card', '.cn-card', '.hist-row',
  '.setup-card', '.ws-mood-card', '.feed-it-item', '.ws-panel',
  '.ws-primary', '.ws-secondary', '.ws-topnav-pill', '.ws-topbar-icon-btn',
  '.ws-wordmark', '.ws-user', '.continue-btn', '.s2-continue-btn', '.cn-next',
  '.s3-postall', '.s3-schedall', '.ws-route-stop',
].join(',');

const TEXT_INPUT_SELECTOR = 'input, textarea, select, option, [contenteditable="true"]';
const NATIVE_DRAG_IGNORE = '.crop-box, .crop-handle, .s2-resize-handle, .s2-rotate-handle, .s2-timeline-track, [draggable="true"]';

export function installInteractivePhysics() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__driftpostPhysicsInstalled) return;

  const isFinePointer = typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: fine)').matches;
  if (!isFinePointer || document.documentElement.dataset.device === 'mobile') return;

  window.__driftpostPhysicsInstalled = true;

  // 1. Professional precision SVG pointer cursor (not a dot)
  const cursorEl = document.createElement('div');
  cursorEl.id = 'dp-pro-cursor';
  cursorEl.setAttribute('aria-hidden', 'true');
  cursorEl.innerHTML = `
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
      <path d="M4.2 2.8L19.4 11.1L12.6 13.3L9.8 19.9L4.2 2.8Z" fill="#ffffff" stroke="#09090b" stroke-width="1.4" stroke-linejoin="round"/>
    </svg>
  `;
  document.body.appendChild(cursorEl);
  document.documentElement.dataset.cursor = 'custom';

  let cursorX = -100;
  let cursorY = -100;
  let cursorVisible = false;
  let rafId = 0;

  const renderCursor = () => {
    rafId = 0;
    cursorEl.style.transform = `translate3d(${cursorX}px, ${cursorY}px, 0)`;
    if (!cursorVisible) {
      cursorVisible = true;
      cursorEl.classList.add('is-visible');
    }
  };

  // 2. Hold-and-nudge elastic drag state
  let heldEl = null;
  let startX = 0;
  let startY = 0;
  let moved = false;

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
    if (e.pointerType === 'touch') return;
    cursorX = e.clientX;
    cursorY = e.clientY;
    if (!rafId) rafId = window.requestAnimationFrame(renderCursor);

    const overText = e.target?.closest?.(TEXT_INPUT_SELECTOR);
    cursorEl.classList.toggle('is-hidden', Boolean(overText));
    const overInteractive = !overText && Boolean(e.target?.closest?.('button, a, summary, [role="button"], [role="tab"], [role="menuitem"], .ws-wordmark, .s2-switch'));
    cursorEl.classList.toggle('is-pointer', overInteractive);

    if (heldEl) {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (Math.hypot(dx, dy) > 4) moved = true;
      const clampX = Math.max(-12, Math.min(12, dx * 0.22));
      const clampY = Math.max(-10, Math.min(10, dy * 0.22));
      heldEl.style.transition = 'none';
      heldEl.style.transform = `translate3d(${clampX.toFixed(2)}px, ${clampY.toFixed(2)}px, 0) scale(0.985)`;
    }
  }, { passive: true });

  window.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' || e.button !== 0) return;
    cursorEl.classList.add('is-down');
    if (e.target?.closest?.(TEXT_INPUT_SELECTOR) || e.target?.closest?.(NATIVE_DRAG_IGNORE)) return;
    const target = e.target?.closest?.(HOLD_SELECTOR);
    if (!target || target.disabled) return;
    heldEl = target;
    startX = e.clientX;
    startY = e.clientY;
    moved = false;
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

  document.addEventListener('pointerleave', () => {
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
