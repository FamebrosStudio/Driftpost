import React, { useEffect, useMemo, useRef, useState } from 'react';
import { matchesSearchText } from '../lib.js';
import { searchInstagramCollaborators } from '../lib.js';

const compact = (n) => {
  const value = Number(n || 0);
  if (value >= 1e6) return `${(value / 1e6).toFixed(1).replace(/\.0$/, '')}M followers`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1).replace(/\.0$/, '')}K followers`;
  return `${value} followers`;
};

const splitHandles = (value) => [...new Map(String(value || '')
  .split(/[\s,;]+/)
  .map((name) => [name.trim().replace(/^@+/, '').toLowerCase(), name.trim().replace(/^@+/, '')])
  .filter(([key]) => key)
  .map(([key, name]) => [key, name])).values()];

const shortId = (id) => {
  const value = String(id || '');
  return value.length > 14 ? `${value.slice(0, 10)}…${value.slice(-4)}` : value;
};

const MISS_TEXT = {
  'not-found': 'no ID — will tag by username',
  permission: 'Meta permission missing — add instagram_manage_insights to the Facebook Login for Business configuration, then reconnect Instagram.',
  unavailable: 'Meta could not answer — will tag by username',
  'no-connection': 'connect an Instagram account to resolve',
};

// Connected accounts match instantly. Anything else is resolved through Meta
// once typing settles, so the picker offers accounts the user has never
// connected and shows the account ID each handle resolved to. Meta only matches
// an exact handle, so a partial name shows the connected list until it becomes
// a real handle.
export default function CollaboratorInput({ value, onChange, accounts = [], token = '', connectionId = '' }) {
  const [open, setOpen] = useState(false);
  const [remote, setRemote] = useState([]);
  const [searching, setSearching] = useState(false);
  const [note, setNote] = useState('');
  const pending = useRef('');

  const connected = useMemo(() => new Map(accounts
    .map((account) => ({ account, username: String(account.account_name || '').replace(/^@/, '').trim() }))
    .filter(({ username }) => username)
    .map(({ account, username }) => [username.toLowerCase(), account])), [accounts]);

  const local = useMemo(() => [...new Map(accounts
    .map((account) => ({ account, username: String(account.account_name || '').replace(/^@/, '').trim() }))
    .filter(({ account, username }) => username && matchesSearchText(value, username, account.account_name, account.platform_account_id))
    .map((match) => [match.username.toLowerCase(), match])).values()], [accounts, value]);

  const handles = useMemo(() => splitHandles(value), [value]);
  // Meta matches whole handles, so a half-typed one is held back until it is
  // long enough to be a real username.
  const wanted = useMemo(() => handles.filter((handle) => handle.length >= 2).map((h) => h.toLowerCase()), [handles]);
  const wantedKey = wanted.join(',');
  // A single handle that is already connected needs no lookup — it carries the ID.
  const hasExactLocal = wanted.length === 1 && connected.has(wanted[0]);

  useEffect(() => {
    if (!token || !wantedKey || (wanted.length === 1 && hasExactLocal)) {
      pending.current = '';
      setRemote([]);
      setNote('');
      setSearching(false);
      return undefined;
    }
    const handle = wantedKey;
    const timer = setTimeout(() => {
      pending.current = handle;
      setSearching(true);
      searchInstagramCollaborators(token, { connectionId, query: wantedKey })
        .then((found) => {
          if (pending.current !== handle) return;
          setRemote(found || []);
          setNote('');
        })
        .catch((e) => {
          if (pending.current !== handle) return;
          setRemote([]);
          // Never block typing: the handle still goes through by hand.
          setNote(e?.message || 'Instagram could not confirm those accounts. Check the usernames, or keep typing the exact handles.');
        })
        .finally(() => { if (pending.current === handle) setSearching(false); });
    }, 400);
    return () => clearTimeout(timer);
  }, [wantedKey, hasExactLocal, token, connectionId]);

  const remoteByHandle = useMemo(() => new Map(remote
    .map((result) => [String(result.username || '').toLowerCase(), result])), [remote]);

  const resolved = useMemo(() => wanted.map((key) => {
    const name = handles.find((handle) => handle.toLowerCase() === key)?.replace(/^@+/, '') || key;
    const local_ = connected.get(key);
    if (local_?.platform_account_id) return { key, name, id: String(local_.platform_account_id), source: 'connected' };
    const hit = remoteByHandle.get(key);
    if (hit?.account?.platform_account_id) return { key, name, id: String(hit.account.platform_account_id), source: 'meta' };
    if (hit) return { key, name, id: '', source: hit.reason || 'not-found' };
    if (searching) return { key, name, id: '', source: 'checking' };
    return null;
  }).filter(Boolean), [wanted, handles, connected, remoteByHandle, searching]);

  const typedAll = new Set(wanted);
  const options = [
    ...local.filter(({ username }) => !typedAll.has(username.toLowerCase())).map(({ account, username }) => ({
      key: username.toLowerCase(),
      username,
      detail: account.platform_account_id ? `ID ${account.platform_account_id}` : account.account_name,
    })),
    ...remote
      // Keep an exact Meta match visible even though it is already typed: the
      // result is useful confirmation and can be selected without losing the
      // other handles in a multi-collaborator entry.
      .filter((result) => result.account)
      .map((result) => ({
        key: `ig:${result.account.platform_account_id}`,
        username: result.account.username,
        detail: [result.account.name, compact(result.account.followers_count)].filter(Boolean).join(' · '),
      })),
  ];

  const addHandle = (username) => {
    const current = splitHandles(value);
    if (current.some((handle) => handle.toLowerCase() === String(username).toLowerCase())) return;
    onChange([...current, username].join(', '));
  };

  return <div className="s3-collab-picker">
    <input value={value || ''} onChange={(event) => { onChange(event.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => window.setTimeout(() => setOpen(false), 120)} onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); }} placeholder="Type exact Instagram @usernames (up to 3)" autoComplete="off" aria-autocomplete="list" aria-expanded={open && options.length > 0} />
    {resolved.length > 0 && <ul className="s3-collab-ids">
      {resolved.map((entry) => <li key={entry.key} className={entry.id ? `ok ${entry.source}` : entry.source}>
        <span className="handle">@{entry.name}</span>
        {entry.id
          ? <span className="id" title={`Instagram account ID ${entry.id}`}>{shortId(entry.id)}</span>
          : <span className="miss">{entry.source === 'checking' ? 'Checking Instagram…' : (MISS_TEXT[entry.source] || 'will tag by username')}</span>}
      </li>)}
    </ul>}
    {open && (options.length > 0 || searching || note) && <div className="s3-collab-options" role="listbox">
      {options.slice(0, 8).map((option) => <button key={option.key} type="button" role="option" onMouseDown={(event) => event.preventDefault()} onClick={() => { addHandle(option.username); setOpen(false); }}><span>@{option.username}</span>{option.detail && <small>{option.detail}</small>}</button>)}
      {searching && options.length === 0 && <p className="s3-collab-status">Checking Instagram…</p>}
      {note && <p className="s3-collab-status">{note}</p>}
    </div>}
  </div>;
}
