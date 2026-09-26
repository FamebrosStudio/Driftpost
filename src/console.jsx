import React, { lazy, Suspense, useState } from 'react';
import ConnectPage from './connect/ConnectPage.jsx';
import WelcomePage from './connect/WelcomePage.jsx';
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

// First-run welcome flag. The key never existed before, so every existing
// browser sees the welcome screen exactly once, then never again.
const WELCOME_KEY = 'driftpost-welcome-v1';

export default function Console({ session, onSwitchAccount, onSignOut }) {
  void onSwitchAccount;
  const [stage, setStage] = useState(loadStage);
  const [view, setView] = useState('flow');
  const [welcomed, setWelcomed] = useState(() => {
    try { return localStorage.getItem(WELCOME_KEY) === '1'; } catch { return true; }
  });
  // Stages are strings everywhere ('connect' | '1' | '2' | '3') so the
  // state and localStorage can never drift apart on a number/string mismatch.
  const go = (next) => {
    const n = String(next);
    setStage(n);
    try {
      if (n === 'connect') localStorage.removeItem('driftpost-stage');
      else localStorage.setItem('driftpost-stage', n);
    } catch {}
    try { window.scrollTo(0, 0); } catch {}
  };
  const openHistory = () => { try { window.scrollTo(0, 0); } catch {} setView('history'); };
  // Dismiss the welcome forever. Continue also advances into Stage 1; Skip
  // leaves the saved stage alone so mid-flow users resume where they were.
  const doneWelcome = (next) => {
    try { localStorage.setItem(WELCOME_KEY, '1'); } catch {}
    setWelcomed(true);
    if (next) go(next);
  };
  if (view === 'history') {
    return (
      <Suspense fallback={null}>
        <HistoryPage session={session} onBack={() => setView('flow')} />
      </Suspense>
    );
  }
  if (!welcomed) {
    return <WelcomePage session={session} onHistory={openHistory} onSignOut={onSignOut} onContinue={() => doneWelcome('1')} onSkip={() => doneWelcome()} />;
  }
  if (stage === '3') {
    return <StageThreePage session={session} onBack={() => go(2)} onSignOut={onSignOut} onHistory={openHistory} onDone={() => go(1)} />;
  }
  if (stage === '2') {
    return <StageTwoPage session={session} onBack={() => go(1)} onSignOut={onSignOut} onHistory={openHistory} onNext={() => go(3)} />;
  }
  if (stage === '1') {
    return <StageOnePage session={session} onSignOut={onSignOut} onNext={() => go(2)} onHistory={openHistory} onBackAccounts={() => go('connect')} />;
  }
  return <ConnectPage session={session} onContinue={() => go(1)} onHistory={openHistory} onSignOut={onSignOut} />;
}
