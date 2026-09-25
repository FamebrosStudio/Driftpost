import React from 'react';
import BrandIcon from '../brand.jsx';

const NAMES = { instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube', x: 'X' };

// One tab per Stage-1-selected platform. Status: reviewed / posted / failed.
export default function PlatformTabs({ platforms, tab, setTab, statusOf, greyed }) {
  return (
    <div className="s3-tabs" role="tablist" aria-label="Platforms — open each to review">
      {platforms.map((pid) => {
        const st = statusOf(pid);
        const g = greyed(pid);
        return (
          <button
            key={pid}
            type="button"
            role="tab"
            aria-selected={tab === pid}
            className={tab === pid ? 's3-tab on' : g ? 's3-tab greyed' : 's3-tab'}
            onClick={() => setTab(pid)}
            title={g ? 'Skipped — covered by cross-post' : NAMES[pid]}
          >
            <BrandIcon id={pid} size={15} />
            {NAMES[pid]}
            {st === 'reviewed' && <span className="st ok">✓</span>}
            {st === 'scheduled' && <span className="st ok">Scheduled</span>}
            {st === 'posted' && <span className="st ok">Posted</span>}
            {st === 'failed' && <span className="st bad">Failed</span>}
          </button>
        );
      })}
    </div>
  );
}
