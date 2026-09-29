import React, { lazy, Suspense, useState } from 'react';
import ConnectPage from './connect/ConnectPage.jsx';
import StageOnePage from './stage1/StageOnePage.jsx';
import StageTwoPage from './stage2/StageTwoPage.jsx';
import StageThreePage from './stage3/StageThreePage.jsx';
import PageLoading from './PageLoading.jsx';
import { WorkspaceNav, DashboardPage, CalendarPage, AnalyticsPage } from './workspace/Workspace.jsx';

const HistoryPage = lazy(() => import('./history/HistoryPage.jsx'));

// Console entry — Overview, Calendar, Analytics and History surround the
// existing create flow. A draft stage is persisted so refresh stays safe.
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
  const [view, setView] = useState('home');
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
  const navigate = (next) => {
    try { window.scrollTo(0, 0); } catch {}
    if (next === 'create') {
      setView('create');
      if (stage === 'connect') go('1');
      return;
    }
    setView(next);
  };
  const openHistory = () => navigate('history');
  if (view === 'home') return <DashboardPage session={session} onNavigate={navigate} onCreate={() => navigate('create')} />;
  if (view === 'calendar') return <CalendarPage session={session} onNavigate={navigate} onCreate={() => navigate('create')} />;
  if (view === 'analytics') return <AnalyticsPage session={session} onNavigate={navigate} />;
  if (view === 'history') {
    return (
      <Suspense fallback={<PageLoading label="Loading History…" />}>
        <HistoryPage session={session} onBack={() => setView('home')} />
      </Suspense>
    );
  }
  if (view === 'accounts') return <><WorkspaceNav page="accounts" onNavigate={navigate} email={session.user?.email} /><ConnectPage session={session} onContinue={() => navigate('create')} onHistory={openHistory} onSignOut={onSignOut} /></>;
  if (stage === '3') {
    return <StageThreePage session={session} onBack={() => go(2)} onSignOut={onSignOut} onHistory={openHistory} onHome={() => setView('home')} onNavigate={navigate} onDone={() => go(1)} />;
  }
  if (stage === '2') {
    return <StageTwoPage session={session} onBack={() => go(1)} onSignOut={onSignOut} onHistory={openHistory} onHome={() => setView('home')} onNavigate={navigate} onNext={() => go(3)} />;
  }
  if (stage === '1') {
    return <StageOnePage session={session} onSignOut={onSignOut} onNext={() => go(2)} onHistory={openHistory} onHome={() => setView('home')} onNavigate={navigate} onBackAccounts={() => { go('connect'); setView('accounts'); }} />;
  }
  return <ConnectPage session={session} onContinue={() => go(1)} onHistory={openHistory} onSignOut={onSignOut} />;
}
