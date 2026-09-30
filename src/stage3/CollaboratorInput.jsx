import React, { useMemo, useState } from 'react';

export default function CollaboratorInput({ value, onChange, accounts = [] }) {
  const [open, setOpen] = useState(false);
  const matches = useMemo(() => [...new Map(accounts
    .map((account) => ({ account, username: String(account.account_name || '').replace(/^@/, '').trim() }))
    .filter(({ account, username }) => username && (username.toLowerCase().includes(String(value || '').replace(/^@/, '').toLowerCase()) || String(account.platform_account_id || '').includes(String(value || '').trim())))
    .map((match) => [match.username.toLowerCase(), match])).values()], [accounts, value]);
  return <div className="s3-collab-picker">
    <input value={value || ''} onChange={(event) => { onChange(event.target.value); setOpen(true); }} onFocus={() => setOpen(true)} onBlur={() => window.setTimeout(() => setOpen(false), 120)} onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); }} placeholder="Type a username or account ID" autoComplete="off" aria-autocomplete="list" aria-expanded={open && matches.length > 0} />
    {open && matches.length > 0 && <div className="s3-collab-options" role="listbox">{matches.slice(0, 8).map(({ account, username }) => <button key={account.id} type="button" role="option" onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(username); setOpen(false); }}><span>@{username}</span><small>{account.platform_account_id ? `ID ${account.platform_account_id}` : account.account_name}</small></button>)}</div>}
  </div>;
}
