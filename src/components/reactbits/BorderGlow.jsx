'use client';

import { useRef, useEffect } from 'react';
import './BorderGlow.css';

function parseHSL(hslStr) {
  const match = String(hslStr || '').match(/([\d.]+)\s*([\d.]+)%?\s*([\d.]+)%?/);
  if (!match) return { h: 199, s: 95, l: 74 };
  return { h: parseFloat(match[1]), s: parseFloat(match[2]), l: parseFloat(match[3]) };
}

function buildGlowVars(glowColor, intensity) {
  const { h, s, l } = parseHSL(glowColor);
  const base = `${h}deg ${s}% ${l}%`;
  const opacities = [100, 60, 50, 40, 30, 20, 10];
  const keys = ['', '-60', '-50', '-40', '-30', '-20', '-10'];
  const vars = {};
  for (let i = 0; i < opacities.length; i++) {
    vars[`--glow-color${keys[i]}`] = `hsl(${base} / ${Math.min(opacities[i] * intensity, 100)}%)`;
  }
  return vars;
}

function isLightColor(color) {
  const value = String(color || '').trim().replace('#', '');
  if (!/^[\da-f]{3}([\da-f]{3})?$/i.test(value)) return false;
  const hex = value.length === 3 ? value.split('').map((char) => char + char).join('') : value;
  const red = parseInt(hex.slice(0, 2), 16);
  const green = parseInt(hex.slice(2, 4), 16);
  const blue = parseInt(hex.slice(4, 6), 16);
  return red * 0.2126 + green * 0.7152 + blue * 0.0722 > 180;
}

const BorderGlow = ({
  children,
  className = '',
  edgeSensitivity = 20,
  glowColor = '199 95 74',
  backgroundColor = '#0b111b',
  borderRadius = 0,
  glowRadius = 22,
  glowIntensity = 1.0,
  coneSpread = 25,
  animated = false,
  colors = ['#38bdf8', '#4dc3f7', '#a5ddfa'],
  fillOpacity = 0.14,
}) => {
  const cardRef = useRef(null);

  useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    card.style.setProperty('--edge-proximity', '0');

    const updateFromPoint = (clientX, clientY) => {
      const rect = card.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const dx = clientX < rect.left ? rect.left - clientX : clientX > rect.right ? clientX - rect.right : 0;
      const dy = clientY < rect.top ? rect.top - clientY : clientY > rect.bottom ? clientY - rect.bottom : 0;
      const outsideDist = Math.hypot(dx, dy);
      const x = clientX - rect.left;
      const y = clientY - rect.top;
      const insideDist = (dx === 0 && dy === 0) ? Math.min(x, y, rect.width - x, rect.height - y) : Infinity;
      const distToEdge = outsideDist > 0 ? outsideDist : insideDist;
      const range = 130;
      const proximity = Math.max(0, Math.min(1, 1 - distToEdge / range));

      if (proximity > 0) {
        card.style.setProperty('--cursor-x', `${x.toFixed(1)}px`);
        card.style.setProperty('--cursor-y', `${y.toFixed(1)}px`);
      }
      card.style.setProperty('--edge-proximity', `${(proximity * 100).toFixed(2)}`);
    };

    const onMove = (e) => {
      if (e.pointerType === 'touch' || document.documentElement.dataset.device === 'mobile') return;
      updateFromPoint(e.clientX, e.clientY);
    };
    const onLeave = () => card.style.setProperty('--edge-proximity', '0');

    window.addEventListener('pointermove', onMove, { passive: true });
    document.addEventListener('pointerleave', onLeave);
    return () => {
      window.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerleave', onLeave);
    };
  }, [animated]);

  const glowVars = buildGlowVars(glowColor, glowIntensity);
  const lightSurface = isLightColor(backgroundColor);
  const primaryAccent = (Array.isArray(colors) && colors[0]) || '#3b82f6';

  return (
    <div
      ref={cardRef}
      className={`border-glow-card${lightSurface ? ' border-glow-card--light' : ''} ${className}`.trim()}
      style={{
        '--card-bg': backgroundColor,
        '--edge-sensitivity': edgeSensitivity,
        '--border-radius': `${borderRadius}px`,
        '--glow-padding': `${glowRadius}px`,
        '--cone-spread': coneSpread,
        '--fill-opacity': fillOpacity,
        '--glow-accent': primaryAccent,
        ...glowVars,
      }}
    >
      <span className="edge-light" aria-hidden="true" />
      <div className="border-glow-inner">
        {children}
      </div>
    </div>
  );
};

export default BorderGlow;
