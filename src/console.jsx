import React, { useState } from 'react';
import StageOnePage from './stage1/StageOnePage.jsx';
import StageTwoPage from './stage2/StageTwoPage.jsx';

// Console entry — Stage 1 → Stage 2. Later stages mount here when specified.
function loadStage() {
  try { return localStorage.getItem('driftpost-stage') === '2' ? 2 : 1; }
  catch { return 1; }
}

export default function Console({ session, onSwitchAccount, onSignOut }) {
  void onSwitchAccount;
  const [stage, setStage] = useState(loadStage);
  const go = (n) => {
    setStage(n);
    try { localStorage.setItem('driftpost-stage', String(n)); } catch {}
    try { window.scrollTo(0, 0); } catch {}
  };
  if (stage === 2) {
    return <StageTwoPage session={session} onBack={() => go(1)} onSignOut={onSignOut} />;
  }
  return <StageOnePage session={session} onSignOut={onSignOut} onNext={() => go(2)} />;
}
