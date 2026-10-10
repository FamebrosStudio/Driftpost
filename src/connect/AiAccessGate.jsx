import React from 'react';

// Keep the main workspace reachable for approved team members. AI actions
// remain protected by server-side account checks and the team workflow scope.
export default function AiAccessGate({ children }) {
  return children;
}
