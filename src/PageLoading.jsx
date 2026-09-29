import React from 'react';

export default function PageLoading({ label = 'Loading this page…' }) {
  return (
    <main className="page-loading" role="status" aria-live="polite">
      <span className="page-loading-mark" aria-hidden="true" />
      <span>{label}</span>
    </main>
  );
}
