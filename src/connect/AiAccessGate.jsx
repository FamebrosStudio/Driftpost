import React, { useEffect, useState } from 'react';
import { api } from '../lib.js';
import { AI_ACCESS_HEADER, clearAiGrant, isAiAccount, readAiGrant, saveAiGrant } from '../ai-access.js';
import './ai-access.css';

export default function AiAccessGate({ session, children }) {
  const userId = session?.user?.id;
  const allowed = isAiAccount(session?.user?.email);
  const [state, setState] = useState(allowed ? 'checking' : 'ready');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!allowed || !userId) {
      setState('ready');
      return undefined;
    }
    let live = true;
    const grant = readAiGrant(userId);
    if (!grant) {
      setState('locked');
      return undefined;
    }
    setState('checking');
    api('/api/ai/access', session.access_token, {
      headers: { [AI_ACCESS_HEADER]: grant },
    }).then(() => {
      if (live) setState('ready');
    }).catch(() => {
      clearAiGrant(userId);
      if (live) setState('locked');
    });
    return () => { live = false; };
  }, [allowed, session?.access_token, userId]);

  const unlock = async (event) => {
    event.preventDefault();
    if (busy || !password) return;
    setBusy(true);
    setError('');
    try {
      const result = await api('/api/ai/unlock', session.access_token, {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
      if (!saveAiGrant(userId, result.grant)) {
        setError('This browser could not remember the unlock. Check its storage settings and try again.');
        return;
      }
      setPassword('');
      setState('ready');
    } catch (e) {
      setError(e.message || 'Access could not be verified. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (!allowed || state === 'ready') return children;
  if (state === 'checking') {
    return <div className="ai-lock"><div className="ai-lock-card" aria-busy="true">Checking access…</div></div>;
  }

  return (
    <main className="ai-lock">
      <form className="ai-lock-card" onSubmit={unlock}>
        <h1>AI access</h1>
        <p>Enter the one-time access password for this browser. This browser will remember the unlock for this account.</p>
        <label htmlFor="ai-access-password">Access password</label>
        <input
          id="ai-access-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoFocus
          required
        />
        {error && <p className="ai-lock-error" role="alert">{error}</p>}
        <button type="submit" disabled={busy || !password}>{busy ? 'Checking…' : 'Unlock AI access'}</button>
      </form>
    </main>
  );
}
