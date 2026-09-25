import React, { useEffect, useRef } from 'react';

// LiquidBg — console-only living background that recreates the uploaded
// magenta/purple/deep-blue swirl and feels liquid under the cursor.
// Why: makes the console feel premium + interactive without adding any
// buttons or steps (zero new-user confusion — it is purely decorative).
// What: fixed canvas behind .shell, 5 blurred blobs drift slowly and ease
// toward the pointer. Respects reduced-motion + pauses off-screen.
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
    const DPR = Math.min(1.5, window.devicePixelRatio || 1);

    const resize = () => {
      W = canvas.clientWidth || window.innerWidth;
      H = canvas.clientHeight || window.innerHeight;
      canvas.width = Math.round(W * DPR);
      canvas.height = Math.round(H * DPR);
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    // Blobs sampled from the reference image: hot magenta edges,
    // violet mid-ring, deep blue core, near-black center.
    const blobs = [
      { x: 0.06, y: 0.12, r: 0.42, c: '#d6007a', fx: 0.10, fy: 0.08, sp: 0.00022, ph: 0.0 },
      { x: 0.92, y: 0.08, r: 0.38, c: '#5b1bb5', fx: 0.14, fy: 0.10, sp: 0.00018, ph: 1.7 },
      { x: 0.50, y: 0.55, r: 0.46, c: '#1b1b6e', fx: 0.07, fy: 0.06, sp: 0.00014, ph: 3.1 },
      { x: 0.78, y: 0.88, r: 0.44, c: '#b0004d', fx: 0.12, fy: 0.09, sp: 0.00020, ph: 4.4 },
      { x: 0.15, y: 0.85, r: 0.36, c: '#2a0a5e', fx: 0.09, fy: 0.07, sp: 0.00016, ph: 5.6 },
    ];
    let mx = 0.5;
    let my = 0.4;
    let sx = mx;
    let sy = my;

    const onMove = (e) => {
      mx = Math.min(1, Math.max(0, e.clientX / window.innerWidth));
      my = Math.min(1, Math.max(0, e.clientY / window.innerHeight));
    };
    const onTouch = (e) => {
      const t = e.touches?.[0];
      if (t) onMove(t);
    };
    window.addEventListener('mousemove', onMove, { passive: true });
    window.addEventListener('touchmove', onTouch, { passive: true });

    const draw = (t) => {
      // Ease pointer — the lag is what reads as "liquid".
      sx += (mx - sx) * 0.045;
      sy += (my - sy) * 0.045;
      // Base: near-black plum so cards stay readable.
      ctx.fillStyle = '#07030f';
      ctx.fillRect(0, 0, W, H);
      ctx.globalCompositeOperation = 'lighter';
      for (const b of blobs) {
        const driftX = Math.sin(t * b.sp + b.ph) * 0.06;
        const driftY = Math.cos(t * b.sp * 1.3 + b.ph) * 0.06;
        const bx = (b.x + driftX + (sx - 0.5) * b.fx * 2) * W;
        const by = (b.y + driftY + (sy - 0.5) * b.fy * 2) * H;
        const br = b.r * Math.max(W, H);
        const g = ctx.createRadialGradient(bx, by, 0, bx, by, br);
        g.addColorStop(0, b.c);
        g.addColorStop(1, 'rgba(7,3,15,0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(bx, by, br, 0, Math.PI * 2);
        ctx.fill();
      }
      // Dark core vignette like the reference (keeps text contrast).
      ctx.globalCompositeOperation = 'source-over';
      const vg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, Math.max(W, H) * 0.75);
      vg.addColorStop(0, 'rgba(0,0,0,0.55)');
      vg.addColorStop(0.55, 'rgba(0,0,0,0.25)');
      vg.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);
    };

    if (reduced) {
      draw(0);
      return () => {
        window.removeEventListener('resize', resize);
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('touchmove', onTouch);
      };
    }

    let visible = true;
    const onVis = () => { visible = !document.hidden; };
    document.addEventListener('visibilitychange', onVis);
    const loop = (t) => {
      if (visible) draw(t || 0);
      raf = requestAnimationFrame(loop);
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
      <canvas ref={ref} />
    </div>
  );
}
