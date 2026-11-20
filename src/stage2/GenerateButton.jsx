import React from 'react';
import BorderGlow from '../components/reactbits/BorderGlow.jsx';

// Big generate CTA with AI loading state, cursor-proximity glow and shimmer.
export default function GenerateButton({ disabled, busy, onClick }) {
  return (
    <BorderGlow className="btn-glow ws-btn-glow s2-generate-glow" backgroundColor="#071019" borderRadius={0} glowColor="199 95 74" colors={['#7dd3fc', '#4dc3f7', '#a5ddfa']} fillOpacity={0.3} glowRadius={22}>
      <button type="button" className={`s2-generate${busy ? ' is-busy' : ''}`} disabled={disabled} onClick={onClick}>
        {busy && <span className="s2-spin" aria-hidden="true" />}
        <span className="s2-generate-label">{busy ? 'Generating…' : 'Generate Content'}</span>
        <i className="s2-generate-shine" aria-hidden="true" />
      </button>
    </BorderGlow>
  );
}
