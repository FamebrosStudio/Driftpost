import React from 'react';

const STEPS = ['Account Setup', 'Content Setup', 'Publishing'];

export default function ProgressStepper({ current = 2, onStep }) {
  return (
    <div className="s2-progress">
      <ol>
        {STEPS.map((label, i) => {
          const n = i + 1;
          const cls = n < current ? 's2-step done' : n === current ? 's2-step cur' : 's2-step';
          return (
            <li key={label} className={cls} aria-current={n === current ? 'step' : undefined}>
              <button type="button" className="progress-step-button" disabled={!onStep || n > current} onClick={() => onStep?.(n)} aria-label={`Go to ${label}`}>
              <span className="dot">{n < current ? '✓' : n}</span>
              <small>{label}</small>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="s2-track" aria-hidden="true"><i style={{ width: `${(current / 3) * 100}%` }} /></div>
    </div>
  );
}
