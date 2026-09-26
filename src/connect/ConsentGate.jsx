import React, { useEffect, useState } from 'react';
import { api } from '../lib.js';
import './consent.css';

const POINTS = [
  ['Your prompts and captions', 'We store the text you type and the captions we generate for you, tied to your account and the brand.'],
  ['Personal identifiers removed', 'Before anything is stored we strip email addresses, phone numbers, long numbers and anything that looks like a password or API key.'],
  ['A brand\'s public contact details are kept', 'A confirmed business phone or address in a caption footer is part of the post, so it is not treated as personal data.'],
  ['Only used to sound like you', 'Approved captions are shown back to the AI as examples for you, on your account only. No model is retrained and nothing is shared with other users.'],
  ['Revoke any time', 'You can turn this off and delete everything stored. The app keeps working exactly the same, it just stops learning.'],
];

// Consent gate: decides whether to show the choice screen or the app.
//
// Until a decision is on record the console is not shown at all, so nobody
// can generate a single post before being told what happens to their text.
// The product itself does not depend on the answer - declining only turns off
// storage, and the full app renders identically afterwards.
export default function ConsentGate({ session, onOpenPage, children }) {
  const [opt, setOpt] = useState(false); // never pre-ticked
  const [state, setState] = useState(undefined); // undefined = still checking
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let live = true;
    api('/api/ai/consent', session.access_token)
      .then((d) => { if (live) setState(d); })
      .catch(() => {
        // Cannot verify consent, so we must ask rather than assume it.
        if (live) setState({ recorded: false, personalisation: false });
      });
    return () => { live = false; };
  }, [session.access_token]);

  const decide = async (grant) => {
    if (busy) return;
    setBusy(true); setErr('');
    try {
      await api('/api/ai/consent', session.access_token, {
        method: 'POST',
        body: JSON.stringify({ purpose: 'personalisation', granted: grant }),
      });
      setState((s) => ({ ...(s || {}), recorded: true, personalisation: grant }));
    } catch {
      setErr('We could not save that choice, so nothing will be stored.');
      // Still let them through: the app does not depend on this answer, and
      // the server stores nothing until a grant is actually recorded.
      setState((s) => ({ ...(s || {}), recorded: true, personalisation: false }));
    } finally {
      setBusy(false);
    }
  };

  if (state === undefined) return <div className="cg"><div className="cg-card" aria-busy="true">Checking your privacy settings…</div></div>;
  if (state?.recorded) return children;

  return (
    <div className="cg">
      <div className="cg-card">
        <h1>Before your first post</h1>
        <p className="cg-lede">
          Driftpost sends what you type to an AI provider (xAI) to write your posts. That is the
          service, and it is the only part that happens automatically. The choice below is
          separate and optional.
        </p>

        <div className="cg-required">
          <h2>Required to use Driftpost</h2>
          <p>
            We process the text you type, any media you attach and your connected account
            details in order to generate and publish your posts. Connected account tokens are
            encrypted at rest. This is not optional, and we do not store your prompts for this
            purpose.
          </p>
        </div>

        <div className="cg-optional">
          <h2>Optional: help the writing improve for you</h2>
          <ul>
            {POINTS.map(([t, d]) => (
              <li key={t}><b>{t}.</b> {d}</li>
            ))}
          </ul>

          <label className="cg-check">
            <input type="checkbox" checked={opt} onChange={(e) => setOpt(e.target.checked)} />
            <span>
              I allow Driftpost to store my prompts and generated captions, so that future posts
              for the same brand match my own voice.
            </span>
          </label>
        </div>

        <div className="cg-acts">
          <button type="button" className="go" onClick={() => decide(true)} disabled={!opt || busy}>
            {busy ? 'Saving…' : 'Agree and continue'}
          </button>
          <button type="button" onClick={() => decide(false)} disabled={busy}>
            {busy ? 'Saving…' : 'No thanks, just generate'}
          </button>
        </div>
        {err && <p className="cg-err">{err}</p>}

        <p className="cg-foot">
          <button type="button" className="link" onClick={() => onOpenPage?.('privacy')}>Read the full Privacy Notice</button>
          {' · '}
          <button type="button" className="link" onClick={() => onOpenPage?.('data-deletion')}>Delete my data</button>
          {state?.version ? <span className="cg-ver"> · notice {state.version}</span> : null}
        </p>
      </div>
    </div>
  );
}
