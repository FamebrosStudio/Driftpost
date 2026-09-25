import React, { useEffect, useRef } from 'react';

// LiquidBg — console-only living background sampled from the uploaded
// magenta / violet / deep-blue swirl. True liquid feel via a goo filter:
// solid blobs merge and split like fluid, and the cursor stirs them with
// repel + swirl + fling forces. Decorative only (aria-hidden, no pointer
// events) so new users get delight with zero extra steps or confusion.
export default function LiquidBg() {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    let W = 0;
    let H = 0;
    let raf = 0;
    const DPR = Math.min(1.25, window.devicePixelRatio || 1);

    const resize = () => {
      W = canvas.clientWidth || window.innerWidth;
      H = canvas.clientHeight || window.innerHeight;
      canvas.width = Math.max(1, Math.round(W * DPR));
      canvas.height = Math.max(1, Math.round(H * DPR));
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    const COLORS = ['#ff2d95', '#d6007a', '#8b2ff7', '#3b2fe0', '#b0004d', '#5b1bb5'];
    const N = 14;
    const blobs = Array.from({ length: N }, (_, i) => {
      const s = Math.max(W, H);
      return {
        x: Math.random() * W,
        y: Math.random() * H,
        vx: (Math.random() - 0.5) * 0.35,
        vy: (Math.random() - 0.5) * 0.35,
        r: s * (0.07 + Math.random() * 0.09),
        c: COLORS[i % COLORS.length],
        ph: Math.random() * Math.PI * 2,
        sp: 0.0004 + Math.random() * 0.0006,
      };
    });

    let mx = W / 2;
    let my = H / 2;
    let mvx = 0;
    let mvy = 0;
    let lastX = mx;
    let lastY = my;

    const onMove = (e) => {
      mx = e.clientX;
      my = e.clientY;
    };
    const onTouch = (e) => {
      const t = e.touches?.[0];
      if (t) { mx = t.clientX; my = t.clientY; }
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('touchmove', onTouch, { passive: true });

    const drawStatic = () => {
      ctx.clearRect(0, 0, W, H);
      for (const b of blobs) {
        ctx.fillStyle = b.c;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };

    if (reduced) {
      drawStatic();
      return () => {
        window.removeEventListener('resize', resize);
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('touchmove', onTouch);
      };
    }

    let visible = true;
    const onVis = () => { visible = !document.hidden; };
    document.addEventListener('visibilitychange', onVis);
    let last = performance.now();

    const loop = (t) => {
      raf = requestAnimationFrame(loop);
      if (!visible) return;
      const dt = Math.min(3, Math.max(0.5, (t - last) / 16.7));
      last = t;
      // Pointer velocity (fling) with decay.
      mvx += ((mx - lastX) * 0.12 - mvx) * 0.25;
      mvy += ((my - lastY) * 0.12 - mvy) * 0.25;
      lastX = mx;
      lastY = my;

      const R = Math.max(W, H) * 0.22;
      for (const b of blobs) {
        // Ambient current — slow liquid drift.
        b.vx += Math.sin(t * b.sp + b.ph) * 0.02 * dt;
        b.vy += Math.cos(t * b.sp * 1.3 + b.ph) * 0.02 * dt;
        // Cursor stir: repel + tangential swirl + fling.
        const dx = b.x - mx;
        const dy = b.y - my;
        const d = Math.hypot(dx, dy);
        if (d < R && d > 0.01) {
          const f = (1 - d / R) ** 2;
          const nx = dx / d;
          const ny = dy / d;
          b.vx += (nx * 2.4 + -ny * 1.5 + mvx * 0.35) * f * dt;
          b.vy += (ny * 2.4 + nx * 1.5 + mvy * 0.35) * f * dt;
        }
        // Damping + speed cap.
        b.vx *= 0.965;
        b.vy *= 0.965;
        const sp = Math.hypot(b.vx, b.vy);
        const max = 4.2;
        if (sp > max) { b.vx = (b.vx / sp) * max; b.vy = (b.vy / sp) * max; }
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        // Wrap with margin so the field never empties.
        const m = b.r * 0.6;
        if (b.x < -m) b.x = W + m;
        else if (b.x > W + m) b.x = -m;
        if (b.y < -m) b.y = H + m;
        else if (b.y > H + m) b.y = -m;
      }

      ctx.clearRect(0, 0, W, H);
      for (const b of blobs) {
        ctx.fillStyle = b.c;
        ctx.globalAlpha = 0.92;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('touchmove', onTouch);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  return (
    <div className="liquid-bg" aria-hidden="true">
      <div className="liquid-base" />
      <div className="liquid-goo">
        <canvas ref={ref} />
      </div>
      <div className="liquid-veil" />
      <svg width="0" height="0" style={{ position: 'absolute' }}>
        <defs>
          <filter id="drift-goo">
            <feGaussianBlur in="SourceGraphic" stdDeviation="28" result="blur" />
            <feColorMatrix in="blur" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 19 -9" result="goo" />
            <feComposite in="SourceGraphic" in2="goo" operator="atop" />
          </filter>
        </defs>
      </svg>
    </div>
  );
}
