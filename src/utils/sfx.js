// Subtle, crisp Apple-inspired Web Audio API micro-SFX engine (zero external assets).
let audioCtx = null;
let lastClickAt = 0;

function getCtx() {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    try {
      audioCtx = new Ctx();
    } catch {
      return null;
    }
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

export function playSfx(kind = 'tap') {
  const ctx = getCtx();
  if (!ctx || ctx.state !== 'running') return;

  const now = ctx.currentTime;
  try {
    if (kind === 'tap') {
      // Crisp 18ms iOS glass tick
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1180, now);
      osc.frequency.exponentialRampToValueAtTime(520, now + 0.018);
      gain.gain.setValueAtTime(0.035, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.022);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.024);
      return;
    }

    if (kind === 'nav') {
      // Smooth dual-harmonic page switch pop
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(640, now);
      osc.frequency.exponentialRampToValueAtTime(920, now + 0.032);
      gain.gain.setValueAtTime(0.04, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.042);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.045);
      return;
    }

    if (kind === 'toggleOn' || kind === 'open') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(520, now);
      osc.frequency.exponentialRampToValueAtTime(880, now + 0.045);
      gain.gain.setValueAtTime(0.042, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.058);
      return;
    }

    if (kind === 'toggleOff' || kind === 'close') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(760, now);
      osc.frequency.exponentialRampToValueAtTime(420, now + 0.042);
      gain.gain.setValueAtTime(0.036, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.05);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.052);
      return;
    }

    if (kind === 'success') {
      // Clean two-note Apple chime
      [587.33, 880].forEach((freq, idx) => {
        const start = now + idx * 0.065;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.045, start);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(start);
        osc.stop(start + 0.17);
      });
      return;
    }

    if (kind === 'error') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(240, now);
      osc.frequency.exponentialRampToValueAtTime(140, now + 0.09);
      gain.gain.setValueAtTime(0.045, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.11);
    }
  } catch {}
}

export function installGlobalSfx() {
  if (typeof window === 'undefined' || window.__driftpostSfxInstalled) return;
  window.__driftpostSfxInstalled = true;

  const unlock = () => {
    getCtx();
  };
  window.addEventListener('pointerdown', unlock, { passive: true, capture: true });

  document.addEventListener('click', (e) => {
    const nowMs = performance.now();
    if (nowMs - lastClickAt < 45) return;

    const target = e.target?.closest?.('button, a, summary, [role="button"], [role="tab"], [role="menuitem"], .s2-switch, input[type="checkbox"], input[type="radio"]');
    if (!target || target.disabled) return;
    lastClickAt = nowMs;

    if (target.classList.contains('ws-topnav-pill') || target.classList.contains('ws-mobile-dock-btn') || target.classList.contains('ws-mobile-more-item')) {
      if (target.classList.contains('ws-mobile-dock-more')) {
        const expanded = target.getAttribute('aria-expanded') === 'true';
        playSfx(expanded ? 'close' : 'open');
      } else {
        playSfx('nav');
      }
      return;
    }

    if (target.classList.contains('s2-switch')) {
      playSfx(target.classList.contains('on') ? 'toggleOff' : 'toggleOn');
      return;
    }

    if (target.tagName === 'SUMMARY') {
      const details = target.closest('details');
      playSfx(details?.open ? 'close' : 'open');
      return;
    }

    if (target.classList.contains('ws-primary') || target.classList.contains('continue-btn') || target.classList.contains('s3-postall') || target.classList.contains('s2-ed-save')) {
      playSfx('success');
      return;
    }

    playSfx('tap');
  }, { passive: true, capture: true });
}
