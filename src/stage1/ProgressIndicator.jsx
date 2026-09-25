import React from 'react';

// 3-step progress: filled dot behind, ring on current, animated track.
const STEPS = ['Account Setup', 'Content Setup', 'Publishing'];

export default function ProgressIndicator({ current = 1 }) {
  return (
    <div className="s1-progress">
      <ol>
        {STEPS.map((label, i) => {
          const n = i + 1;
          const cls = n < current ? 's1-step done' : n === current ? 's1-step cur' : 's1-step';
          return (
            <li key={label} className={cls} aria-current={n === current ? 'step' : undefined}>
              <span className="dot">{n < current ? '✓' : n}</span>
              <small>{label}</small>
            </li>
          );
        })}
      </ol>
      <div className="s1-track" aria-hidden="true"><i style={{ width: `${(current / 3) * 100}%` }} /></div>
    </div>
  );
}
