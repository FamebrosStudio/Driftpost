import React from 'react';
import PlatformOutputCard from './PlatformOutputCard.jsx';

// Section 3: one card per Stage-1-selected platform. Nothing more.
export default function OutputContainer({ platforms, outputs, onSave, regen, onRegen, busy }) {
  if (!platforms.length) return null;
  return (
    <div className="s2-out-grid">
      {platforms.map((pid) => (
        <PlatformOutputCard
          key={pid}
          pid={pid}
          values={outputs[pid] || {}}
          onSave={onSave}
          regenning={regen === pid}
          regenBusy={busy || !!regen}
          onRegen={onRegen}
        />
      ))}
    </div>
  );
}
