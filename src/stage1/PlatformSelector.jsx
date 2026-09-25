import React from 'react';
import BrandIcon from '../brand.jsx';
import { PLATFORMS } from '../lib.js';

// Option 2 tool: platform pills only. Multi-select, minimum 1.
// Platforms with no account stay grey and unclickable: with a brand picked,
// only that brand's connected platforms count; otherwise any connected one.
export default function PlatformSelector({ selected, counts, brand, onToggle }) {
  return (
    <div className="plat-pills" role="group" aria-label="Select platforms">
      {PLATFORMS.map((p) => {
        const on = selected.includes(p.id);
        const ok = brand ? !!brand.map[p.id] : (counts[p.id] || 0) > 0;
        const title = !ok
          ? (brand ? `No ${p.name} account under ${brand.label}` : `No ${p.name} account connected yet`)
          : `${counts[p.id] || 0} connected`;
        return (
          <button
            key={p.id}
            type="button"
            aria-pressed={on}
            disabled={!ok}
            title={title}
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
