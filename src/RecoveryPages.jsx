import React, { useState } from 'react';
import './recovery.css';

function DriftpostLogo() {
  return <img src="/logo-dark-620.png" alt="Driftpost" width="620" height="160" />;
}

export function NotFoundPage({ onHome, onEnter }) {
  return <main className="recovery-page recovery-404">
    <header className="recovery-top"><a href="/" className="recovery-brand" onClick={(event) => { event.preventDefault(); onHome(); }}><DriftpostLogo /></a><span>ROUTE NOT FOUND</span></header>
    <section className="recovery-content">
      <div className="recovery-art" aria-hidden="true">
        <div className="recovery-orbit orbit-one" /><div className="recovery-orbit orbit-two" />
        <div className="recovery-postcard"><span className="postcard-line" /><span className="postcard-line short" /><span className="postcard-media"><i /></span><small>POST / LOST</small></div>
        <span className="recovery-star star-a">✳</span><span className="recovery-star star-b">·</span><span className="recovery-star star-c">✦</span>
        <b className="recovery-404-number">404</b>
      </div>
      <p className="recovery-kicker">A little off the feed</p>
      <h1>This page drifted<br />out of view.</h1>
      <p className="recovery-copy">That link doesn’t lead to a Driftpost page. Let’s get you back to the right place.</p>
      <div className="recovery-actions"><button className="recovery-primary" onClick={onHome}>Back to home <span aria-hidden="true">↗</span></button>{onEnter && <button className="recovery-secondary" onClick={onEnter}>Open my workspace</button>}</div>
    </section>
    <footer className="recovery-footer"><span>DRIFTPOST</span><span>Keep good things moving.</span></footer>
  </main>;
}

export function OfflinePage({ onRetry, checking }) {
  return <main className="recovery-page recovery-offline" role="alertdialog" aria-modal="true" aria-labelledby="offline-title">
    <header className="recovery-top"><span className="recovery-brand"><DriftpostLogo /></span><span>CONNECTION PAUSED</span></header>
    <section className="recovery-content">
      <div className="offline-art" aria-hidden="true"><div className="offline-signal"><i /><i /><i /><i /></div><span className="offline-cut">×</span><div className="offline-cloud"><i /><i /></div><div className="offline-ground" /></div>
      <p className="recovery-kicker">Your work is still here</p>
      <h1 id="offline-title">Looks like the<br />internet wandered off.</h1>
      <p className="recovery-copy">Driftpost needs a connection to sync your accounts and publish. Reconnect, then check again — this screen won’t erase your draft.</p>
      <button className="recovery-primary" onClick={onRetry} disabled={checking}>{checking ? 'Checking connection…' : 'Try again'} <span aria-hidden="true">↻</span></button>
      <p className="offline-tip"><span aria-hidden="true">✳</span> Drafts saved on this device stay available.</p>
    </section>
    <footer className="recovery-footer"><span>DRIFTPOST</span><span>We’ll be right here.</span></footer>
  </main>;
}

export function ServerStartingPage() {
  return <main className="recovery-page recovery-starting" role="status" aria-live="polite">
    <header className="recovery-top"><span className="recovery-brand"><DriftpostLogo /></span><span>WORKSPACE INITIALIZING</span></header>
    <section className="recovery-content">
      <p className="recovery-kicker">A fresh workspace is on its way</p>
      <h1>Driftpost is<br />getting ready.</h1>
      <p className="recovery-copy">We’re connecting to the publishing server. This usually takes a few seconds after an update or a quiet period. This page will move on as soon as it’s ready.</p>
      <div className="starting-progress" aria-label="Waiting for the Driftpost server"><i /></div>
      <p className="starting-caption"><span className="starting-live-dot" /> Warming up the workspace <span className="starting-dots">•••</span></p>
      <small className="starting-footnote">Keep this tab open — you’ll continue automatically.</small>
    </section>
    <footer className="recovery-footer"><span>DRIFTPOST</span><span>Good things take a moment.</span></footer>
  </main>;
}

export function useConnectivity() {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false);
  const [checking, setChecking] = useState(false);
  React.useEffect(() => {
    const onlineAgain = () => setOnline(true);
    const offlineNow = () => setOnline(false);
    window.addEventListener('online', onlineAgain);
    window.addEventListener('offline', offlineNow);
    return () => { window.removeEventListener('online', onlineAgain); window.removeEventListener('offline', offlineNow); };
  }, []);
  const retry = async () => {
    if (navigator.onLine === false) { setOnline(false); return; }
    setChecking(true);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5000);
    try {
      await fetch(`${window.location.origin}/favicon.ico?connectivity=${Date.now()}`, { cache: 'no-store', signal: controller.signal });
      setOnline(true);
    } catch { setOnline(false); }
    finally { window.clearTimeout(timeout); setChecking(false); }
  };
  return { online, checking, retry };
}

export function useServerReadiness(enabled, healthUrl) {
  const [ready, setReady] = useState(!enabled);
  React.useEffect(() => {
    if (!enabled) { setReady(true); return undefined; }
    let active = true;
    let pollTimer = 0;
    let revealTimer = 0;
    let controller = null;
    const openedAt = Date.now();
    setReady(false);
    const check = async () => {
      controller = new AbortController();
      const timeout = window.setTimeout(() => controller?.abort(), 7000);
      let isReady = false;
      try {
        const response = await fetch(healthUrl, { cache: 'no-store', signal: controller.signal });
        if (response.ok) {
          const payload = await response.json();
          isReady = payload?.ok === true;
        }
      } catch {}
      finally { window.clearTimeout(timeout); }
      if (!active) return;
      if (isReady) {
        const visibleFor = Date.now() - openedAt;
        if (visibleFor < 1_100) {
          setReady(false);
          revealTimer = window.setTimeout(() => { if (active) setReady(true); }, 1_100 - visibleFor);
        } else setReady(true);
      } else setReady(false);
      pollTimer = window.setTimeout(check, isReady ? 30_000 : 4_000);
    };
    void check();
    return () => { active = false; window.clearTimeout(pollTimer); window.clearTimeout(revealTimer); controller?.abort(); };
  }, [enabled, healthUrl]);
  return ready;
}
