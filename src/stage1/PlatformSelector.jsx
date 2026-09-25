import React from 'react';
import BrandIcon from '../brand.jsx';
import { PLATFORMS } from '../lib.js';

// Option 2 tool: platform pills only. Multi-select, minimum 1.
export default function PlatformSelector({ selected, counts, onToggle }) {
  return (
    <div className="plat-pills" role="group" aria-label="Select platforms">
      {PLATFORMS.map((p) => {
        const on = selected.includes(p.id);
        const n = counts[p.id] || 0;
        return (
          <button
            key={p.id}
            type="button"
            aria-pressed={on}
            title={n ? `${n} connected` : 'Not connected yet'}
            className={on ? 'plat-pill on' : 'plat-pill'}
            onClick={() => onToggle(p.id)}
          >
            <BrandIcon id={p.id} size={15} />
            {p.name}
            {on && <span className="pill-check" aria-hidden="true">✓</span>}
          </button>
        );
      })}
    </div>
  );
}
