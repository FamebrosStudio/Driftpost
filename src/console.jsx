import React, { lazy, Suspense, useState } from 'react';
import ConnectPage from './connect/ConnectPage.jsx';
import StageOnePage from './stage1/StageOnePage.jsx';
import StageTwoPage from './stage2/StageTwoPage.jsx';
import StageThreePage from './stage3/StageThreePage.jsx';
import PageLoading from './PageLoading.jsx';
import { WorkspaceNav, DashboardPage, CalendarPage, AnalyticsPage } from './workspace/Workspace.jsx';
import AutomationsPage from './workspace/AutomationsPage.jsx';

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

function BackgroundPublishNotice({ notice, onDismiss }) {
  if (!notice) return null;
  const accounts = Object.entries(notice.accounts || {});
  return (
    <aside className="bg-publish-notice" role="status" aria-live="polite">
      <span className="bg-publish-notice__icon" aria-hidden="true">↗</span>
      <div>
        <div className="bg-publish-notice__heading">
          <strong>{notice.inProgress > 0 ? 'Publishing in background' : 'Background batch finished'}</strong>
          {notice.inProgress > 0 && <span className="bg-publish-live">LIVE</span>}
        </div>
        <p>{notice.inProgress > 0
          ? `${notice.inProgress} queued or publishing · ${notice.published} published · ${notice.failed} failed`
          : `${notice.published} published · ${notice.failed} failed`}</p>
        <div className="bg-publish-notice__accounts">
          {accounts.slice(0, 8).map(([key, post]) => (
            <div className="bg-publish-notice__account" key={key}>
              <div><span>{post.account || 'Account'}</span><small>{post.state === 'completed' ? 'Published' : post.state === 'failed' ? 'Failed' : post.state === 'queued' ? 'Queued' : post.message || 'Publishing'}</small></div>
              <div className="bg-publish-notice__track"><i style={{ width: `${Math.max(0, Math.min(100, Number(post.progress) || 0))}%` }} /></div>
            </div>
          ))}
          {accounts.length > 8 && <small>And {accounts.length - 8} more destinations…</small>}
        </div>
        {notice.accepted < notice.total && <small>Some destinations were not accepted; check their errors before retrying.</small>}
      </div>
      <button type="button" onClick={onDismiss} aria-label="Dismiss background publishing notice">×</button>
    </aside>
  );
}

export default function Console({ session, onSwitchAccount, onSignOut }) {
  void onSwitchAccount;
  const [stage, setStage] = useState(loadStage);
  const [view, setView] = useState('home');
  const [backgroundPublishNotice, setBackgroundPublishNotice] = useState(null);
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
  const withBackgroundNotice = (page) => <>{page}<BackgroundPublishNotice notice={backgroundPublishNotice} onDismiss={() => setBackgroundPublishNotice(null)} /></>;
  if (view === 'home') return withBackgroundNotice(<DashboardPage session={session} onNavigate={navigate} onCreate={() => navigate('create')} onSignOut={onSignOut} />);
  if (view === 'calendar') return withBackgroundNotice(<CalendarPage session={session} onNavigate={navigate} onCreate={(date) => {
    try { sessionStorage.setItem('driftpost-calendar-prefill', JSON.stringify({ date, createdAt: Date.now() })); } catch {}
    navigate('create');
  }} onSignOut={onSignOut} />);
  if (view === 'analytics') return withBackgroundNotice(<AnalyticsPage session={session} onNavigate={navigate} onSignOut={onSignOut} />);
  if (view === 'automations') return withBackgroundNotice(<AutomationsPage session={session} onNavigate={navigate} onSignOut={onSignOut} />);
  if (view === 'history') return withBackgroundNotice(
    <Suspense fallback={<PageLoading label="Loading History…" />}>
      <HistoryPage session={session} onNavigate={navigate} onSignOut={onSignOut} />
    </Suspense>
  );
  if (view === 'accounts') return withBackgroundNotice(<><WorkspaceNav page="accounts" onNavigate={navigate} email={session.user?.email} onSignOut={onSignOut} /><ConnectPage session={session} onContinue={() => navigate('create')} onHistory={openHistory} onSignOut={onSignOut} embedded /></>);
  if (stage === '3') {
    return withBackgroundNotice(<StageThreePage session={session} onBack={() => go(2)} onNavigate={navigate} onSignOut={onSignOut} onDone={(result) => {
      if (result?.backgroundPublish) setBackgroundPublishNotice(result.backgroundPublish);
      go(1);
    }} onBackgroundProgress={(progress) => setBackgroundPublishNotice((current) => current?.id === progress.id ? progress : current)} />);
  }
  if (stage === '2') {
    return withBackgroundNotice(<StageTwoPage session={session} onBack={() => go(1)} onNavigate={navigate} onSignOut={onSignOut} onNext={() => go(3)} />);
  }
  if (stage === '1') {
    return withBackgroundNotice(<StageOnePage session={session} onNext={() => go(2)} onNavigate={navigate} onSignOut={onSignOut} />);
  }
  return withBackgroundNotice(<ConnectPage session={session} onContinue={() => go(1)} onHistory={openHistory} onSignOut={onSignOut} />);
}
