import React from 'react';
import './progress-steps.css';

const STEPS = ['Accounts', 'Content', 'Review & publish'];

export default function ProgressSteps({ current = 1, onStep }) {
  const step = Math.min(3, Math.max(1, Number(current) || 1));
  return (
    <nav className="progress-steps" aria-label="Post creation progress">
      <ol>
        {STEPS.map((label, index) => {
          const number = index + 1;
          const complete = number < step;
          return (
            <li className={number === step ? 'is-current' : complete ? 'is-complete' : ''} key={label} aria-current={number === step ? 'step' : undefined}>
              <button type="button" disabled={!complete || !onStep} onClick={() => onStep?.(number)} aria-label={complete ? `Return to ${label}` : `${label}${number === step ? ', current step' : ''}`}>
                <span className="progress-steps__number" aria-hidden="true">{complete ? '✓' : number}</span>
                <span className="progress-steps__label">{label}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <div className="progress-steps__mobile" aria-live="polite">
        <span>Step {step} of 3</span>
        <strong>{STEPS[step - 1]}</strong>
      </div>
      <div className="progress-steps__track" aria-hidden="true"><i style={{ width: `${((step - 1) / 2) * 100}%` }} /></div>
    </nav>
  );
}
