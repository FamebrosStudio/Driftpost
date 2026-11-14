import React from 'react';
import BorderGlow from '../components/reactbits/BorderGlow.jsx';

// Big generate CTA with AI loading state.
export default function GenerateButton({ disabled, busy, onClick }) {
  return (
    <BorderGlow asChild className="btn-glow" backgroundColor="#071019" borderRadius={0} glowColor="199 95 74" colors={['#7dd3fc', '#4dc3f7', '#a5ddfa']} fillOpacity={0.3} glowRadius={12}><button type="button" className="s2-generate" disabled={disabled} onClick={onClick}>
      {busy && <span className="s2-spin" aria-hidden="true" />}
      <span>{busy ? 'Generating…' : 'Generate Content'}</span>
    </button></BorderGlow>
  );
}
