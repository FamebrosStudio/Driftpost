import React from 'react';
import BorderGlow from '../components/reactbits/BorderGlow.jsx';

// Option 4 tool: reuse a group built earlier. One select, member names visible.
// Dead groups (all accounts disconnected) can be deleted — otherwise they
// would brick this option with no way out.
export default function ExistingGroupSelector({ groups, activeId, accountName, onPick, onDelete }) {
  if (!groups.length) {
    return <p className="s1-empty">No groups yet — build one in “Create Groups” first, then pick it here.</p>;
  }
  const del = (g) => {
    if (window.confirm(`Delete group “${g.name}”? Your accounts stay connected.`)) onDelete?.(g.id);
  };
  return (
    <div role="radiogroup" aria-label="Your created groups">
      {groups.map((g) => {
        const on = g.id === activeId;
        const names = (g.accountIds || []).map((id) => accountName(id)).filter(Boolean);
        return (
          <div key={g.id} className="trio-line">
            <BorderGlow asChild className="btn-glow" backgroundColor="#071019" borderRadius={0} glowColor="199 95 74" colors={['#7dd3fc', '#4dc3f7', '#a5ddfa']} fillOpacity={0.3} glowRadius={12}><button type="button" role="radio" aria-checked={on} onClick={() => onPick(g.id)} className={on ? 'trio-radio on' : 'trio-radio'}>
              <span className="rdo" aria-hidden="true" />
              <span>
                <b>{g.name}</b>
                <small>{names.length ? names.join(' · ') : 'Accounts were disconnected'}</small>
              </span>
            </button></BorderGlow>
            {onDelete && (
              <BorderGlow asChild className="btn-glow" backgroundColor="#071019" borderRadius={0} glowColor="199 95 74" colors={['#7dd3fc', '#4dc3f7', '#a5ddfa']} fillOpacity={0.3} glowRadius={12}><button type="button" className="s1-mini danger" title={`Delete ${g.name}`} onClick={() => del(g)}>✕</button></BorderGlow>
            )}
          </div>
        );
      })}
    </div>
  );
}
