import { useEffect, useState } from 'react';

export function detectDevice() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'desktop';

  const ua = navigator.userAgent || '';
  const platform = navigator.platform || '';
  const maxTouchPoints = Number(navigator.maxTouchPoints || 0);
  const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches;
  const fine = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: fine)').matches;

  const screenMin = Math.min(window.screen?.width || 1920, window.screen?.height || 1080);
  const screenMax = Math.max(window.screen?.width || 1920, window.screen?.height || 1080);

  // Explicit mobile UA or User-Agent Client Hints
  const uaMobile = navigator.userAgentData?.mobile === true;
  const isPhoneUa = /iPhone|iPod|Windows Phone|BlackBerry|Opera Mini|IEMobile/i.test(ua)
    || (/Android/i.test(ua) && /Mobile/i.test(ua));

  if (uaMobile || isPhoneUa) return 'mobile';

  // Explicit tablet UA (iPad, iPadOS desktop-mode MacIntel + touch, Android tablet)
  const isIpad = /iPad/i.test(ua) || (platform === 'MacIntel' && maxTouchPoints > 1);
  const isTabletUa = /Tablet|PlayBook|Silk/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua));
  if (isIpad || isTabletUa) return 'tablet';

  // Fallback for touch-only devices without standard UA strings (never triggers on desktop mouse/trackpad)
  if (coarse && !fine) {
    if (screenMin < 600 && screenMax < 960) return 'mobile';
    if (screenMin <= 1024) return 'tablet';
  }

  return 'desktop';
}

export function applyDeviceAttributes() {
  if (typeof document === 'undefined') return 'desktop';
  const device = detectDevice();
  const coarse = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    && window.matchMedia('(pointer: coarse)').matches;
  document.documentElement.dataset.device = device;
  document.documentElement.dataset.input = coarse ? 'touch' : 'pointer';
  return device;
}

export function useDevice() {
  const [device, setDevice] = useState(() => applyDeviceAttributes());

  useEffect(() => {
    const sync = () => setDevice(applyDeviceAttributes());
    sync();
    window.addEventListener('orientationchange', sync);
    const mq = typeof window.matchMedia === 'function' ? window.matchMedia('(pointer: coarse)') : null;
    mq?.addEventListener?.('change', sync);
    return () => {
      window.removeEventListener('orientationchange', sync);
      mq?.removeEventListener?.('change', sync);
    };
  }, []);

  return device;
}
