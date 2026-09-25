import React from 'react';

// Big generate CTA with AI loading state.
export default function GenerateButton({ disabled, busy, onClick }) {
  return (
    <button type="button" className="s2-generate" disabled={disabled} onClick={onClick}>
      {busy && <span className="s2-spin" aria-hidden="true" />}
      <span>{busy ? 'Generating…' : 'Generate Content'}</span>
    </button>
  );
}
