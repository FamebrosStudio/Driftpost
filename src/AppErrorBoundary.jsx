import React from 'react';

export default class AppErrorBoundary extends React.Component {
  state = { failed: false, error: null, componentStack: '' };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    console.error('[Driftpost] Page failed to render:', error, info.componentStack);
    this.setState({ error, componentStack: info.componentStack || '' });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="app-error" role="alert">
        <section className="app-error-card">
          <span className="app-error-mark" aria-hidden="true">!</span>
          <h1>This page didn’t finish loading</h1>
          <p>Any work saved before the error is still on this device. Reload to try again.</p>
          {this.state.error && (
            <details className="app-error-details" open>
              <summary>Technical details — send this to support</summary>
              <pre>{[
                `${this.state.error.name || 'Error'}: ${this.state.error.message || 'Unknown render error'}`,
                this.state.error.stack,
                this.state.componentStack && `React component stack:${this.state.componentStack}`,
              ].filter(Boolean).join('\n\n')}</pre>
            </details>
          )}
          <div className="app-error-actions">
            <button type="button" onClick={() => window.location.reload()}>Reload page</button>
            <a href="/">Go to home</a>
          </div>
        </section>
      </main>
    );
  }
}
