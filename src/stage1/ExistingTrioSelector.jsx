import React from 'react';

// Option 4 tool: reuse a trio built earlier. One select, names visible.
export default function ExistingTrioSelector({ trios, activeId, accountName, onPick }) {
  if (!trios.length) {
    return <p className="s1-empty">No trios yet — build one in “Create Trios” first, then pick it here.</p>;
  }
  return (
    <div role="radiogroup" aria-label="Your created trios">
      {trios.map((t) => {
        const on = t.id === activeId;
        const names = (t.accountIds || []).map((id) => accountName(id)).filter(Boolean);
        return (
          <button key={t.id} type="button" role="radio" aria-checked={on} onClick={() => onPick(t.id)} className={on ? 'trio-radio on' : 'trio-radio'}>
            <span className="rdo" aria-hidden="true" />
            <span>
              <b>{t.name}</b>
              <small>{names.length ? names.join(' · ') : 'Accounts were disconnected'}</small>
            </span>
          </button>
        );
      })}
    </div>
  );
}
