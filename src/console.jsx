import React from 'react';

// Console removed for a full rebuild — placeholder only.
// Keeps the App shell + auth flow building while the new console is designed.
export default function Console({ session, onSwitchAccount, onSignOut }) {
  void onSwitchAccount;
  return (
    <div className="shell">
      <div className="main">
        <div className="top">
          <div><h1>Console</h1><p>Being rebuilt — more perfect soon</p></div>
        </div>
        <div className="page">
          <div className="card" style={{ maxWidth: 560 }}>
            <h3>Console cleared</h3>
            <p className="sub">
              {session?.user?.email ? `Signed in as ${session.user.email}. ` : ''}
              The old console (composer, accounts, liquid background) is fully removed. Rebuild starts from zero.
            </p>
            <button className="skew-btn ghost" onClick={onSignOut}><span>Sign out</span></button>
          </div>
        </div>
      </div>
    </div>
  );
}
