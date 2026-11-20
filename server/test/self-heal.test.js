import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyRecoverableError } from '../src/self-heal.js';

test('classifyRecoverableError detects transient network, rate-limit, and 5xx errors', () => {
  assert.equal(classifyRecoverableError(new Error('429 Too Many Requests')).recoverable, true);
  assert.equal(classifyRecoverableError(new Error('Upstream returned 503 Service Unavailable')).recoverable, true);
  assert.equal(classifyRecoverableError(new Error('fetch failed: ECONNRESET')).recoverable, true);
  assert.equal(classifyRecoverableError(new Error('Request timed out after 30000ms')).recoverable, true);
});

test('classifyRecoverableError does not retry permanent validation or auth errors', () => {
  assert.equal(classifyRecoverableError(new Error('Private team access required.')).recoverable, false);
  assert.equal(classifyRecoverableError(new Error('The video duration could not be read.')).recoverable, false);
});
