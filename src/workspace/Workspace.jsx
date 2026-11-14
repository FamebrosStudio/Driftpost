import React, { useEffect, useMemo, useState } from 'react';
import BrandIcon from '../brand.jsx';
import { api, listSchedules, cancelSchedule, moveSchedule, matchesSearchText, PLATFORMS } from '../lib.js';
import CampaignComposer from './CampaignComposer.jsx';
import { readPostLog } from '../history/log.js';
import { isAiAccount } from '../ai-access.js';
import Dock from '../components/reactbits/Dock.jsx';
import BorderGlow from '../components/reactbits/BorderGlow.jsx';
import './workspace.css';

const NAV = [
  ['home', 'Overview', 'home'], ['create', 'Create post', 'plus'], ['calendar', 'Calendar', 'calendar'],
  ['analytics', 'Analytics', 'chart'], ['automations', 'Automations', 'gear'], ['history', 'Publishing history', 'clock'], ['accounts', 'Connected accounts', 'users'],
];
const platformName = (id) => PLATFORMS.find((p) => p.id === id)?.name || id;
// Normalize display names and @handles so "@brandstudio" and "Brand Studio"
// can select the same client group, while preserving distinct suffixes such as
// Production, Social, and Studio.
const accountNameKey = (name) => String(name || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  .toLocaleLowerCase().replace(/[^a-z0-9]/g, '');
const accountGroupLabel = (name) => String(name || '').normalize('NFKC').trim();
const localIso = (date) => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

function metricIssue(account) {
  const raw = String(account.error || '').toLowerCase();
  if (account.platform === 'youtube' && /credential|unauthorized|invalid_grant|authorization expired|invalid authentication/.test(raw)) {
    return { title: 'Reconnect YouTube', message: 'YouTube did not accept the saved sign-in. Reconnect this channel in Accounts to refresh access.' };
  }
  if (account.platform === 'facebook' && /permission|pages_read_engagement|pages_show_list|pages_manage_metadata|pages_read_user_content/.test(raw)) {
    return { title: 'Facebook insights access is missing', message: 'Reconnect this Page in Accounts and approve pages_read_engagement. If Meta does not offer it, the app administrator must enable it in the Facebook Login configuration and grant the app the required Meta access.' };
  }
  if (account.platform === 'instagram' && /permission|oauth|token|unauthorized|190/.test(raw)) {
    return { title: 'Reconnect Instagram', message: 'Instagram did not allow Driftpost to read these account totals. Reconnect the account in Accounts and approve the requested access.' };
  }
  if (account.platform === 'facebook' && /oauth|token|unauthorized|190/.test(raw)) {
    return { title: 'Reconnect Facebook', message: 'Facebook did not accept the saved sign-in. Reconnect this Page in Accounts to refresh access.' };
  }
  if (account.platform === 'x' && /unauthorized|token|expired|401/.test(raw)) {
    return { title: 'Reconnect X', message: 'X did not accept the saved sign-in. Reconnect this account in Accounts to refresh access.' };
  }
  return { title: 'Live totals unavailable', message: `The ${platformName(account.platform)} API did not return metrics for this account. Try refreshing, or review its connection in Accounts.` };
}

function Icon({ name, size = 16 }) {
  const common = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };
  const shapes = {
    home: <><path d="m3 10 9-7 9 7"/><path d="M5 9v11h14V9M9 20v-6h6v6"/></>,
    plus: <path d="M12 5v14M5 12h14"/>,
    calendar: <><rect x="3.5" y="5" width="17" height="16" rx="1.5"/><path d="M7.5 3v4M16.5 3v4M3.5 10h17M8 14h.01M12 14h.01M16 14h.01M8 17h.01M12 17h.01"/></>,
    chart: <><path d="M4 19V5M4 19h17"/><path d="m7 15 4-4 3 2 6-7"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></>,
    users: <><circle cx="9" cy="8" r="3"/><path d="M3.5 20a5.5 5.5 0 0 1 11 0M16 5.5a3 3 0 0 1 0 5.8M17 14a5 5 0 0 1 3.5 4.8"/></>,
    sliders: <><path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h9M17 18h3"/><circle cx="15" cy="6" r="2"/><circle cx="9" cy="12" r="2"/><circle cx="15" cy="18" r="2"/></>,
    gear: <><circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="2.4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.93 4.93l2.12 2.12M16.95 16.95l2.12 2.12M19.07 4.93l-2.12 2.12M7.05 16.95l-2.12 2.12"/></>,
    video: <><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m10 9 5 3-5 3z"/></>,
    review: <><rect x="3" y="5" width="15" height="13" rx="2"/><path d="m9 9 4 2.5-4 2.5zM14.5 18.5l2 2 4-5"/></>,
    arrowRight: <><path d="M4 12h15M13 6l6 6-6 6"/></>,
    arrowLeft: <><path d="M20 12H5M11 6l-6 6 6 6"/></>,
    sparkles: <><path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7L12 3Z"/><path d="m19 14 .9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14ZM5 3l.7 1.8L7.5 5.5l-1.8.7L5 8l-.7-1.8-1.8-.7 1.8-.7L5 3Z"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...common}>{shapes[name] || shapes.sparkles}</svg>;
}

const Glyph = ({ d, children }) => (
  <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{children}</svg>
);
const SunGlyph = () => <Glyph><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" /></Glyph>;
const MoonGlyph = () => <Glyph><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></Glyph>;
const SignOutGlyph = () => <Glyph><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></Glyph>;

export function WorkspaceNav({ page, onNavigate, email, onSignOut }) {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('driftpost-console-theme') === 'light' ? 'light' : 'dark'; }
    catch { return 'dark'; }
  });
  // Compact dock sizing on narrow screens so the full item row still fits.
  const [compact, setCompact] = useState(() => window.matchMedia('(max-width: 760px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 760px)');
    const onChange = () => setCompact(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('driftpost-console-theme', theme); } catch {}
  }, [theme]);
  // Cursor-close border glow (MagicBento reference technique) on the main
  const navPage = page === 'connect' ? 'accounts' : page;
  const dockItems = [
    ...NAV.map(([id, label, icon]) => ({
      icon: <Icon name={icon} size={19} />,
      label,
      onClick: () => onNavigate(id),
      active: navPage === id,
    })),
    ...(isAiAccount(email) ? [
      { icon: <Icon name="video" size={19} />, label: 'Team video', onClick: () => onNavigate('team-video'), active: page === 'team-video' },
      { icon: <Icon name="review" size={19} />, label: 'Video review', onClick: () => onNavigate('team-video-review'), active: page === 'team-video-review' },
    ] : []),
    ...(!compact ? [{ separator: true }] : []),
    {
      icon: theme === 'dark' ? <SunGlyph /> : <MoonGlyph />,
      label: theme === 'dark' ? 'Light appearance' : 'Dark appearance',
      onClick: () => setTheme((value) => value === 'dark' ? 'light' : 'dark'),
    },
    ...(onSignOut ? [{
      icon: <SignOutGlyph />,
      label: 'Sign out',
      onClick: onSignOut,
    }] : []),
  ];
  return <>
    <header className="ws-topbar">
      <button type="button" className="ws-wordmark" onClick={() => onNavigate('home')} aria-label="Driftpost overview">
        <img className="logo-img logo-d" src="/logo-dark-620.png" srcSet="/logo-dark-620.png 620w, /logo-dark.png 1984w" sizes="168px" width="1984" height="512" decoding="async" alt="Driftpost" />
        <img className="logo-img logo-l" src="/logo-light.png" width="1908" height="512" decoding="async" alt="Driftpost" />
      </button>
      {page === 'create' && <button type="button" className="ws-overview-link" onClick={() => onNavigate('home')}><Icon name="arrowLeft" size={15} /> Overview</button>}
      <div className="ws-user"><span className="ws-user-dot">{(email || 'U')[0].toUpperCase()}</span><span className="ws-user-email">{email || 'Workspace'}</span></div>
    </header>
    <div className="ws-dock-holder">
      <Dock items={dockItems} position="bottom" theme={theme} accentColor="#7dd3fc" badgeColor="#7dd3fc" baseItemSize={compact ? 34 : 46} magnification={compact ? 48 : 66} />
    </div>
  </>;
}

function PageFrame({ page, onNavigate, email, onSignOut, eyebrow, title, intro, children, action }) {
  return <div className="ws"><WorkspaceNav page={page} onNavigate={onNavigate} email={email} onSignOut={onSignOut} />
    <main className="ws-main"><div className="ws-heading"><div><span className="ws-eyebrow">{eyebrow}</span><h1>{title}</h1>{intro && <p>{intro}</p>}</div>{action && <div className="ws-heading-action">{action}</div>}</div>{children}</main>
  </div>;
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
  const connectedPlatforms = PLATFORMS.filter((platform) => connections?.some((account) => account.platform === platform.id));
  return <PageFrame page="home" onNavigate={onNavigate} email={session.user?.email} onSignOut={onSignOut} eyebrow="Publishing overview" title="Overview" intro="See what’s scheduled, check your connected channels, and plan what goes out next.">
    <section className="ws-welcome"><div><span className="ws-eyebrow">Publishing desk</span><h2>One post, across your channels</h2><p>Choose your destinations, prepare a post, then publish now or schedule it.</p><BorderGlow className="btn-glow ws-btn-glow" backgroundColor="#071019" borderRadius={0} glowColor="199 95 74" colors={['#7dd3fc', '#4dc3f7', '#a5ddfa']} fillOpacity={0.3} glowRadius={22}><button className="ws-primary" onClick={onCreate}>Create a post <Icon name="arrowRight" size={15} /></button></BorderGlow>{isAiAccount(session.user?.email) && <BorderGlow className="btn-glow ws-btn-glow" backgroundColor="#071019" borderRadius={0} glowColor="199 95 74" colors={['#7dd3fc', '#4dc3f7', '#a5ddfa']} fillOpacity={0.3} glowRadius={22}><button className="ws-secondary ws-team-entry" onClick={() => onNavigate('team-video')}>Send a team video <Icon name="arrowRight" size={15} /></button></BorderGlow>}</div><div className="ws-welcome-route" aria-label={`${connectedPlatforms.length} connected publishing channels`}>{connectedPlatforms.length ? connectedPlatforms.map((platform, index) => <span className="ws-route-stop" key={platform.id} style={{ '--route-order': index }} title={platform.name}><BrandIcon id={platform.id} size={18} /><small>{platform.name}</small></span>) : <span className="ws-route-empty">Connect a channel to start publishing</span>}</div></section>
    <div className="ws-stat-grid">
      <BorderGlow className="bg-glow" backgroundColor="#071019" borderRadius={0} glowColor="199 95 74" colors={['#7dd3fc', '#4dc3f7', '#a5ddfa']} fillOpacity={0.12} glowRadius={22}><article className="ws-stat"><span>Connected accounts</span><strong>{connections === null ? '—' : connections.length}</strong><small>{connections?.length ? 'Ready to publish' : 'Connect your first channel'}</small><button onClick={() => onNavigate('accounts')}>Manage accounts <Icon name="arrowRight" size={13} /></button></article></BorderGlow>
      <BorderGlow className="bg-glow" backgroundColor="#071019" borderRadius={0} glowColor="199 95 74" colors={['#7dd3fc', '#4dc3f7', '#a5ddfa']} fillOpacity={0.12} glowRadius={22}><article className="ws-stat"><span>Scheduled posts</span><strong>{schedules === null ? '—' : schedules.filter((s) => s.status === 'scheduled').length}</strong><small>Waiting in your calendar</small><button onClick={() => onNavigate('calendar')}>Open calendar <Icon name="arrowRight" size={13} /></button></article></BorderGlow>
      <BorderGlow className="bg-glow" backgroundColor="#071019" borderRadius={0} glowColor="199 95 74" colors={['#7dd3fc', '#4dc3f7', '#a5ddfa']} fillOpacity={0.12} glowRadius={22}><article className="ws-stat"><span>Posts in this browser</span><strong>{posts.length}</strong><small>Saved publishing history</small><button onClick={() => onNavigate('analytics')}>View analytics <Icon name="arrowRight" size={13} /></button></article></BorderGlow>
    </div>
    <div className="ws-dashboard-grid">
      <BorderGlow className="bg-glow" backgroundColor="#071019" borderRadius={0} glowColor="199 95 74" colors={['#7dd3fc', '#4dc3f7', '#a5ddfa']} fillOpacity={0.12} glowRadius={22}><section className="ws-panel"><div className="ws-panel-head"><div><span className="ws-eyebrow">Coming up</span><h2>Next on your calendar</h2></div><button className="ws-text-button" onClick={() => onNavigate('calendar')}>View calendar <Icon name="arrowRight" size={13} /></button></div>
        {upcoming.length ? <div className="ws-upcoming">{upcoming.map((item) => <div className="ws-upcoming-row" key={item.id}><span className="ws-icon"><BrandIcon id={item.platform} size={17} /></span><div><b>{platformName(item.platform)}</b><small>{item.body?.text || item.body?.caption || 'Scheduled post'}</small></div><time>{new Date(item.scheduled_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}<small>{new Date(item.scheduled_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</small></time></div>)}</div> : <div className="ws-empty"><span><Icon name="calendar" size={22} /></span><b>No upcoming posts</b><small>Your next scheduled post will show up here.</small><button onClick={() => onNavigate('calendar')}>Plan a post <Icon name="arrowRight" size={13} /></button></div>}
      </section></BorderGlow>
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
  const [connections, setConnections] = useState([]);
  const [connectionsError, setConnectionsError] = useState('');
  const [campaignOpen, setCampaignOpen] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const [selected, setSelected] = useState(() => localIso(new Date()));
  const startDay = new Date(month.getFullYear(), month.getMonth(), 1);
  const gridStart = new Date(startDay); gridStart.setDate(1 - startDay.getDay());
  const gridEnd = new Date(gridStart); gridEnd.setDate(gridStart.getDate() + 42);
  useEffect(() => {
    let active = true; setLoading(true); setNotice('');
    const load = () => listSchedules(session.access_token, { from: gridStart.toISOString(), to: gridEnd.toISOString() })
      .then((data) => { if (active) setRows(data); })
      .catch((err) => { if (active) setNotice(err.message || 'Could not load your calendar.'); })
      .finally(() => { if (active) setLoading(false); });
    void load();
    // Keep scheduled/publishing/published/failed badges current while the
    // calendar stays open; publishing is performed by the server worker.
    const timer = window.setInterval(load, 15_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [session.access_token, month.getFullYear(), month.getMonth(), reloadTick]);
  useEffect(() => {
    let active = true;
    api('/api/connections', session.access_token)
      .then((data) => { if (active) { setConnections(data.connections || []); setConnectionsError(''); } })
      .catch((error) => { if (active) setConnectionsError(error.message || 'Could not load connected accounts.'); });
    return () => { active = false; };
  }, [session.access_token]);
  const byDate = useMemo(() => rows.reduce((map, row) => { const key = localIso(new Date(row.scheduled_at)); (map[key] ||= []).push(row); return map; }, {}), [rows]);
  const dates = Array.from({ length: 42 }, (_, i) => { const d = new Date(gridStart); d.setDate(gridStart.getDate() + i); return d; });
  const dayRows = byDate[selected] || [];
  const changeMonth = (delta) => { const next = new Date(month.getFullYear(), month.getMonth() + delta, 1); setMonth(next); setSelected(localIso(next)); };
  const cancel = async (id) => { setBusy(id); try { await cancelSchedule(session.access_token, id); setRows((old) => old.filter((r) => r.id !== id)); setNotice('Scheduled post cancelled.'); } catch (e) { setNotice(e.message || 'Could not cancel this post.'); } finally { setBusy(''); } };
  const move = async (event, day) => {
    event.preventDefault();
    const id = event.dataTransfer?.getData('text/plain');
    if (!id) {
      if (event.dataTransfer?.files?.length) setNotice('Open Multi-account campaign, then drop each design onto its account card and choose the festival date.');
      return;
    }
    const row = rows.find((item) => item.id === id);
    if (!row || row.status !== 'scheduled') return;
    const original = new Date(row.scheduled_at);
    const time = `${String(original.getHours()).padStart(2, '0')}:${String(original.getMinutes()).padStart(2, '0')}:00`;
    const next = new Date(`${day}T${time}`);
    if (!Number.isFinite(next.getTime())) return;
    const now = Date.now();
    if (next.getTime() < now + 2 * 60_000) {
      setNotice('That day and time has passed or is too close. Drop the post on a later day; its original local time will be kept.');
      return;
    }
    if (next.getTime() > now + 365 * 24 * 60 * 60_000) {
      setNotice('Scheduled posts can only be moved within the next year.');
      return;
    }
    setBusy(id);
    try {
      const data = await moveSchedule(session.access_token, id, next.toISOString());
      setRows((old) => old.map((item) => item.id === id ? data.schedule : item));
      setNotice(`Moved post to ${next.toLocaleString()}.`);
    } catch (e) { setNotice(e.message || 'Could not move scheduled post.'); }
    finally { setBusy(''); }
  };
  return <PageFrame page="calendar" onNavigate={onNavigate} email={session.user?.email} onSignOut={onSignOut} eyebrow="Plan ahead" title="Calendar" intro="Plan individual posts or build one campaign with a shared caption and separate media for every account." action={<div className="ws-calendar-heading-actions"><BorderGlow className="btn-glow ws-btn-glow" backgroundColor="#071019" borderRadius={0} glowColor="199 95 74" colors={['#7dd3fc', '#4dc3f7', '#a5ddfa']} fillOpacity={0.3} glowRadius={22}><button className="ws-secondary" onClick={() => onCreate(selected)}><Icon name="plus" size={15} /> Single post</button><BorderGlow className="btn-glow ws-btn-glow" backgroundColor="#071019" borderRadius={0} glowColor="199 95 74" colors={['#7dd3fc', '#4dc3f7', '#a5ddfa']} fillOpacity={0.3} glowRadius={22}></BorderGlow><button className="ws-primary" onClick={() => setCampaignOpen((open) => !open)}><Icon name="plus" size={15} /> Multi-account campaign</button></BorderGlow></div>}>
    {connectionsError && <div className="ws-inline-state" role="status">{connectionsError}</div>}
    {campaignOpen && <CampaignComposer session={session} accounts={connections} day={selected} onClose={() => setCampaignOpen(false)} onSaved={() => setReloadTick((n) => n + 1)} />}
    <BorderGlow className="bg-glow" backgroundColor="#071019" borderRadius={0} glowColor="199 95 74" colors={['#7dd3fc', '#4dc3f7', '#a5ddfa']} fillOpacity={0.12} glowRadius={22}><section className="ws-panel ws-calendar-panel"><div className="ws-calendar-toolbar"><div><h2>{month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</h2><span className="ws-legend"><i /> Scheduled</span></div><div className="ws-month-actions"><button aria-label="Previous month" onClick={() => changeMonth(-1)}><Icon name="arrowLeft" size={15} /></button><button onClick={() => { const now = new Date(); setMonth(new Date(now.getFullYear(), now.getMonth(), 1)); setSelected(localIso(now)); }}>Today</button><button aria-label="Next month" onClick={() => changeMonth(1)}><Icon name="arrowRight" size={15} /></button></div></div>
      <div className="ws-calendar-grid ws-weekdays">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => <span key={d}>{d}</span>)}</div>
      <div className="ws-calendar-grid ws-days">{dates.map((date) => { const key = localIso(date); const items = byDate[key] || []; const today = key === localIso(new Date()); return <button key={key} className={`ws-day ${date.getMonth() === month.getMonth() ? '' : 'outside'} ${selected === key ? 'selected' : ''} ${today ? 'today' : ''}`} onClick={() => setSelected(key)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => move(event, key)} title="Drop a scheduled post here to move it to this date"><span className="ws-day-number">{date.getDate()}</span>{items.slice(0, 2).map((item) => <span className={`ws-event ${item.status} ${item.status === 'scheduled' ? 'draggable' : ''}`} key={item.id} draggable={item.status === 'scheduled'} onDragStart={(event) => { event.dataTransfer.setData('text/plain', item.id); event.dataTransfer.effectAllowed = 'move'; }} title={`${platformName(item.platform)} · Drag to another date to reschedule`}><BrandIcon id={item.platform} size={12} /><b>{platformName(item.platform)}</b></span>)}{items.length > 2 && <small className="ws-more">+{items.length - 2} more</small>}</button>; })}</div>
      {loading && <div className="ws-inline-state">Loading schedule…</div>}{notice && <div className="ws-inline-state" role="status">{notice}</div>}
    </section></BorderGlow>
    <BorderGlow className="bg-glow" backgroundColor="#071019" borderRadius={0} glowColor="199 95 74" colors={['#7dd3fc', '#4dc3f7', '#a5ddfa']} fillOpacity={0.12} glowRadius={22}><section className="ws-panel ws-day-panel"><div className="ws-panel-head"><div><span className="ws-eyebrow">Selected day</span><h2>{new Date(`${selected}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</h2></div><BorderGlow className="btn-glow ws-btn-glow" backgroundColor="#071019" borderRadius={0} glowColor="199 95 74" colors={['#7dd3fc', '#4dc3f7', '#a5ddfa']} fillOpacity={0.3} glowRadius={22}><button className="ws-secondary" onClick={() => onCreate(selected)}><Icon name="plus" size={14} /> Plan for this day</button></BorderGlow></div>
      {!dayRows.length ? <div className="ws-empty compact"><b>{loading ? 'Checking your schedule…' : 'Nothing planned for this day'}</b><small>Choose another date or create a post to get started.</small></div> : <div className="ws-upcoming">{dayRows.map((row) => { const needsApproval = row.body?.approval_status === 'pending'; return <div className="ws-upcoming-row" key={row.id}><span className="ws-icon"><BrandIcon id={row.platform} size={17} /></span><div><b>{platformName(row.platform)} <em className={`ws-status ${needsApproval ? 'approval-needed' : row.status}`}>{needsApproval ? 'Needs approval' : row.status}</em></b><small>{row.body?.text || row.body?.caption || 'Scheduled post'}</small></div><time>{new Date(row.scheduled_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</time>{['scheduled', 'publishing'].includes(row.status) && <button className="ws-cancel" disabled={busy === row.id} onClick={() => cancel(row.id)}>{busy === row.id ? '…' : 'Cancel'}</button>}</div>; })}</div>}
    </section></BorderGlow>
    <footer className="ws-footnote">Scheduled posts publish automatically at the selected time. Past, failed, and cancelled items remain available in History.</footer>
  </PageFrame>;
}

export function AnalyticsPage({ session, onNavigate, onSignOut }) {
  const posts = useMemo(() => readPostLog().filter((p) => p && Number.isFinite(Number(p.at))).sort((a, b) => Number(b.at) - Number(a.at)), []);
  const [schedules, setSchedules] = useState([]);
  const [accountMetrics, setAccountMetrics] = useState([]);
  const [contentMetrics, setContentMetrics] = useState([]);
  const [contentBusy, setContentBusy] = useState(true);
  const [contentError, setContentError] = useState('');
  const [contentPeriod, setContentPeriod] = useState('all');
  const [metricsBusy, setMetricsBusy] = useState(true);
  const [metricsError, setMetricsError] = useState('');
  const [metricsRefresh, setMetricsRefresh] = useState(0);
  const [metricsUpdatedAt, setMetricsUpdatedAt] = useState('');
  const [accountSearch, setAccountSearch] = useState('');
  const [selectedAccountName, setSelectedAccountName] = useState('');
  const contentReferences = useMemo(() => {
    const unique = new Map();
    for (const post of posts) {
      const published = Array.isArray(post.publishedPosts) && post.publishedPosts.length
        ? post.publishedPosts
        : [{ platform: post.platform, postId: post.postId, connectionId: post.connectionId }];
      for (const item of published) {
        if (!item?.platform || !item?.postId || !item?.connectionId) continue;
        const key = `${item.platform}:${item.connectionId}:${item.postId}`;
        if (!unique.has(key)) unique.set(key, {
          platform: item.platform, postId: String(item.postId), connectionId: String(item.connectionId),
          at: Number(post.at), text: String(post.text || '').slice(0, 140), url: String(post.url || ''),
        });
      }
    }
    return [...unique.values()].slice(0, 50);
  }, [posts]);
  const accountChoices = useMemo(() => {
    const unique = new Map();
    for (const account of accountMetrics) {
      const key = accountNameKey(account.name);
      if (!key) continue;
      const choice = unique.get(key) || { key, name: accountGroupLabel(account.name), aliases: [] };
      choice.aliases.push(String(account.name || ''));
      if (accountGroupLabel(account.name).length < choice.name.length) choice.name = accountGroupLabel(account.name);
      unique.set(key, choice);
    }
    return [...unique.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [accountMetrics]);
  const filteredAccountChoices = accountChoices.filter((account) => matchesSearchText(accountSearch, account.name, ...account.aliases));
  const selectedAccountChoice = accountChoices.find((account) => account.key === selectedAccountName);
  const visibleAccountChoices = selectedAccountChoice && !filteredAccountChoices.some((account) => account.key === selectedAccountChoice.key)
    ? [selectedAccountChoice, ...filteredAccountChoices]
    : filteredAccountChoices;
  const selectedAccounts = useMemo(
    () => accountMetrics.filter((account) => accountNameKey(account.name) === selectedAccountName),
    [accountMetrics, selectedAccountName],
  );
  const selectedConnectionIds = useMemo(() => new Set(selectedAccounts.map((account) => account.id)), [selectedAccounts]);
  const selectedContentReferences = useMemo(
    () => contentReferences.filter((post) => selectedConnectionIds.has(post.connectionId)),
    [contentReferences, selectedConnectionIds],
  );
  useEffect(() => {
    let active = true;
    setContentBusy(true); setContentError('');
    if (!selectedAccountName || !selectedAccounts.length) {
      setContentMetrics([]);
      setContentBusy(false);
      return () => { active = false; };
    }
    setContentMetrics([]);
    api('/api/analytics/content', session.access_token, {
      method: 'POST', body: JSON.stringify({ connectionIds: selectedAccounts.map((account) => account.id) }),
    }).then((data) => { if (active) setContentMetrics(data.posts || []); })
      .catch((error) => { if (active) setContentError(error.message || 'Could not load post interactions.'); })
      .finally(() => { if (active) setContentBusy(false); });
    return () => { active = false; };
  }, [selectedAccountName, selectedAccounts, session.access_token, metricsRefresh]);
  useEffect(() => { let active = true; listSchedules(session.access_token, { from: new Date().toISOString() }).then((data) => { if (active) setSchedules(data); }).catch(() => {}); return () => { active = false; }; }, [session.access_token]);
  useEffect(() => {
    let active = true;
    setMetricsBusy(true); setMetricsError('');
    api('/api/analytics/accounts', session.access_token)
      .then((data) => { if (active) { setAccountMetrics(data.accounts || []); setMetricsUpdatedAt(data.updated_at || new Date().toISOString()); } })
      .catch((e) => { if (active) setMetricsError(e.message || 'Could not load live account metrics.'); })
      .finally(() => { if (active) setMetricsBusy(false); });
    return () => { active = false; };
  }, [session.access_token, metricsRefresh]);
  const contentCutoff = contentPeriod === 'all' ? 0 : Date.now() - Number(contentPeriod) * 24 * 60 * 60 * 1000;
  const dateLabel = contentPeriod === 'all' ? 'Latest 25 posts' : `Last ${contentPeriod} days`;
  return <PageFrame page="analytics" onNavigate={onNavigate} email={session.user?.email} onSignOut={onSignOut} eyebrow="Your results, at a glance" title="Analytics" intro="Search for an account to see each connected platform’s results separately." action={<div className="ws-analytics-actions"><BorderGlow className="btn-glow ws-btn-glow" backgroundColor="#071019" borderRadius={0} glowColor="199 95 74" colors={['#7dd3fc', '#4dc3f7', '#a5ddfa']} fillOpacity={0.3} glowRadius={22}><button className="ws-secondary" disabled={metricsBusy || contentBusy} onClick={() => setMetricsRefresh((n) => n + 1)}>{metricsBusy || contentBusy ? 'Refreshing…' : 'Refresh'}</button><BorderGlow className="btn-glow ws-btn-glow" backgroundColor="#071019" borderRadius={0} glowColor="199 95 74" colors={['#7dd3fc', '#4dc3f7', '#a5ddfa']} fillOpacity={0.3} glowRadius={22}></BorderGlow><button className="ws-secondary" onClick={() => onNavigate('history')}>View history <Icon name="arrowRight" size={13} /></button></BorderGlow></div>}>
    <BorderGlow className="bg-glow" backgroundColor="#071019" borderRadius={0} glowColor="199 95 74" colors={['#7dd3fc', '#4dc3f7', '#a5ddfa']} fillOpacity={0.12} glowRadius={22}><section className="ws-panel ws-account-picker">
      <div className="ws-account-field">
        <label htmlFor="analytics-account-search">Search account name</label>
        <input id="analytics-account-search" type="search" value={accountSearch} onChange={(event) => setAccountSearch(event.target.value)} placeholder="Type an account name…" />
      </div>
      <div className="ws-account-field">
        <label htmlFor="analytics-account">Select account</label>
        <select id="analytics-account" value={selectedAccountName} onChange={(event) => setSelectedAccountName(event.target.value)} disabled={metricsBusy || !visibleAccountChoices.length}>
          <option value="">{metricsBusy ? 'Loading accounts…' : 'Choose an account name'}</option>
          {visibleAccountChoices.map((account) => <option key={account.key} value={account.key}>{account.name}</option>)}
        </select>
      </div>
      {!metricsBusy && !accountMetrics.length && <p>No connected accounts yet. <button type="button" onClick={() => onNavigate('accounts')}>Connect an account <Icon name="arrowRight" size={12} /></button></p>}
      {!metricsBusy && metricsError && !accountMetrics.length && <p className="ws-account-picker-error" role="alert">{metricsError} <button type="button" onClick={() => setMetricsRefresh((n) => n + 1)}>Try again</button></p>}
      {!metricsBusy && accountMetrics.length > 0 && !filteredAccountChoices.length && <p className="ws-account-picker-error" role="status">No account names match “{accountSearch}”.</p>}
    </section></BorderGlow>
    {!selectedAccounts.length ? <BorderGlow className="bg-glow" backgroundColor="#071019" borderRadius={0} glowColor="199 95 74" colors={['#7dd3fc', '#4dc3f7', '#a5ddfa']} fillOpacity={0.12} glowRadius={22}><section className="ws-panel ws-account-prompt"><span className="ws-insight-mark"><Icon name="chart" /></span><div><b>{metricsError && !accountMetrics.length ? 'Could not load account analytics' : 'Search and select an account name'}</b><p>{metricsError && !accountMetrics.length ? 'Refresh to try again. Your analytics will appear here after connected accounts load.' : 'Each connected platform for that account will have its own detailed analytics section.'}</p></div></section></BorderGlow> : <>
      <div className="ws-content-period ws-content-period-global" aria-label="Choose analytics period">{[['7', '7 days'], ['30', '30 days'], ['all', 'Latest 25']].map(([value, label]) => <button type="button" key={value} className={contentPeriod === value ? 'active' : ''} aria-pressed={contentPeriod === value} onClick={() => setContentPeriod(value)}>{label}</button>)}</div>
      {contentBusy && <div className="ws-inline-state" role="status">Loading post interactions…</div>}
      <div className="ws-platform-analytics-grid">{selectedAccounts.map((account) => {
        const refs = selectedContentReferences.filter((post) => post.connectionId === account.id);
        const rawAccountContent = contentMetrics.filter((post) => post.connectionId === account.id);
        const accountContent = rawAccountContent.filter((post) => !post.error && !post.isEmpty && Number(post.at) >= contentCutoff);
        const accountContentError = rawAccountContent.find((post) => post.error);
        const accountContentIssue = accountContentError ? metricIssue({ platform: account.platform, error: accountContentError.error }) : null;
        const accountHasNoPosts = rawAccountContent.some((post) => post.isEmpty);
        const ranked = accountContent.filter((post) => post.interactions != null && Number.isFinite(Number(post.interactions))).sort((a, b) => Number(b.interactions) - Number(a.interactions));
        const accountNow = new Date();
        const startOfWeek = new Date(accountNow); startOfWeek.setDate(accountNow.getDate() - 6); startOfWeek.setHours(0, 0, 0, 0);
        const startOfMonth = new Date(accountNow.getFullYear(), accountNow.getMonth(), 1).getTime();
        const postedThisMonth = refs.filter((post) => Number(post.at) >= startOfMonth).length;
        const postedThisWeek = refs.filter((post) => Number(post.at) >= startOfWeek.getTime()).length;
        const scheduledCount = schedules.filter((post) => post.status === 'scheduled' && post.connection_id === account.id).length;
        const accountMetricValues = Object.entries(account.metrics || {}).filter(([, value]) => value != null);
        const dailyPosts = Array.from({ length: 7 }, (_, dayIndex) => {
          const day = new Date(startOfWeek); day.setDate(startOfWeek.getDate() + dayIndex);
          const nextDay = new Date(day); nextDay.setDate(day.getDate() + 1);
          return { day, count: refs.filter((post) => Number(post.at) >= day.getTime() && Number(post.at) < nextDay.getTime()).length };
        });
        const maxDailyPosts = Math.max(1, ...dailyPosts.map((item) => item.count));
        return <BorderGlow key={account.id} className="bg-glow" backgroundColor="#071019" borderRadius={0} glowColor="199 95 74" colors={['#7dd3fc', '#4dc3f7', '#a5ddfa']} fillOpacity={0.12} glowRadius={22}><section className="ws-panel ws-platform-analytics" >
          <div className="ws-platform-analytics-heading"><span className="ws-icon"><BrandIcon id={account.platform} size={18} /></span><div><span className="ws-eyebrow">{platformName(account.platform)}</span><h2>{account.name}</h2></div><span className="ws-live-status"><i className={metricsBusy ? 'is-refreshing' : ''} />{metricsBusy ? 'Refreshing' : metricsUpdatedAt ? `Updated ${new Date(metricsUpdatedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : 'Live totals'}</span></div>
          {account.error ? <div className="ws-metric-error ws-selected-account-error"><b>{metricIssue(account).title}</b><p>{metricIssue(account).message}</p><button type="button" onClick={() => onNavigate('accounts')}>Review connection <Icon name="arrowRight" size={12} /></button><details><summary>Technical details</summary><small>{account.error}</small></details></div>
            : accountMetricValues.length ? <div className="ws-metric-values ws-selected-account-values">{accountMetricValues.map(([key, value]) => <span key={key}><b>{Number(value).toLocaleString()}</b><small>{({ followers: 'Followers', following: 'Following', subscribers: 'Subscribers', views: 'Lifetime views', posts: account.platform === 'youtube' ? 'Videos' : 'Posts' })[key] || key}</small></span>)}</div>
              : <div className="ws-metric-no-data">This platform does not provide public totals for this account.</div>}
          <div className="ws-platform-post-stats"><span><b>{postedThisMonth}</b><small>Posts this month</small></span><span><b>{postedThisWeek}</b><small>Posts in 7 days</small></span><span><b>{scheduledCount}</b><small>Scheduled</small></span></div>
          <div className="ws-platform-section-heading"><div><span className="ws-eyebrow">{dateLabel}</span><h3>Top content based on interactions</h3></div></div>
          {contentBusy && !rawAccountContent.length ? <div className="ws-content-state">Loading this platform’s recent content…</div>
            : contentError && !rawAccountContent.length ? <div className="ws-content-empty is-error"><div><b>Could not load recent content</b><p>{contentError}</p><button type="button" onClick={() => setMetricsRefresh((n) => n + 1)}>Try again</button></div></div>
              : accountContentError ? <div className="ws-content-empty is-error"><div className="ws-content-error-copy"><b>{accountContentIssue.title}</b><p>{accountContentIssue.message}</p><button type="button" onClick={() => onNavigate('accounts')}>Reconnect / review Facebook access</button><details><summary>Show technical details</summary><small>{accountContentError.error}</small></details></div></div>
              : accountHasNoPosts ? <div className="ws-content-empty"><div><b>No recent public posts found</b><p>The platform returned no posts for this account.</p></div></div>
                : !ranked.length ? <div className="ws-content-empty"><div><b>No posts in this time range</b><p>Choose a longer period or check whether this platform allows Driftpost to read post insights.</p></div></div>
                  : <div className="ws-top-content-list">{ranked.slice(0, 3).map((item, index) => <article className="ws-top-content-row" key={`${item.platform}:${item.connectionId}:${item.postId}`}>
                  <span className="ws-content-rank">{String(index + 1).padStart(2, '0')}</span><div className="ws-content-copy"><b title={item.text || ''}>{item.text || 'Published post'}</b><small>{Number(item.at) ? new Date(Number(item.at)).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Date unavailable'}</small></div>
                  <div className="ws-content-interactions"><b>{Number(item.interactions).toLocaleString()}</b><small>interactions</small></div>
                  {/^https?:\/\//i.test(item.url || '') && <a className="ws-content-open" href={item.url} target="_blank" rel="noreferrer">Open post <Icon name="arrowRight" size={12} /></a>}
                  <div className="ws-content-breakdown">{[['Likes', item.likes], ['Comments', item.comments], ['Shares / replies', item.shares], ...(item.views == null ? [] : [['Views', item.views]])].map(([label, value]) => <span key={label}><b>{Number(value || 0).toLocaleString()}</b><small>{label}</small></span>)}</div>
                </article>)}</div>}
          <div className="ws-platform-section-heading"><div><span className="ws-eyebrow">Publishing cadence</span><h3>Posts over the last 7 days</h3></div></div>
          <div className="ws-chart" role="img" aria-label={`${platformName(account.platform)} published posts per day for the last seven days`}>{dailyPosts.map((item) => <div className="ws-chart-day" key={item.day.toISOString()}><div className="ws-chart-track"><i style={{ height: `${Math.max(item.count ? 10 : 3, item.count / maxDailyPosts * 100)}%` }} title={`${item.count} posts`} /></div><b>{item.count}</b><small>{item.day.toLocaleDateString(undefined, { weekday: 'short' })}</small></div>)}</div>
        </section></BorderGlow>;
      })}</div>
      <BorderGlow className="bg-glow" backgroundColor="#071019" borderRadius={0} glowColor="199 95 74" colors={['#7dd3fc', '#4dc3f7', '#a5ddfa']} fillOpacity={0.12} glowRadius={22}><section className="ws-panel ws-insight"><span className="ws-insight-mark"><Icon name="sparkles" /></span><div><b>Analytics for {selectedAccounts[0]?.name}</b><p>Each platform is reported separately. Interaction totals use platform APIs where available; publishing cadence uses this browser’s saved History.</p></div><button className="ws-text-button" onClick={() => onNavigate('history')}>Open history <Icon name="arrowRight" size={13} /></button></section></BorderGlow>
      <footer className="ws-footnote">Account totals come from connected platform APIs when the account and granted permissions support them. Publishing cadence comes from this browser's saved post history.</footer>
    </>}
  </PageFrame>;
}
