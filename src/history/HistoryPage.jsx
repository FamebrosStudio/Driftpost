import React, { useEffect, useState } from 'react';
import BrandIcon from '../brand.jsx';
import { api } from '../lib.js';
import { readDisconnectLog, removeDisconnectLog, readCaptionLog, readPostLog, removePostLog, updatePostLog } from './log.js';
import { listSchedules, cancelSchedule } from '../lib.js';
import './history.css';
import { WorkspaceNav } from '../workspace/Workspace.jsx';
import { hasAiAccess } from '../ai-access.js';

const TABS = [
  { id: 'posted', label: 'Posted' },
  { id: 'scheduled', label: 'Scheduled' },
  { id: 'deleted', label: 'Deleted accounts' },
  { id: 'captions', label: 'Captions' },
];

function fmtDate(at) {
  try { return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
  catch { return ''; }
}

function LegacyPostedTab() {
  const [posts, setPosts] = useState(readPostLog);
  if (!posts.length) {
    return (
      <div>
        <p className="hist-empty">Nothing posted yet.</p>
        <p className="hist-note">Finish Stage 3 and every post lands here — remove entries, edit and repost from this list.</p>
      </div>
    );
  }
  return (
    <div>
      {posts.map((p) => (
        <div key={p.at} className="hist-row">
          <span className="hist-ic"><BrandIcon id={p.platform} size={15} /></span>
          <span className="hist-body">
            <b>{p.text ? (p.text.length > 90 ? p.text.slice(0, 90) + '…' : p.text) : p.platform}</b>
            <small>{fmtDate(p.at)}{p.url ? ' · ' : ''}{p.url && <a href={p.url} target="_blank" rel="noreferrer">View</a>}</small>
          </span>
          <button
            type="button"
            className="hist-mini danger"
            title="Removes this entry from the list only — the live post stays up"
            onClick={() => {
              removePostLog(p.at);
              setPosts(readPostLog());
            }}
          >
            Remove
          </button>
        </div>
      ))}
      <p className="hist-note">Removing clears this list only — live posts stay up on the platform.</p>
    </div>
  );
}

export function PostedTab({ token }) {
  const [posts, setPosts] = useState(readPostLog);
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState('');
  const [scheduleRows, setScheduleRows] = useState([]);
  const [scheduleError, setScheduleError] = useState('');
  const [scheduleBusy, setScheduleBusy] = useState('');
  const [deleteDialog, setDeleteDialog] = useState(null);
  const [selectedDeleteTargets, setSelectedDeleteTargets] = useState([]);
  const refresh = () => setPosts(readPostLog());
  const getTargets = (post) => Array.isArray(post.publishedPosts) && post.publishedPosts.length
    ? post.publishedPosts
    : (post.postId && post.connectionId ? [{ platform: post.platform, postId: post.postId, connectionId: post.connectionId }] : []);
  const targetKey = (target) => `${target.platform}:${target.connectionId}:${target.postId}`;
  useEffect(() => {
    let active = true;
    const load = () => listSchedules(token, { history: true })
      .then((data) => { if (active) { setScheduleRows(data); setScheduleError(''); } })
      .catch((error) => { if (active) setScheduleError(error.message || 'Could not load scheduled posts.'); });
    void load();
    const timer = window.setInterval(load, 15_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [token]);
  const openDeleteDialog = (post) => {
    const targets = getTargets(post);
    setDeleteDialog(post);
    setSelectedDeleteTargets(targets.filter((target) => ['facebook', 'youtube', 'x'].includes(target.platform)).map(targetKey));
    setNotice('');
  };
  const closeDeleteDialog = () => {
    if (busy !== null) return;
    setDeleteDialog(null);
    setSelectedDeleteTargets([]);
  };
  const deleteLive = async () => {
    const post = deleteDialog;
    if (!post) return;
    const allTargets = getTargets(post);
    const selected = allTargets.filter((target) => selectedDeleteTargets.includes(targetKey(target)) && ['facebook', 'youtube', 'x'].includes(target.platform));
    if (!selected.length) return;
    setBusy(post.at);
    try {
      const result = await api('/api/posts', token, { method: 'DELETE', body: JSON.stringify({ posts: selected }) });
      const failed = result.results.filter((r) => !r.ok);
      // The delete endpoint returns platform + postId (not connectionId).
      const deletedKeys = new Set(result.results.filter((r) => r.ok).map((r) => `${r.platform}:${r.postId}`));
      const remaining = allTargets.filter((target) => !deletedKeys.has(`${target.platform}:${target.postId}`));
      if (!remaining.length) {
        removePostLog(post.at);
      } else {
        updatePostLog(post.at, {
          publishedPosts: remaining,
          ...(remaining.length === 1 ? { platform: remaining[0].platform, postId: remaining[0].postId, connectionId: remaining[0].connectionId } : {}),
        });
      }
      refresh();
      const failedDetails = failed.map((r) => `${r.platform}: ${r.error}`).join(' ');
      const skipped = allTargets.length - selected.length;
      const summary = result.deleted
        ? `${result.deleted} selected platform post${result.deleted === 1 ? '' : 's'} deleted${failed.length ? `; ${failed.length} failed` : ''}${skipped ? `; ${skipped} unselected` : ''}.`
        : `No selected platform posts were deleted${skipped ? `; ${skipped} unselected` : ''}.`;
      setNotice([summary, failedDetails].filter(Boolean).join(' '));
      setDeleteDialog(null);
      setSelectedDeleteTargets([]);
    } catch (e) {
      setNotice(e.message || 'Could not delete the post. It is still in History.');
    } finally {
      setBusy(null);
    }
  };
  const cancelScheduled = async (id) => {
    setScheduleBusy(id);
    try {
      await cancelSchedule(token, id);
      setScheduleRows((rows) => rows.map((row) => row.id === id ? { ...row, status: 'cancelled' } : row));
      setNotice('Scheduled post cancelled.');
    } catch (error) { setNotice(error.message || 'Could not cancel this scheduled post.'); }
    finally { setScheduleBusy(''); }
  };
  const scheduleHistory = [...scheduleRows].sort((a, b) => Date.parse(b.updated_at || b.scheduled_at) - Date.parse(a.updated_at || a.scheduled_at));
  return <div>
    <section className="hist-activity">
      <div className="hist-activity-head"><h2>Scheduled posts</h2><span>{scheduleHistory.length}</span></div>
      {scheduleError && <p className="hist-note" role="status">Could not refresh scheduled posts: {scheduleError}</p>}
      {!scheduleHistory.length && <p className="hist-note">No scheduled posts yet. New and completed scheduled posts will appear here.</p>}
      {scheduleHistory.map((row) => {
        const when = new Date(row.scheduled_at);
        const label = row.status === 'published' ? 'Published' : row.status === 'failed' ? 'Failed' : row.status === 'cancelled' ? 'Cancelled' : row.status === 'publishing' ? 'Publishing…' : 'Scheduled';
        const tone = row.status === 'published' ? 'ok' : row.status === 'failed' ? 'fail' : '';
        return <div key={row.id} className="hist-row">
          <span className="hist-ic"><BrandIcon id={row.platform} size={15} /></span>
          <span className="hist-body"><b>{row.platform[0].toUpperCase() + row.platform.slice(1)}{row.result_url ? ' · ' : ''}{row.result_url && <a href={row.result_url} target="_blank" rel="noreferrer">View post</a>}</b>
            <small>{when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · {when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} · <span className={tone ? `hist-status ${tone}` : ''}>{label}</span></small>
            {row.error && <small className="hist-error">{row.error}</small>}
          </span>
          {['scheduled', 'publishing'].includes(row.status) && <button type="button" className="hist-mini danger" disabled={scheduleBusy === row.id} onClick={() => cancelScheduled(row.id)}>{scheduleBusy === row.id ? 'Cancelling…' : 'Cancel'}</button>}
        </div>;
      })}
    </section>
    {!posts.length && <><p className="hist-empty">Nothing posted yet.</p><p className="hist-note">Posts published after delete support was added can be deleted from the platform here.</p></>}
    {posts.map((p) => {
      const targets = getTargets(p);
      const canDelete = targets.length > 0;
      return <div key={p.at} className="hist-row">
        <span className="hist-ic"><BrandIcon id={p.platform} size={15} /></span>
        <span className="hist-body">
          <b>{p.text ? (p.text.length > 90 ? p.text.slice(0, 90) + '…' : p.text) : p.platform}</b>
          <small>{fmtDate(p.at)}{p.url ? ' · ' : ''}{p.url && <a href={p.url} target="_blank" rel="noreferrer">View</a>}</small>
        </span>
        {canDelete && <button type="button" className="hist-mini danger" disabled={busy === p.at} title="Choose which platforms to delete this post from" onClick={() => openDeleteDialog(p)}>
          {busy === p.at ? 'Deleting…' : 'Delete post'}
        </button>}
        <button type="button" className="hist-mini" title="Remove this entry from this browser only; it does not delete the live platform post" onClick={() => { removePostLog(p.at); refresh(); }}>Remove from History</button>
      </div>;
    })}
    {notice && <p className="hist-note" role="status">{notice}</p>}
    <p className="hist-note">Scheduled publishing appears above. Platform deletion is selected per destination; Instagram posts must be deleted in Instagram. Remove from History only clears this browser’s entry.</p>
    {deleteDialog && <div className="hist-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDeleteDialog(); }}>
      <section className="hist-delete-modal" role="dialog" aria-modal="true" aria-labelledby="hist-delete-title">
        <h2 id="hist-delete-title">Choose platforms to delete from</h2>
        <p>Select only the platform copies you want removed. This cannot be undone.</p>
        <div className="hist-delete-options">
          {getTargets(deleteDialog).map((target, index) => {
            const key = targetKey(target);
            const supported = ['facebook', 'youtube', 'x'].includes(target.platform);
            const samePlatformCount = getTargets(deleteDialog).filter((item) => item.platform === target.platform).length;
            const occurrence = getTargets(deleteDialog).slice(0, index).filter((item) => item.platform === target.platform).length + 1;
            const label = target.platform[0].toUpperCase() + target.platform.slice(1) + (samePlatformCount > 1 ? ` account ${occurrence}` : '');
            return <label className={`hist-delete-option ${supported ? '' : 'unsupported'}`} key={key}>
              <input type="checkbox" checked={selectedDeleteTargets.includes(key)} disabled={!supported || busy !== null}
                onChange={(event) => setSelectedDeleteTargets((current) => event.target.checked ? [...current, key] : current.filter((value) => value !== key))} />
              <BrandIcon id={target.platform} size={17} />
              <span><b>{label}</b><small>{supported ? 'Delete this platform copy' : 'Delete directly in Instagram; API deletion is unavailable'}</small></span>
            </label>;
          })}
        </div>
        <div className="hist-delete-actions">
          <button type="button" className="hist-mini" disabled={busy !== null} onClick={closeDeleteDialog}>Cancel</button>
          <button type="button" className="hist-mini danger" disabled={!selectedDeleteTargets.length || busy !== null} onClick={deleteLive}>{busy !== null ? 'Deleting…' : 'Delete selected'}</button>
        </div>
      </section>
    </div>}
  </div>;
}

function ScheduledTab({ token }) {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    const load = () => listSchedules(token)
      .then((data) => { if (active) { setRows(data); setError(''); } })
      .catch((e) => { if (active) setError(e.message || 'Could not load scheduled posts.'); });
    void load();
    // Refresh platform-side schedule outcomes while History is open. The API
    // worker publishes independently, so a one-time fetch left stale states
    // on screen and made completed schedules look stuck.
    const timer = window.setInterval(load, 15_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [token]);

  if (rows === null && error) return <div><p className="hist-note" role="alert">{error}</p><button type="button" className="hist-mini" onClick={() => { setError(''); listSchedules(token).then(setRows).catch((e) => setError(e.message || 'Could not load scheduled posts.')); }}>Retry</button></div>;
  if (rows === null) return <p className="hist-empty">Loading scheduled posts…</p>;
  if (!rows.length) {
    return (
      <div>
        {error && <p className="hist-note" role="status">Schedule status refresh failed: {error}</p>}
        <p className="hist-empty">Nothing scheduled.</p>
        <p className="hist-note">In Stage 3, press “Schedule instead” and we publish automatically at the time you pick.</p>
      </div>
    );
  }
  return (
    <div>
      {error && <p className="hist-note" role="status">Schedule status refresh failed: {error}. Retrying automatically.</p>}
      {rows.map((r) => {
        const when = new Date(r.scheduled_at);
        const whenText = `${when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
        const tone = r.status === 'published' ? 'ok' : r.status === 'failed' ? 'fail' : '';
        const label = r.status === 'published' ? 'Published' : r.status === 'failed' ? 'Failed' : r.status === 'cancelled' ? 'Cancelled' : r.status === 'publishing' ? 'Publishing…' : 'Scheduled';
        return (
          <div key={r.id} className="hist-row">
            <span className="hist-ic"><BrandIcon id={r.platform} size={15} /></span>
            <span className="hist-body">
              <b>{r.platform[0].toUpperCase() + r.platform.slice(1)}{r.result_url ? ' · ' : ''}
                {r.result_url && <a href={r.result_url} target="_blank" rel="noreferrer">View post</a>}
              </b>
              <small>{whenText} · <span className={tone ? `hist-status ${tone}` : ''}>{label}</span></small>
              {r.error && <small style={{ display: 'block', color: 'var(--danger, #e5484d)' }}>{r.error}</small>}
            </span>
            {['scheduled', 'publishing'].includes(r.status) && (
              <button
                type="button"
                className="hist-mini danger"
                disabled={busy === r.id}
                onClick={async () => {
                  setBusy(r.id);
                  try { await cancelSchedule(token, r.id); load(); }
                  catch (e) { setError(e.message || 'Could not cancel this schedule.'); }
                  finally { setBusy(''); }
                }}
              >
                {busy === r.id ? '…' : 'Cancel'}
              </button>
            )}
          </div>
        );
      })}
      <p className="hist-note">Scheduled posts publish on their own — keep the page closed if you like.</p>
    </div>
  );
}

export function DeletedTab({ token }) {
  const [items, setItems] = useState(readDisconnectLog);
  const [busy, setBusy] = useState('');
  const refresh = () => setItems(readDisconnectLog());

  const reconnect = async (platform) => {
    setBusy(platform);
    try {
      const data = await api(`/api/oauth/${platform}/start`, token, { method: 'POST' });
      window.location.assign(data.url);
    } catch (e) {
      alert(e.message || 'Reconnect failed.');
      setBusy('');
    }
  };

  if (!items.length) {
    return (
      <div>
        <p className="hist-empty">No disconnected accounts.</p>
        <p className="hist-note">Swipe an account left in Create Groups to disconnect it — it lands here for reconnecting.</p>
      </div>
    );
  }
  return (
    <div>
      {items.map((d) => (
        <div key={d.at} className="hist-row">
          <span className="hist-ic"><BrandIcon id={d.platform} size={15} /></span>
          <span className="hist-body">
            <b>{d.account_name}</b>
            <small>{d.platform} · disconnected {fmtDate(d.at)}</small>
          </span>
          <button type="button" className="hist-mini" disabled={!!busy} onClick={() => reconnect(d.platform)}>
            {busy === d.platform ? '…' : 'Reconnect'}
          </button>
          <button type="button" className="hist-mini danger" onClick={() => { removeDisconnectLog(d.at); refresh(); }}>Forget</button>
        </div>
      ))}
      <p className="hist-note">Reconnect verifies the account again with the platform.</p>
    </div>
  );
}

export function CaptionsTab({ userId }) {
  const [items] = useState(() => readCaptionLog(userId));
  const [copied, setCopied] = useState(0);
  const copy = async (text, at) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(at);
      setTimeout(() => setCopied(0), 1500);
    } catch {}
  };
  if (!items.length) {
    return (
      <div>
        <p className="hist-empty">No saved captions yet.</p>
        <p className="hist-note">Generate content in Stage 2 — your 50 most recent captions appear here automatically.</p>
      </div>
    );
  }
  return (
    <div>
      {items.map((c) => (
        <div key={`${c.at}-${c.platform}`} className="hist-row hist-cap">
          <span className="hist-ic"><BrandIcon id={c.platform} size={15} /></span>
          <span className="hist-body">
            <b>{c.text.length > 110 ? c.text.slice(0, 110) + '…' : c.text}</b>
            <small>{c.brand || c.platform} · {fmtDate(c.at)}</small>
          </span>
          <button type="button" className="hist-mini" onClick={() => copy(c.text, c.at)}>
            {copied === c.at ? 'Copied ✓' : 'Copy'}
          </button>
        </div>
      ))}
    </div>
  );
}

export default function HistoryPage({ session, onNavigate, onSignOut }) {
  const [tab, setTab] = useState('posted');
  const canUseAi = hasAiAccess(session);
  const tabs = canUseAi ? TABS : TABS.filter((t) => t.id !== 'captions');
  useEffect(() => {
    if (!canUseAi && tab === 'captions') setTab('posted');
  }, [canUseAi, tab]);
  return (
    <>
    <WorkspaceNav page="history" onNavigate={onNavigate} email={session.user?.email} onSignOut={onSignOut} />
    <div className="hist">
      <div className="hist-in">
        <div className="hist-heading"><h1>History</h1><p>{canUseAi ? 'Find published work, scheduled posts, saved captions and accounts.' : 'Find published work, scheduled posts and accounts.'}</p></div>
        <div className="hist-tabs" role="tablist" aria-label="History sections">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={tab === t.id ? 'hist-tab on' : 'hist-tab'}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        {tab === 'posted' && <PostedTab token={session.access_token} />}
        {tab === 'scheduled' && <ScheduledTab token={session.access_token} />}
        {tab === 'deleted' && <DeletedTab token={session.access_token} />}
        {canUseAi && tab === 'captions' && <CaptionsTab userId={session.user.id} />}
      </div>
    </div>
    </>
  );
}
