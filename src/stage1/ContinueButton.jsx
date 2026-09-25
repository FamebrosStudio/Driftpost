import React from 'react';

// Fixed bottom CTA. Disabled until the setup choice is complete.
export default function ContinueButton({ disabled, saved, onClick }) {
  return (
    <div className="continue-bar">
      <button type="button" className="continue-btn" disabled={disabled} onClick={onClick}>
        <span>{saved ? 'Saved ✓' : 'Continue'}</span>
      </button>
      {disabled && <p className="continue-hint">Select one option above to continue</p>}
    </div>
  );
}
