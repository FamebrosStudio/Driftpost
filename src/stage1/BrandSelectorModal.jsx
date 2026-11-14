import React, { useEffect, useState } from 'react';
import BorderGlow from '../components/reactbits/BorderGlow.jsx';
import BrandIcon from '../brand.jsx';
import { matchesSearchText } from '../lib.js';

const ORDER = ['instagram', 'facebook', 'youtube', 'x'];

// Option 1 tool: pick one brand that already holds several platform accounts.
export default function BrandSelectorModal({ brands, connections, activeKey, onPick, onClose }) {
  const [q, setQ] = useState('');
  useEffect(() => {
    const h = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const accountNames = new Map((connections || []).map((c) => [c.id, c.account_name || '']));
  const list = q.trim() ? brands.filter((b) => {
    const names = [b.label, ...Object.values(b.map || {}).map((id) => accountNames.get(id) || '')];
    return matchesSearchText(q, names);
  }) : brands;

  return (
    <div className="s1-overlay" onClick={onClose}>
      <BorderGlow asChild className="bg-glow-control" backgroundColor="#071019" borderRadius={0} glowColor="199 95 74" colors={['#7dd3fc', '#4dc3f7', '#a5ddfa']} fillOpacity={0.12} glowRadius={12}><div className="s1-modal" role="dialog" aria-modal="true" aria-label="Choose a brand" onClick={(e) => e.stopPropagation()}>
        <h2>Choose a brand</h2>
        <p className="sub">One brand, all its connected platforms together. Posting stays on that brand&apos;s accounts only.</p>
        <input className="s1-search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your brands" aria-label="Search your brands" />
        {list.map((b) => {
          const plats = ORDER.filter((pid) => b.map[pid]);
          return (
            <BorderGlow key={b.key} asChild className="btn-glow" backgroundColor="#071019" borderRadius={0} glowColor="199 95 74" colors={['#7dd3fc', '#4dc3f7', '#a5ddfa']} fillOpacity={0.3} glowRadius={12}><button  type="button" onClick={() => onPick(b.key)} className={b.key === activeKey || b.keys?.includes(activeKey) ? 's1-brand cur' : 's1-brand'}>
              <span className="bmeta">
                <b>{b.label}</b>
                <small>Connected Accounts: {plats.length}</small>
              </span>
              <span className="s1-icons">
                {plats.map((pid) => <BrandIcon key={pid} id={pid} size={15} />)}
              </span>
            </button></BorderGlow>
          );
        })}
        {!list.length && <p className="s1-empty">{brands.length ? 'No brand matches that search.' : 'No accounts connected yet — connect accounts first, then pick a brand here.'}</p>}
        <BorderGlow asChild className="btn-glow" backgroundColor="#071019" borderRadius={0} glowColor="199 95 74" colors={['#7dd3fc', '#4dc3f7', '#a5ddfa']} fillOpacity={0.3} glowRadius={12}><button type="button" className="s1-ghost" onClick={onClose}>Cancel</button></BorderGlow>
      </div></BorderGlow>
    </div>
  );
}
