import React, { useEffect, useState } from 'react';
import BrandIcon from '../brand.jsx';

const ORDER = ['instagram', 'facebook', 'youtube', 'x'];

// Option 1 tool: pick one brand that already holds several platform accounts.
export default function BrandSelectorModal({ brands, activeKey, onPick, onClose }) {
  const [q, setQ] = useState('');
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const needle = q.trim().toLowerCase();
  const list = needle ? brands.filter((b) => b.label.toLowerCase().includes(needle)) : brands;

  return (
    <div className="s1-overlay" onClick={onClose}>
      <div className="s1-modal" role="dialog" aria-modal="true" aria-label="Choose a brand" onClick={(e) => e.stopPropagation()}>
        <h2>Choose a brand</h2>
        <p className="sub">One brand, all its connected platforms together. Posting stays on that brand&apos;s accounts only.</p>
        <input className="s1-search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your brands" aria-label="Search your brands" />
        {list.map((b) => {
          const plats = ORDER.filter((pid) => b.map[pid]);
          return (
            <button key={b.key} type="button" onClick={() => onPick(b.key)} className={b.key === activeKey ? 's1-brand cur' : 's1-brand'}>
              <span className="bmeta">
                <b>{b.label}</b>
                <small>Connected Accounts: {plats.length}</small>
              </span>
              <span className="s1-icons">
                {plats.map((pid) => <BrandIcon key={pid} id={pid} size={15} />)}
              </span>
            </button>
          );
        })}
        {!list.length && <p className="s1-empty">{brands.length ? 'No brand matches that search.' : 'No accounts connected yet — connect accounts first, then pick a brand here.'}</p>}
        <button type="button" className="s1-ghost" onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}
