import React, { lazy, Suspense, useState } from 'react';
import StageOnePage from './stage1/StageOnePage.jsx';
import StageTwoPage from './stage2/StageTwoPage.jsx';

const HistoryPage = lazy(() => import('./history/HistoryPage.jsx'));

// Console entry — Stage 1 → Stage 2, plus the History page.
// Stage is persisted (refresh-safe); History is a separate view on top.
function loadStage() {
  try { return localStorage.getItem('driftpost-stage') === '2' ? 2 : 1; }
  catch { return 1; }
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
  if (stage === 2) {
    return <StageTwoPage session={session} onBack={() => go(1)} onSignOut={onSignOut} onHistory={openHistory} />;
  }
  return <StageOnePage session={session} onSignOut={onSignOut} onNext={() => go(2)} onHistory={openHistory} />;
}
