import React from 'react';
import BorderGlow from './components/reactbits/BorderGlow.jsx';

export default class AppErrorBoundary extends React.Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    console.error('[Driftpost] Page failed to render:', error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="app-error" role="alert">
        <BorderGlow asChild className="bg-glow-control" backgroundColor="#071019" borderRadius={0} glowColor="199 95 74" colors={['#7dd3fc', '#4dc3f7', '#a5ddfa']} fillOpacity={0.12} glowRadius={12}><section className="app-error-card">
          <span className="app-error-mark" aria-hidden="true">!</span>
          <h1>This page didn’t finish loading</h1>
          <p>Any work saved before the error is still on this device. Reload to try again.</p>
          <div className="app-error-actions">
            <BorderGlow asChild className="btn-glow" backgroundColor="#071019" borderRadius={0} glowColor="199 95 74" colors={['#7dd3fc', '#4dc3f7', '#a5ddfa']} fillOpacity={0.3} glowRadius={12}><button type="button" onClick={() => window.location.reload()}>Reload page</button></BorderGlow>
            <a href="/">Go to home</a>
          </div>
        </section></BorderGlow>
      </main>
    );
  }
}
