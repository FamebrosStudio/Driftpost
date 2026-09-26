import React, { useEffect, useState } from 'react';
import BrandIcon from '../brand.jsx';
import { api } from '../lib.js';
import { readDisconnectLog, removeDisconnectLog, readCaptionLog, readPostLog, removePostLog } from './log.js';
import { listSchedules, cancelSchedule } from '../lib.js';
import './history.css';

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

export function PostedTab() {
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

function ScheduledTab({ token }) {
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState('');

  const load = () => {
    listSchedules(token).then(setRows).catch(() => setRows([]));
  };
  useEffect(load, [token]);

  if (rows === null) return <p className="hist-empty">Loading scheduled posts…</p>;
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
                  try { await cancelSchedule(token, r.id); } catch {}
                  load();
                  setBusy('');
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
        <p className="hist-note">Generate content in Stage 2 — every caption is kept here automatically.</p>
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

export default function HistoryPage({ session, onBack }) {
  const [tab, setTab] = useState('posted');
  return (
    <div className="hist">
      <div className="hist-in">
        <div className="hist-top">
          <button type="button" className="hist-back" onClick={onBack}>← Back</button>
          <b>History</b>
          <span style={{ width: 60 }} />
        </div>
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
        {tab === 'posted' && <PostedTab />}
        {tab === 'scheduled' && <ScheduledTab token={session.access_token} />}
        {tab === 'deleted' && <DeletedTab token={session.access_token} />}
        {tab === 'captions' && <CaptionsTab />}
      </div>
    </div>
  );
}
