import React, { useEffect, useMemo, useRef, useState } from 'react';
import { searchInstagramCollaborators } from '../lib.js';

const compact = (n) => {
  const value = Number(n || 0);
  if (value >= 1e6) return `${(value / 1e6).toFixed(1).replace(/\.0$/, '')}M followers`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1).replace(/\.0$/, '')}K followers`;
  return `${value} followers`;
};

// Connected accounts match instantly. Anything else is resolved through Meta
// once typing settles, so the picker offers accounts the user has never
// connected. Meta only matches an exact handle, so a partial name shows the
// connected list until it becomes a real handle.
export default function CollaboratorInput({ value, onChange, accounts = [], token = '', connectionId = '' }) {
  const [open, setOpen] = useState(false);
  const [remote, setRemote] = useState([]);
  const [searching, setSearching] = useState(false);
  const [note, setNote] = useState('');
  const pending = useRef('');

  const local = useMemo(() => [...new Map(accounts
    .map((account) => ({ account, username: String(account.account_name || '').replace(/^@/, '').trim() }))
    .filter(({ account, username }) => username && (username.toLowerCase().includes(String(value || '').replace(/^@/, '').toLowerCase()) || String(account.platform_account_id || '').includes(String(value || '').trim())))
    .map((match) => [match.username.toLowerCase(), match])).values()], [accounts, value]);

  const typed = String(value || '').replace(/^@+/, '').trim().toLowerCase();
  // An exact connected hit needs no lookup — it already carries the ID.
  const hasExactLocal = local.some((match) => match.username.toLowerCase() === typed);

  useEffect(() => {
    if (!token || typed.length < 2 || hasExactLocal) {
      pending.current = '';
      setRemote([]);
      setNote('');
      setSearching(false);
      return undefined;
    }
    const handle = typed;
    const timer = setTimeout(() => {
      pending.current = handle;
      setSearching(true);
      searchInstagramCollaborators(token, { connectionId, query: handle })
        .then((found) => {
          if (pending.current !== handle) return;
          setRemote(found || []);
          setNote('');
        })
        .catch((e) => {
          if (pending.current !== handle) return;
          setRemote([]);
          // Never block typing: the handle still goes through by hand.
          setNote(e?.message || 'Instagram could not confirm that account. Check the username, or keep typing the exact handle.');
        })
        .finally(() => { if (pending.current === handle) setSearching(false); });
    }, 400);
    return () => clearTimeout(timer);
  }, [typed, hasExactLocal, token, connectionId]);

  const options = [
    ...local.map(({ account, username }) => ({
      key: username.toLowerCase(),
      username,
      detail: account.platform_account_id ? `ID ${account.platform_account_id}` : account.account_name,
    })),
    ...remote
      .filter((account) => !local.some((match) => match.username.toLowerCase() === String(account.username || '').toLowerCase()))
      .map((account) => ({
        key: `ig:${account.platform_account_id}`,
        username: account.username,
        detail: [account.name, compact(account.followers_count)].filter(Boolean).join(' · '),
      })),
  ];

  return <div className="s3-collab-picker">
    <input value={value || ''} onChange={(event) => { onChange(event.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => window.setTimeout(() => setOpen(false), 120)} onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); }} placeholder="Type an Instagram username" autoComplete="off" aria-autocomplete="list" aria-expanded={open && options.length > 0} />
    {open && (options.length > 0 || searching || note) && <div className="s3-collab-options" role="listbox">
      {options.slice(0, 8).map((option) => <button key={option.key} type="button" role="option" onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(option.username); setOpen(false); }}><span>@{option.username}</span>{option.detail && <small>{option.detail}</small>}</button>)}
      {searching && options.length === 0 && <p className="s3-collab-status">Checking Instagram…</p>}
      {note && <p className="s3-collab-status">{note}</p>}
    </div>}
  </div>;
}
