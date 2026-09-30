import React, { useEffect, useState } from 'react';
import BrandIcon from '../brand.jsx';
import { api } from '../lib.js';
import { readDisconnectLog, removeDisconnectLog, readCaptionLog, readPostLog, removePostLog, updatePostLog } from './log.js';
import { listSchedules, cancelSchedule } from '../lib.js';
import './history.css';
import { WorkspaceNav } from '../workspace/Workspace.jsx';

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
  const refresh = () => setPosts(readPostLog());
  const getTargets = (post) => Array.isArray(post.publishedPosts) && post.publishedPosts.length
    ? post.publishedPosts
    : (post.postId && post.connectionId ? [{ platform: post.platform, postId: post.postId, connectionId: post.connectionId }] : []);
  const deleteLive = async (post) => {
    const targets = getTargets(post);
    const deletable = targets.filter((p) => ['facebook', 'youtube', 'x'].includes(p.platform));
    if (!deletable.length) {
      setNotice('Instagram does not allow deleting published media through its official API. Delete it in Instagram, then use Forget here.');
      return;
    }
    const names = [...new Set(deletable.map((p) => p.platform))].join(', ');
    if (!window.confirm(`Permanently delete this post${deletable.length > 1 ? 's' : ''} from ${names}? This cannot be undone.`)) return;
    setBusy(post.at);
    setNotice('');
    try {
      const result = await api('/api/posts', token, { method: 'DELETE', body: JSON.stringify({ posts: targets }) });
      const failed = result.results.filter((r) => !r.ok);
      if (!failed.length) {
        removePostLog(post.at);
        refresh();
        setNotice('Post deleted from the platform and removed from History.');
      } else {
        const deletedIds = new Set(result.results.filter((r) => r.ok).map((r) => `${r.platform}:${r.postId}`));
        const remaining = targets.filter((p) => !deletedIds.has(`${p.platform}:${p.postId}`));
        updatePostLog(post.at, {
          publishedPosts: remaining,
          ...(remaining.length === 1 ? { platform: remaining[0].platform, postId: remaining[0].postId, connectionId: remaining[0].connectionId } : {}),
        });
        refresh();
        setNotice(`${result.deleted} post${result.deleted === 1 ? '' : 's'} deleted. ${failed.map((r) => r.error).join(' ')}`);
      }
    } catch (e) {
      setNotice(e.message || 'Could not delete the post. It is still in History.');
    } finally {
      setBusy(null);
    }
  };
  if (!posts.length) return <div><p className="hist-empty">Nothing posted yet.</p><p className="hist-note">Posts published after delete support was added can be deleted from the platform here.</p></div>;
  return <div>
    {posts.map((p) => {
      const targets = getTargets(p);
      const canDelete = targets.some((x) => ['facebook', 'youtube', 'x'].includes(x.platform));
      const hasInstagram = targets.some((x) => x.platform === 'instagram');
      return <div key={p.at} className="hist-row">
        <span className="hist-ic"><BrandIcon id={p.platform} size={15} /></span>
        <span className="hist-body">
          <b>{p.text ? (p.text.length > 90 ? p.text.slice(0, 90) + '…' : p.text) : p.platform}</b>
          <small>{fmtDate(p.at)}{p.url ? ' · ' : ''}{p.url && <a href={p.url} target="_blank" rel="noreferrer">View</a>}</small>
        </span>
        {canDelete && <button type="button" className="hist-mini danger" disabled={busy === p.at} title="Permanently delete the published post from its platform" onClick={() => deleteLive(p)}>
          {busy === p.at ? 'Deleting…' : 'Delete post'}
        </button>}
        {hasInstagram && <button type="button" className="hist-mini" onClick={() => setNotice('Instagram does not allow deleting published media through its official API. Open View and delete it in Instagram.')}>Delete on Instagram</button>}
        <button type="button" className="hist-mini" title="Remove this History entry only; the live post stays up" onClick={() => { removePostLog(p.at); refresh(); }}>Forget</button>
      </div>;
    })}
    {notice && <p className="hist-note" role="status">{notice}</p>}
    <p className="hist-note">Delete post permanently removes supported posts from the platform. Forget only clears this History entry. Instagram posts must be deleted in Instagram.</p>
  </div>;
}

function ScheduledTab({ token }) {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const load = () => {
    setError('');
    listSchedules(token).then(setRows).catch((e) => { setError(e.message || 'Could not load scheduled posts.'); setRows([]); });
  };
  useEffect(load, [token]);

  if (rows === null) return <p className="hist-empty">Loading scheduled posts…</p>;
  if (error) return <div><p className="hist-note" role="alert">{error}</p><button type="button" className="hist-mini" onClick={load}>Retry</button></div>;
  if (!rows.length) {
    return (
      <div>
        <p className="hist-empty">Nothing scheduled.</p>
        <p className="hist-note">In Stage 3, press “Schedule instead” and we publish automatically at the time you pick.</p>
      </div>
    );
  }
  return (
    <div>
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

export function CaptionsTab() {
  const [items] = useState(readCaptionLog);
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
  return (
    <>
    <WorkspaceNav page="history" onNavigate={onNavigate} email={session.user?.email} onSignOut={onSignOut} />
    <div className="hist">
      <div className="hist-in">
        <div className="hist-heading"><h1>History</h1><p>Find published work, scheduled posts, saved captions and accounts.</p></div>
        <div className="hist-tabs" role="tablist" aria-label="History sections">
          {TABS.map((t) => (
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
        {tab === 'captions' && <CaptionsTab />}
      </div>
    </div>
    </>
  );
}
