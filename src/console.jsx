import React from 'react';
import StageOnePage from './stage1/StageOnePage.jsx';

// Console entry — Stage 1 only. Later stages mount here when specified.
export default function Console({ session, onSwitchAccount, onSignOut }) {
  void onSwitchAccount;
  return <StageOnePage session={session} onSignOut={onSignOut} />;
}
