import React from 'react';
import BorderGlow from '../components/reactbits/BorderGlow.jsx';

export default function ContinueButton({ disabled, saved, onClick }) {
  return (
    <div className="s2-continue-bar">
      <BorderGlow className="btn-glow ws-btn-glow" backgroundColor="#071019" borderRadius={0} glowColor="199 95 74" colors={['#7dd3fc', '#4dc3f7', '#a5ddfa']} fillOpacity={0.3} glowRadius={22}>
        <button type="button" className="s2-continue-btn" disabled={disabled} onClick={onClick}>
          <span>{saved ? 'Saved ✓' : 'Continue'}</span>
        </button>
      </BorderGlow>
      {disabled && <p className="s2-continue-hint">Add media or generate content to continue</p>}
    </div>
  );
}
