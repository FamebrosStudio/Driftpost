import React, { lazy, Suspense, useState } from 'react';
import ConnectPage from './connect/ConnectPage.jsx';
import StageOnePage from './stage1/StageOnePage.jsx';
import StageTwoPage from './stage2/StageTwoPage.jsx';
import StageThreePage from './stage3/StageThreePage.jsx';

const HistoryPage = lazy(() => import('./history/HistoryPage.jsx'));

// Console entry — Connect accounts → Stage 1 → 2 → 3, plus History.
// First-time users land on Connect; anyone already in the flow resumes
// exactly where they were (persisted, so refresh is safe).
function loadStage() {
  try {
    const s = localStorage.getItem('driftpost-stage');
    if (s === '1' || s === '2' || s === '3') return s;
    return 'connect';
  } catch { return 'connect'; }
}

export default function Console({ session, onSwitchAccount, onSignOut }) {
  void onSwitchAccount;
  const [stage, setStage] = useState(loadStage);
  const [view, setView] = useState('flow');
  const go = (n) => {
    setStage(n);
    try {
      if (n === 'connect') localStorage.removeItem('driftpost-stage');
      else localStorage.setItem('driftpost-stage', String(n));
    } catch {}
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
  if (stage === '3') {
    return <StageThreePage session={session} onBack={() => go(2)} onSignOut={onSignOut} onHistory={openHistory} onDone={() => go(1)} />;
  }
  if (stage === '2') {
    return <StageTwoPage session={session} onBack={() => go(1)} onSignOut={onSignOut} onHistory={openHistory} onNext={() => go(3)} />;
  }
  if (stage === '1') {
    return <StageOnePage session={session} onSignOut={onSignOut} onNext={() => go(2)} onHistory={openHistory} />;
  }
  return <ConnectPage session={session} onContinue={() => go(1)} onHistory={openHistory} onSignOut={onSignOut} />;
}
