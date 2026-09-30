import React, { useEffect, useMemo, useState } from 'react';
import BrandIcon from '../brand.jsx';
import { api, listSchedules, cancelSchedule, PLATFORMS } from '../lib.js';
import { readPostLog } from '../history/log.js';
import './workspace.css';

const NAV = [
  ['home', 'Overview', 'home'], ['create', 'Create post', 'plus'], ['calendar', 'Calendar', 'calendar'],
  ['analytics', 'Analytics', 'chart'], ['automations', 'Auto DM', 'sparkles'], ['history', 'History', 'clock'], ['accounts', 'Accounts', 'users'],
];
const platformName = (id) => PLATFORMS.find((p) => p.id === id)?.name || id;
const greetingName = (email) => (email || '').split('@')[0].split(/[._-]/)[0] || 'there';
const localIso = (date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

function Icon({ name, size = 16 }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };
  const shapes = {
    home: <><path d="m3 10 9-7 9 7"/><path d="M5 9v11h14V9M9 20v-6h6v6"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    calendar: <><rect x="3.5" y="5" width="17" height="16" rx="1.5"/><path d="M7.5 3v4M16.5 3v4M3.5 10h17M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01"/></>,
    chart: <><path d="M4 19V5M4 19h17"/><path d="m7 15 4-4 3 2 6-7"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></>,
    users: <><circle cx="9" cy="8" r="3"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0M16 5.5a3 3 0 0 1 0 5.8M17 14a5 5 0 0 1 3.5 4.8"/></>,
    arrowRight: <><path d="M4 12h15M13 6l6 6-6 6"/></>,
    arrowLeft: <><path d="M20 12H5M11 6l-6 6 6 6"/></>,
    sparkles: <><path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z"/><path d="m19 14 .9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14ZM5 3l.7 1.8L7.5 5.5l-1.8.7L5 8l-.7-1.8-1.8-.7 1.8-.7L5 3Z"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...common}>{shapes[name] || shapes.sparkles}</svg>;
}

export function WorkspaceNav({ page, onNavigate, email, onSignOut }) {
  return <header className="ws-topbar">
    <button type="button" className="ws-wordmark" onClick={() => onNavigate('home')} aria-label="Driftpost overview">
      <img className="logo-img logo-d" src="/logo-dark-620.png" srcSet="/logo-dark-620.png 620w, /logo-dark.png 1984w" sizes="168px" width="1984" height="512" decoding="async" alt="Driftpost" />
      <img className="logo-img logo-l" src="/logo-light.png" width="1908" height="512" decoding="async" alt="Driftpost" />
    </button>
    <nav className="ws-nav" aria-label="Main navigation">
      {NAV.map(([id, label, icon]) => <button key={id} type="button" className={page === id ? 'active' : ''} onClick={() => onNavigate(id)}><span><Icon name={icon} size={16} /></span>{label}</button>)}
    </nav>
    <div className="ws-user"><span className="ws-user-dot">{(email || 'U')[0].toUpperCase()}</span><span>{email || 'Workspace'}</span>{onSignOut && <button type="button" className="ws-signout" onClick={onSignOut}>Sign out</button>}</div>
  </header>;
}

function PageFrame({ page, onNavigate, email, onSignOut, eyebrow, title, intro, children, action }) {
  return <div className="ws"><WorkspaceNav page={page} onNavigate={onNavigate} email={email} onSignOut={onSignOut} />
    <main className="ws-main"><div className="ws-heading"><div><span className="ws-eyebrow">{eyebrow}</span><h1>{title}</h1>{intro && <p>{intro}</p>}</div>{action && <div className="ws-heading-action">{action}</div>}</div>{children}</main>
  </div>;
}

function PlatformBars({ posts }) {
  const counts = PLATFORMS.map((p) => ({ ...p, count: posts.reduce((n, post) => n + (Array.isArray(post.publishedPosts) && post.publishedPosts.length ? post.publishedPosts.filter((x) => x.platform === p.id).length : post.platform === p.id ? 1 : 0), 0) }));
  const max = Math.max(1, ...counts.map((p) => p.count));
  return <div className="ws-platform-bars">{counts.map((p) => <div className="ws-platform-row" key={p.id}>
    <span className="ws-platform-label"><BrandIcon id={p.id} size={15} />{p.name}</span><span className="ws-bar"><i style={{ width: `${p.count / max * 100}%` }} /></span><b>{p.count}</b>
  </div>)}</div>;
}

export function DashboardPage({ session, onNavigate, onCreate, onSignOut }) {
  const [connections, setConnections] = useState(null);
  const [schedules, setSchedules] = useState(null);
  useEffect(() => {
    let active = true;
    api('/api/connections', session.access_token)
      .then((data) => { if (active) setConnections(data.connections || []); })
      .catch(() => { if (active) setConnections([]); });
    listSchedules(session.access_token, { from: new Date().toISOString() })
      .then((data) => { if (active) setSchedules(data); })
      .catch(() => { if (active) setSchedules([]); });
    return () => { active = false; };
  }, [session.access_token]);
  const posts = useMemo(readPostLog, []);
  const upcoming = (schedules || []).filter((s) => s.status === 'scheduled').slice(0, 4);
  return <PageFrame page="home" onNavigate={onNavigate} email={session.user?.email} onSignOut={onSignOut} eyebrow="Your workspace" title={`Good to see you, ${greetingName(session.user?.email)}.`} intro="A clear view of what’s going out and what needs your attention.">
    <section className="ws-welcome"><div><span className="ws-eyebrow">Publishing workspace</span><h2>Make room for the work.</h2><p>Plan your next post, pick a client, and publish across your connected channels.</p><button className="ws-primary" onClick={onCreate}>Start a post <Icon name="arrowRight" size={15} /></button></div><div className="ws-welcome-art" aria-hidden="true"><span><Icon name="sparkles" size={72} /></span><i /><b /></div></section>
    <div className="ws-stat-grid">
      <article className="ws-stat"><span>Connected accounts</span><strong>{connections === null ? '—' : connections.length}</strong><small>{connections?.length ? 'Ready to publish' : 'Connect your first channel'}</small><button onClick={() => onNavigate('accounts')}>Manage accounts <Icon name="arrowRight" size={13} /></button></article>
      <article className="ws-stat"><span>Scheduled posts</span><strong>{schedules === null ? '—' : schedules.filter((s) => s.status === 'scheduled').length}</strong><small>Waiting in your calendar</small><button onClick={() => onNavigate('calendar')}>Open calendar <Icon name="arrowRight" size={13} /></button></article>
      <article className="ws-stat"><span>Posts in this browser</span><strong>{posts.length}</strong><small>Saved publishing history</small><button onClick={() => onNavigate('analytics')}>View analytics <Icon name="arrowRight" size={13} /></button></article>
    </div>
    <div className="ws-dashboard-grid">
      <section className="ws-panel"><div className="ws-panel-head"><div><span className="ws-eyebrow">Coming up</span><h2>Next on your calendar</h2></div><button className="ws-text-button" onClick={() => onNavigate('calendar')}>View calendar <Icon name="arrowRight" size={13} /></button></div>
        {upcoming.length ? <div className="ws-upcoming">{upcoming.map((item) => <div className="ws-upcoming-row" key={item.id}><span className="ws-icon"><BrandIcon id={item.platform} size={17} /></span><div><b>{platformName(item.platform)}</b><small>{item.body?.text || item.body?.caption || 'Scheduled post'}</small></div><time>{new Date(item.scheduled_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}<small>{new Date(item.scheduled_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</small></time></div>)}</div> : <div className="ws-empty"><span><Icon name="calendar" size={22} /></span><b>No upcoming posts</b><small>Your next scheduled post will show up here.</small><button onClick={() => onNavigate('calendar')}>Plan a post <Icon name="arrowRight" size={13} /></button></div>}
      </section>
    </div>
    <footer className="ws-footnote">Your publishing details stay in your account. Overview metrics reflect the post history saved in this browser.</footer>
  </PageFrame>;
}

export function CalendarPage({ session, onNavigate, onCreate, onSignOut }) {
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState('');
  const [selected, setSelected] = useState(() => localIso(new Date()));
  const startDay = new Date(month.getFullYear(), month.getMonth(), 1);
  const gridStart = new Date(startDay); gridStart.setDate(1 - startDay.getDay());
  const gridEnd = new Date(gridStart); gridEnd.setDate(gridStart.getDate() + 42);
  useEffect(() => {
    let active = true; setLoading(true); setNotice('');
    listSchedules(session.access_token, { from: gridStart.toISOString(), to: gridEnd.toISOString() })
      .then((data) => { if (active) setRows(data); })
      .catch((err) => { if (active) setNotice(err.message || 'Could not load your calendar.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [session.access_token, month.getFullYear(), month.getMonth()]);
  const byDate = useMemo(() => rows.reduce((map, row) => { const key = localIso(new Date(row.scheduled_at)); (map[key] ||= []).push(row); return map; }, {}), [rows]);
  const dates = Array.from({ length: 42 }, (_, i) => { const d = new Date(gridStart); d.setDate(gridStart.getDate() + i); return d; });
  const dayRows = byDate[selected] || [];
  const changeMonth = (delta) => { const next = new Date(month.getFullYear(), month.getMonth() + delta, 1); setMonth(next); setSelected(localIso(next)); };
  const cancel = async (id) => { setBusy(id); try { await cancelSchedule(session.access_token, id); setRows((old) => old.filter((r) => r.id !== id)); setNotice('Scheduled post cancelled.'); } catch (e) { setNotice(e.message || 'Could not cancel this post.'); } finally { setBusy(''); } };
  return <PageFrame page="calendar" onNavigate={onNavigate} email={session.user?.email} onSignOut={onSignOut} eyebrow="Plan ahead" title="Calendar" intro="See what’s scheduled and keep your publishing rhythm in view." action={<button className="ws-primary" onClick={() => onCreate(selected)}><Icon name="plus" size={15} /> Create for selected day</button>}>
    <section className="ws-panel ws-calendar-panel"><div className="ws-calendar-toolbar"><div><h2>{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2><span className="ws-legend"><i /> Scheduled</span></div><div className="ws-month-actions"><button aria-label="Previous month" onClick={() => changeMonth(-1)}><Icon name="arrowLeft" size={15} /></button><button onClick={() => { const now = new Date(); setMonth(new Date(now.getFullYear(), now.getMonth(), 1)); setSelected(localIso(now)); }}>Today</button><button aria-label="Next month" onClick={() => changeMonth(1)}><Icon name="arrowRight" size={15} /></button></div></div>
      <div className="ws-calendar-grid ws-weekdays">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <span key={d}>{d}</span>)}</div>
      <div className="ws-calendar-grid ws-days">{dates.map((date) => { const key = localIso(date); const items = byDate[key] || []; const today = key === localIso(new Date()); return <button key={key} className={`ws-day ${date.getMonth() === month.getMonth() ? '' : 'outside'} ${selected === key ? 'selected' : ''} ${today ? 'today' : ''}`} onClick={() => setSelected(key)}><span className="ws-day-number">{date.getDate()}</span>{items.slice(0, 2).map((item) => <span className={`ws-event ${item.status}`} key={item.id}><BrandIcon id={item.platform} size={12} /><b>{platformName(item.platform)}</b></span>)}{items.length > 2 && <small className="ws-more">+{items.length - 2} more</small>}</button>; })}</div>
      {loading && <div className="ws-inline-state">Loading schedule…</div>}{notice && <div className="ws-inline-state" role="status">{notice}</div>}
    </section>
    <section className="ws-panel ws-day-panel"><div className="ws-panel-head"><div><span className="ws-eyebrow">Selected day</span><h2>{new Date(`${selected}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</h2></div><button className="ws-secondary" onClick={() => onCreate(selected)}><Icon name="plus" size={14} /> Plan for this day</button></div>
      {!dayRows.length ? <div className="ws-empty compact"><b>{loading ? 'Checking your schedule…' : 'Nothing planned for this day'}</b><small>Choose another date or create a post to get started.</small></div> : <div className="ws-upcoming">{dayRows.map((row) => { const needsApproval = row.body?.approval_status === 'pending'; return <div className="ws-upcoming-row" key={row.id}><span className="ws-icon"><BrandIcon id={row.platform} size={17} /></span><div><b>{platformName(row.platform)} <em className={`ws-status ${needsApproval ? 'approval-needed' : row.status}`}>{needsApproval ? 'Needs approval' : row.status}</em></b><small>{row.body?.text || row.body?.caption || 'Scheduled post'}</small></div><time>{new Date(row.scheduled_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</time>{['scheduled', 'publishing'].includes(row.status) && <button className="ws-cancel" disabled={busy === row.id} onClick={() => cancel(row.id)}>{busy === row.id ? '…' : 'Cancel'}</button>}</div>; })}</div>}
    </section>
    <footer className="ws-footnote">Scheduled posts publish automatically at the selected time. Past, failed, and cancelled items remain available in History.</footer>
  </PageFrame>;
}

export function AnalyticsPage({ session, onNavigate, onSignOut }) {
  const posts = useMemo(() => readPostLog().filter((p) => p && Number.isFinite(Number(p.at))).sort((a, b) => Number(b.at) - Number(a.at)), []);
  const [schedules, setSchedules] = useState([]);
  const [accountMetrics, setAccountMetrics] = useState([]);
  const [metricsBusy, setMetricsBusy] = useState(true);
  const [metricsError, setMetricsError] = useState('');
  const [metricsRefresh, setMetricsRefresh] = useState(0);
  useEffect(() => { let active = true; listSchedules(session.access_token, { from: new Date().toISOString() }).then((data) => { if (active) setSchedules(data); }).catch(() => {}); return () => { active = false; }; }, [session.access_token]);
  useEffect(() => {
    let active = true;
    setMetricsBusy(true); setMetricsError('');
    api('/api/analytics/accounts', session.access_token)
      .then((data) => { if (active) setAccountMetrics(data.accounts || []); })
      .catch((e) => { if (active) setMetricsError(e.message || 'Could not load live account metrics.'); })
      .finally(() => { if (active) setMetricsBusy(false); });
    return () => { active = false; };
  }, [session.access_token, metricsRefresh]);
  const now = new Date(); const weekStart = new Date(now); weekStart.setDate(now.getDate() - 6); weekStart.setHours(0, 0, 0, 0);
  const thisWeek = posts.filter((p) => Number(p.at) >= weekStart.getTime()).length;
  const scheduled = schedules.filter((p) => p.status === 'scheduled').length;
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const monthPosts = posts.filter((p) => Number(p.at) >= monthStart);
  const activeDays = new Set(monthPosts.map((p) => new Date(Number(p.at)).toDateString())).size;
  const chart = Array.from({ length: 7 }, (_, i) => { const d = new Date(weekStart); d.setDate(weekStart.getDate() + i); const next = new Date(d); next.setDate(d.getDate() + 1); return { date: d, count: posts.filter((p) => Number(p.at) >= d.getTime() && Number(p.at) < next.getTime()).length }; });
  const max = Math.max(1, ...chart.map((d) => d.count));
  return <PageFrame page="analytics" onNavigate={onNavigate} email={session.user?.email} onSignOut={onSignOut} eyebrow="Understand your cadence" title="Analytics" intro="Live account totals alongside your publishing activity." action={<div className="ws-analytics-actions"><button className="ws-secondary" disabled={metricsBusy} onClick={() => setMetricsRefresh((n) => n + 1)}>{metricsBusy ? 'Refreshing…' : 'Refresh metrics'}</button><button className="ws-secondary" onClick={() => onNavigate('history')}>View history <Icon name="arrowRight" size={13} /></button></div>}>
    <section className="ws-panel ws-live-panel"><div className="ws-panel-head"><div><span className="ws-eyebrow">Connected channels</span><h2>Account performance</h2></div><span className="ws-live-caption">Live from each platform</span></div>
      {metricsBusy ? <div className="ws-inline-state">Loading account metrics…</div> : metricsError ? <div className="ws-inline-state" role="alert">{metricsError}</div> : !accountMetrics.length ? <div className="ws-empty compact"><b>No connected accounts yet</b><small>Connect a channel to see its available account metrics.</small></div> : <div className="ws-metric-grid">{accountMetrics.map((account) => <article className="ws-metric-card" key={account.id}><div className="ws-metric-heading"><span className="ws-icon"><BrandIcon id={account.platform} size={17} /></span><div><b>{platformName(account.platform)}</b><small>{account.name}</small></div></div>{account.error ? <p className="ws-metric-error" title={account.error}>Metrics unavailable: {account.error}</p> : <div className="ws-metric-values">{Object.entries(account.metrics || {}).filter(([, value]) => value != null).map(([key, value]) => <span key={key}><b>{Number(value).toLocaleString()}</b><small>{({ followers: 'Followers', following: 'Following', subscribers: 'Subscribers', views: 'Lifetime views', posts: account.platform === 'youtube' ? 'Videos' : 'Posts' })[key] || key}</small></span>)}</div>}</article>)}</div>}
    </section>
    <div className="ws-stat-grid ws-analytics-stats"><article className="ws-stat"><span>Published this month</span><strong>{monthPosts.length}</strong><small>Posts recorded in this browser</small></article><article className="ws-stat"><span>Last 7 days</span><strong>{thisWeek}</strong><small>Published across your channels</small></article><article className="ws-stat"><span>Scheduled next</span><strong>{scheduled}</strong><small>Posts waiting to publish</small></article><article className="ws-stat"><span>Active publishing days</span><strong>{activeDays}</strong><small>Days with a saved post</small></article></div>
    <div className="ws-two-col ws-analytics-grid"><section className="ws-panel"><div className="ws-panel-head"><div><span className="ws-eyebrow">Recent activity</span><h2>Posts over the last 7 days</h2></div></div><div className="ws-chart" role="img" aria-label="Number of saved published posts per day for the last seven days">{chart.map((d) => <div className="ws-chart-day" key={d.date.toISOString()}><div className="ws-chart-track"><i style={{ height: `${Math.max(d.count ? 10 : 3, d.count / max * 100)}%` }} title={`${d.count} posts`} /></div><b>{d.count}</b><small>{d.date.toLocaleDateString(undefined, { weekday: 'short' })}</small></div>)}</div></section>
      <section className="ws-panel"><div className="ws-panel-head"><div><span className="ws-eyebrow">Channel mix</span><h2>Publishing by platform</h2></div></div><PlatformBars posts={posts} /></section>
    </div>
    <section className="ws-panel ws-insight"><span className="ws-insight-mark"><Icon name="sparkles" /></span><div><b>Activity, kept simple</b><p>These numbers summarize posts saved in this browser’s History. They show publishing cadence, not views, reach, or engagement from social networks.</p></div><button className="ws-text-button" onClick={() => onNavigate('history')}>Open history <Icon name="arrowRight" size={13} /></button></section>
    <footer className="ws-footnote">Account totals come from connected platform APIs when the account and granted permissions support them. Publishing cadence comes from this browser's saved post history.</footer>
  </PageFrame>;
}
