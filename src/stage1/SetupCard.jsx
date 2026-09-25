import React from 'react';

// Single-select option card. Radio semantics + keyboard support.
// Expands with its tool UI only when selected; otherwise just the card.
export default function SetupCard({ id, selected, onSelect, icon, title, summary, children }) {
  return (
    <div
      role="radio"
      aria-checked={!!selected}
      tabIndex={0}
      onClick={() => onSelect(id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(id); }
      }}
      className={selected ? 'setup-card sel' : 'setup-card'}
    >
      <span className="setup-check" aria-hidden="true">✓</span>
      <span className="setup-icon" aria-hidden="true">{icon}</span>
      <h2>{title}</h2>
      <p className="sum">{summary}</p>
      {selected && (
        <div className="setup-body" onClick={(e) => e.stopPropagation()}>
          {children}
        </div>
      )}
    </div>
  );
}
