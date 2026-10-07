import React, { forwardRef, useCallback, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { useGSAP } from '@gsap/react';

// Adapted from React Bits' FadeContent component (David HDev / React Bits).
// Kept intentionally small so page reveals remain opt-in and easy to maintain.
gsap.registerPlugin(ScrollTrigger, useGSAP);

const FadeContent = forwardRef(function FadeContent({
  as: Tag = 'div',
  className = '',
  children,
  distance = 22,
  duration = 0.72,
  delay = 0,
  threshold = 86,
  blur = false,
  animateOnScroll = true,
  ...props
}, forwardedRef) {
  const localRef = useRef(null);
  const setRef = useCallback((node) => {
    localRef.current = node;
    if (typeof forwardedRef === 'function') forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  }, [forwardedRef]);

  useGSAP(() => {
    const element = localRef.current;
    if (!element || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    gsap.fromTo(element,
      { autoAlpha: 0, y: distance, filter: blur ? 'blur(8px)' : 'blur(0px)' },
      {
        autoAlpha: 1,
        y: 0,
        filter: 'blur(0px)',
        duration,
        delay,
        ease: 'power3.out',
        clearProps: 'filter,transform',
        ...(animateOnScroll ? {
          scrollTrigger: { trigger: element, start: `top ${threshold}%`, once: true },
        } : {}),
      },
    );
  }, { scope: localRef, dependencies: [distance, duration, delay, threshold, blur, animateOnScroll], revertOnUpdate: true });

  return <Tag ref={setRef} className={className} {...props}>{children}</Tag>;
});

export default FadeContent;
