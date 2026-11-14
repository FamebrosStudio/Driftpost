import { useEffect } from 'react';
import './cursor-glow.css';

// Cursor-close border glow, after the MagicBento technique:
// every tagged element gets a 1px masked ring overlay whose radial gradient
// sits at the cursor and whose alpha is gated by a "near" factor — the ring
// lights up only while the cursor is within NEAR_MARGIN of the element,
// like the Windows 10 window-border highlight. No hover styles involved.
const NEAR_MARGIN = 150;

export function useCursorGlow(selector) {
  useEffect(() => {
    let list = [];
    const scan = () => {
      list = [];
      document.querySelectorAll(selector).forEach((el) => {
        if (!el.hasAttribute('data-cursor-glow')) el.setAttribute('data-cursor-glow', '');
        list.push(el);
      });
    };
    scan();
    const mo = new MutationObserver(scan);
    mo.observe(document.body, { childList: true, subtree: true });

    let raf = 0;
    let px = -1e5;
    let py = -1e5;
    const tick = () => {
      raf = 0;
      for (const el of list) {
        const r = el.getBoundingClientRect();
        const near = px > r.left - NEAR_MARGIN && px < r.right + NEAR_MARGIN
          && py > r.top - NEAR_MARGIN && py < r.bottom + NEAR_MARGIN;
        el.style.setProperty('--cg-near', near ? '1' : '0');
        el.style.setProperty('--cg-x', `${(px - r.left).toFixed(1)}px`);
        el.style.setProperty('--cg-y', `${(py - r.top).toFixed(1)}px`);
      }
    };
    const schedule = () => { if (!raf) raf = requestAnimationFrame(tick); };
    const onMove = (e) => { px = e.clientX; py = e.clientY; schedule(); };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('scroll', schedule, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('scroll', schedule);
      mo.disconnect();
      if (raf) cancelAnimationFrame(raf);
      list.forEach((el) => el.removeAttribute('data-cursor-glow'));
    };
  }, [selector]);
}

export default function CursorGlow({ selector }) {
  useCursorGlow(selector);
  return null;
}
