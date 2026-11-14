import React, { useEffect, useState } from 'react';
import { api } from '../lib.js';
import { clearAiGrant, hasAiAccess, isAiAccount, readAiGrant, saveAiGrant } from '../ai-access.js';

// AI is enabled only for the approved team accounts. The browser grant is
// device-local, so explicitly ask for the team passphrase on a new browser
// and verify an existing grant before trusting it.
export default function AiAccessGate({ children, session }) {
  const userId = session?.user?.id || '';
  const accessToken = session?.access_token || '';
  const eligible = isAiAccount(session?.user?.email);
  const [unlocked, setUnlocked] = useState(false);
  const [checking, setChecking] = useState(Boolean(eligible && userId && hasAiAccess(session)));
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    if (!eligible || !userId) {
      setChecking(false);
      setUnlocked(false);
      setOpen(false);
      return () => { live = false; };
    }
    const grant = readAiGrant(userId);
    if (!grant) {
      setChecking(false);
      setUnlocked(false);
      setOpen(true);
      return () => { live = false; };
    }
    setChecking(true);
    api('/api/ai/access', accessToken)
      .then(() => {
        if (!live) return;
        setUnlocked(true);
        setOpen(false);
        setError('');
      })
      .catch(() => {
        clearAiGrant(userId);
        if (!live) return;
        setUnlocked(false);
        setOpen(true);
      })
      .finally(() => { if (live) setChecking(false); });
    return () => { live = false; };
  }, [eligible, userId, accessToken]);

  const unlock = async (event) => {
    event.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError('');
    try {
      const { grant } = await api('/api/ai/unlock', accessToken, {
        method: 'POST',
        body: JSON.stringify({ password }),
      });
      if (!grant || !saveAiGrant(userId, grant)) {
        throw new Error('This browser could not save the AI access grant. Allow local storage and try again.');
      }
      setPassword('');
      setUnlocked(true);
      setOpen(false);
    } catch (cause) {
      setError(cause.message || 'Could not unlock AI access. Check the passphrase and try again.');
    } finally {
      setBusy(false);
    }
  };

  return <>
    {children}
    {eligible && !checking && !unlocked && !open && (
      <button className="ai-unlock-reminder" type="button" onClick={() => setOpen(true)}>
        Unlock AI captions
      </button>
    )}
    {eligible && !checking && !unlocked && open && (
      <div className="ai-unlock-backdrop">
        <section className="ai-unlock-card" role="dialog" aria-modal="true" aria-labelledby="ai-unlock-title">
          <p className="ai-unlock-kicker">Driftpost AI</p>
          <h2 id="ai-unlock-title">Unlock AI on this browser</h2>
          <p>Enter the team AI passphrase once on this browser to generate and refine captions.</p>
          <form onSubmit={unlock}>
            <label htmlFor="ai-unlock-password">AI unlock passphrase</label>
            <input
              autoFocus
              id="ai-unlock-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              disabled={busy}
            />
            {error && <p className="ai-unlock-error" role="alert">{error}</p>}
            <button className="ai-unlock-submit" type="submit" disabled={busy || !password}>
              {busy ? 'Unlocking…' : 'Unlock AI captions'}
            </button>
          </form>
          <button className="ai-unlock-later" type="button" onClick={() => { setError(''); setOpen(false); }} disabled={busy}>
            Continue without AI for now
          </button>
          <p className="ai-unlock-note">The passphrase is checked by Driftpost and is never saved in this browser.</p>
        </section>
      </div>
    )}
  </>;
}
