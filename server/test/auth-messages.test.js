import test from 'node:test';
import assert from 'node:assert/strict';
import { friendlyAuthError } from '../../src/authMessages.js';

test('auth provider failures become actionable user-facing messages', () => {
  assert.match(friendlyAuthError(new Error('Invalid login credentials')), /email and password do not match/i);
  assert.match(friendlyAuthError(new Error('Email not confirmed')), /confirm your email/i);
  assert.match(friendlyAuthError(new Error('User already registered')), /already exists/i);
  assert.match(friendlyAuthError(new TypeError('Failed to fetch')), /internet connection/i);
});

test('unknown auth failures do not expose provider implementation details', () => {
  const message = friendlyAuthError(new Error('gateway at private.internal failed with trace abc123'));
  assert.match(message, /contact support/i);
  assert.doesNotMatch(message, /private\.internal|abc123/);
});
