import React from 'react';

// Option 4 tool: reuse a group built earlier. One select, member names visible.
export default function ExistingGroupSelector({ groups, activeId, accountName, onPick }) {
  if (!groups.length) {
    return <p className="s1-empty">No groups yet — build one in “Create Groups” first, then pick it here.</p>;
  }
  return (
    <div role="radiogroup" aria-label="Your created groups">
      {groups.map((g) => {
        const on = g.id === activeId;
        const names = (g.accountIds || []).map((id) => accountName(id)).filter(Boolean);
        return (
          <button key={g.id} type="button" role="radio" aria-checked={on} onClick={() => onPick(g.id)} className={on ? 'trio-radio on' : 'trio-radio'}>
            <span className="rdo" aria-hidden="true" />
            <span>
              <b>{g.name}</b>
              <small>{names.length ? names.join(' · ') : 'Accounts were disconnected'}</small>
            </span>
          </button>
        );
      })}
    </div>
  );
}
