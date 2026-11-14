import React, { useEffect } from 'react';
import BorderGlow from '../components/reactbits/BorderGlow.jsx';
import ConnectPage from './ConnectPage.jsx';
import './connect.css';

// First-run welcome: shown ONCE per browser (flag driftpost-welcome-v1).
// The key never existed before, so every existing user sees this exactly
// once too. It wraps the full Connect hub — connect every account,
// disconnect any time, see ALL accounts across all 4 platforms — with a
// short intro on top. Continue (or Skip) dismisses it forever.
export default function WelcomePage({ session, onHistory, onSignOut, onContinue, onSkip }) {
  useEffect(() => { document.title = 'Welcome · Driftpost'; }, []);
  return (
    <div className="welcome">
      <BorderGlow asChild className="bg-glow-control" backgroundColor="#071019" borderRadius={0} glowColor="199 95 74" colors={['#7dd3fc', '#4dc3f7', '#a5ddfa']} fillOpacity={0.12} glowRadius={12}><div className="welcome-in">
        <div className="welcome-top">
          <span className="cn-badge">Welcome · one-time setup</span>
          <BorderGlow asChild className="btn-glow" backgroundColor="#071019" borderRadius={0} glowColor="199 95 74" colors={['#7dd3fc', '#4dc3f7', '#a5ddfa']} fillOpacity={0.3} glowRadius={12}><button type="button" className="cn-link" onClick={onSkip}>Skip intro →</button></BorderGlow>
        </div>
        <header className="welcome-head">
          <h1>All your accounts, one screen.</h1>
          <p>
            Link YouTube, Instagram, Facebook and X below — every account you
            connect shows up here and follows you into posting. Disconnect any
            of them any time; nothing else changes.
          </p>
        </header>
        <div className="welcome-steps" aria-label="How Driftpost works">
          <span><b>01</b> Connect every account below</span>
          <span><b>02</b> Pick a brand or bundle a group</span>
          <span><b>03</b> Write once, fire everywhere</span>
        </div>
      </div></BorderGlow>
      <ConnectPage
        session={session}
        onContinue={onContinue}
        onHistory={onHistory}
        onSignOut={onSignOut}
      />
    </div>
  );
}
