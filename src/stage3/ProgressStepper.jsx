import React from 'react';

const STEPS = ['Account Setup', 'Content Setup', 'Publishing'];

export default function ProgressStepper({ current = 3 }) {
  return (
    <div className="s3-progress">
      <ol>
        {STEPS.map((label, i) => {
          const n = i + 1;
          const cls = n < current ? 's3-step done' : n === current ? 's3-step cur' : 's3-step';
          return (
            <li key={label} className={cls} aria-current={n === current ? 'step' : undefined}>
              <span className="dot">{n < current ? '✓' : n}</span>
              <small>{label}</small>
            </li>
          );
        })}
      </ol>
      <div className="s3-track" aria-hidden="true"><i style={{ width: `${(current / 3) * 100}%` }} /></div>
    </div>
  );
}
