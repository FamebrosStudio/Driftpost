import React, { useEffect, useRef } from 'react';
import { ReactLenis, useLenis } from 'lenis/react';
import gsap from 'gsap';
import 'lenis/dist/lenis.css';

function GsapScrollBridge() {
  const lenis = useLenis();

  useEffect(() => {
    if (!lenis) return undefined;
    const tick = (time) => lenis.raf(time * 1000);
    gsap.ticker.add(tick);
    return () => gsap.ticker.remove(tick);
  }, [lenis]);

  return null;
}

export default function ScrollExperience({ children }) {
  const rootRef = useRef(null);
  const reduceMotion = typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  if (reduceMotion) return children;

  return (
    <ReactLenis
      root
      ref={rootRef}
      options={{
        autoRaf: false,
        lerp: 0.085,
        smoothWheel: true,
        wheelMultiplier: 0.9,
        syncTouch: false,
        prevent: (node) => {
          if (node?.closest?.('[data-lenis-prevent]')) return true;
          if (!node || typeof window === 'undefined') return false;
          const overflowY = window.getComputedStyle(node).overflowY;
          return (overflowY === 'auto' || overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 1;
        },
      }}
    >
      <GsapScrollBridge />
      {children}
    </ReactLenis>
  );
}
