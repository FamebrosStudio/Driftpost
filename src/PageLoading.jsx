import React, { useEffect, useState } from 'react';

export default function PageLoading({ label = 'Loading this page…' }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 12_000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <main className="page-loading" role="status" aria-live="polite">
      <span className="page-loading-mark" aria-hidden="true" />
      <span>{label}</span>
      {slow && (
        <div className="page-loading-recovery">
          <p>This is taking longer than expected. Reload Driftpost to retry this page.</p>
          <button type="button" onClick={() => window.location.reload()}>Reload page</button>
          <a href="/">Go to home</a>
        </div>
      )}
    </main>
  );
}
