import React, { lazy, Suspense, useState } from 'react';
import StageOnePage from './stage1/StageOnePage.jsx';
import StageTwoPage from './stage2/StageTwoPage.jsx';
import StageThreePage from './stage3/StageThreePage.jsx';

const HistoryPage = lazy(() => import('./history/HistoryPage.jsx'));

// Console entry — Stage 1 → 2 → 3, plus the History page.
// Stage is persisted (refresh-safe); History is a separate view on top.
function loadStage() {
  try {
    const s = localStorage.getItem('driftpost-stage');
    return s === '2' || s === '3' ? Number(s) : 1;
  } catch { return 1; }
}

export default function Console({ session, onSwitchAccount, onSignOut }) {
  void onSwitchAccount;
  const [stage, setStage] = useState(loadStage);
  const [view, setView] = useState('flow');
  const go = (n) => {
    setStage(n);
    try { localStorage.setItem('driftpost-stage', String(n)); } catch {}
    try { window.scrollTo(0, 0); } catch {}
  };
  const openHistory = () => { try { window.scrollTo(0, 0); } catch {} setView('history'); };
  if (view === 'history') {
    return (
      <Suspense fallback={null}>
        <HistoryPage session={session} onBack={() => setView('flow')} />
      </Suspense>
    );
  }
  if (stage === 3) {
    return <StageThreePage session={session} onBack={() => go(2)} onSignOut={onSignOut} onHistory={openHistory} onDone={() => go(1)} />;
  }
  if (stage === 2) {
    return <StageTwoPage session={session} onBack={() => go(1)} onSignOut={onSignOut} onHistory={openHistory} onNext={() => go(3)} />;
  }
  return <StageOnePage session={session} onSignOut={onSignOut} onNext={() => go(2)} onHistory={openHistory} />;
}
