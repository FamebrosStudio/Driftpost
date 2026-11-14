import React from 'react';

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
        <section className="app-error-card">
          <span className="app-error-mark" aria-hidden="true">!</span>
          <h1>This page didn’t finish loading</h1>
          <p>Any work saved before the error is still on this device. Reload to try again.</p>
          <div className="app-error-actions">
            <button type="button" onClick={() => window.location.reload()}>Reload page</button>
            <a href="/">Go to home</a>
          </div>
        </section>
      </main>
    );
  }
}
