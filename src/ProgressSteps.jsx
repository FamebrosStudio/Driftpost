import React from 'react';
import BorderGlow from './components/reactbits/BorderGlow.jsx';
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
              <BorderGlow asChild className="btn-glow" backgroundColor="#071019" borderRadius={0} glowColor="199 95 74" colors={['#7dd3fc', '#4dc3f7', '#a5ddfa']} fillOpacity={0.3} glowRadius={12}><button type="button" disabled={!complete || !onStep} onClick={() => onStep?.(number)} aria-label={complete ? `Return to ${label}` : `${label}${number === step ? ', current step' : ''}`}>
                <span className="progress-steps__number" aria-hidden="true">{complete ? '✓' : number}</span>
                <span className="progress-steps__label">{label}</span>
              </button></BorderGlow>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
