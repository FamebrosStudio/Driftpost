import React from 'react';

export default function ContinueButton({ disabled, saved, onClick }) {
  return (
    <div className="s2-continue-bar">
      <button type="button" className="s2-continue-btn" disabled={disabled} onClick={onClick}>
        <span>{saved ? 'Saved ✓' : 'Continue'}</span>
      </button>
      {disabled && <p className="s2-continue-hint">Add media or generate content to continue</p>}
    </div>
  );
}
