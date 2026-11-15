import React from 'react';
import './progress-steps.css';

const STEPS = [
  { label: 'Destinations', sub: 'Choose brand or channels' },
  { label: 'Creative Studio', sub: 'Media, edit & AI captions' },
  { label: 'Review & Publish', sub: 'Final check & schedule' },
];

export default function ProgressSteps({ current = 1, onStep }) {
  const step = Math.min(3, Math.max(1, Number(current) || 1));
  const pct = step === 1 ? 33.33 : step === 2 ? 66.66 : 100;

  return (
    <nav className="progress-steps" aria-label="Post creation progress">
      <ol>
        {STEPS.map((item, index) => {
          const number = index + 1;
          const complete = number < step;
          const active = number === step;
          return (
            <li
              className={active ? 'is-current' : complete ? 'is-complete' : ''}
              key={item.label}
              aria-current={active ? 'step' : undefined}
            >
              <button
                type="button"
                className="progress-step-button"
                disabled={!complete || !onStep}
                onClick={() => onStep?.(number)}
                aria-label={complete ? `Return to ${item.label}` : `${item.label}${active ? ', current step' : ''}`}
              >
                <span className="progress-steps__number" aria-hidden="true">
                  {complete ? '✓' : number}
                </span>
                <span className="progress-steps__copy">
                  <span className="progress-steps__label">{item.label}</span>
                  <small className="progress-steps__sub">{item.sub}</small>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="progress-steps__track" aria-hidden="true">
        <i style={{ width: `${pct}%` }} />
      </div>
    </nav>
  );
}
