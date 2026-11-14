// Cursor-proximity edge glow for buttons (cards get the same math from the
// BorderGlow component's own pointer handlers). Sets --edge-proximity and
// --cursor-angle on tracked elements; CSS consumes them. No :hover rules.
const SELECTOR = '.ws-primary, .ws-secondary, .s2-continue-btn, .continue-btn, .skew-btn, .user-profile, .cn-next, .s1-btn, .s3-mini-btn, .ws-text-button, .ws-text-btn, .progress-step-button';

const proximity = (el, x, y) => {
  const w = el.offsetWidth / 2;
  const h = el.offsetHeight / 2;
  const dx = x - w;
  const dy = y - h;
  let kx = Infinity;
  let ky = Infinity;
  if (dx !== 0) kx = w / Math.abs(dx);
  if (dy !== 0) ky = h / Math.abs(dy);
  return Math.min(Math.max(1 / Math.min(kx, ky), 0), 1) * 100;
};

export const initGlowProximity = () => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const attach = (el) => {
    if (el.__glowTracked) return;
    el.__glowTracked = true;
    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      el.style.setProperty('--edge-proximity', proximity(el, x, y).toFixed(3));
      const dx = x - r.width / 2;
      const dy = y - r.height / 2;
      let angle = Math.atan2(dy, dx) * (180 / Math.PI) + 90;
      if (angle < 0) angle += 360;
      el.style.setProperty('--cursor-angle', `${angle.toFixed(3)}deg`);
    });
    el.addEventListener('pointerleave', () => {
      el.style.setProperty('--edge-proximity', '0');
    });
  };
  const scan = () => document.querySelectorAll(SELECTOR).forEach(attach);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scan, { once: true });
  } else {
    scan();
  }
  const mo = new MutationObserver(scan);
  mo.observe(document.documentElement, { childList: true, subtree: true });
};
