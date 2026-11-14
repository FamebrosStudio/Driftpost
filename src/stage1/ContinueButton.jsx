import React from 'react';
import BorderGlow from '../components/reactbits/BorderGlow.jsx';

// Fixed bottom CTA. Disabled until the setup choice is complete.
export default function ContinueButton({ disabled, saved, onClick }) {
  return (
    <div className="continue-bar">
      <BorderGlow asChild className="btn-glow" backgroundColor="#071019" borderRadius={0} glowColor="199 95 74" colors={['#7dd3fc', '#4dc3f7', '#a5ddfa']} fillOpacity={0.3} glowRadius={12}><button type="button" className="continue-btn" disabled={disabled} onClick={onClick}>
        <span>{saved ? 'Saved ✓' : 'Continue'}</span>
      </button></BorderGlow>
      {disabled && <p className="continue-hint">Select one option above to continue</p>}
    </div>
  );
}
