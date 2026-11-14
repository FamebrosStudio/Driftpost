import React, { useEffect, useState } from 'react';
import BorderGlow from './components/reactbits/BorderGlow.jsx';

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
          <BorderGlow asChild className="btn-glow" backgroundColor="#071019" borderRadius={0} glowColor="199 95 74" colors={['#7dd3fc', '#4dc3f7', '#a5ddfa']} fillOpacity={0.3} glowRadius={12}><button type="button" onClick={() => window.location.reload()}>Reload page</button></BorderGlow>
          <a href="/">Go to home</a>
        </div>
      )}
    </main>
  );
}
