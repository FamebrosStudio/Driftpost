import test from 'node:test';
import assert from 'node:assert/strict';
import { canUsePrivateBrandData } from '../src/brand-access.js';

test('private brand access requires a verified internal account', () => {
  assert.equal(canUsePrivateBrandData({ email: 'famebros.studio@gmail.com', email_confirmed_at: '2026-01-01T00:00:00Z' }), true);
  assert.equal(canUsePrivateBrandData({ email: 'KABIRSAYED.K@GMAIL.COM', email_confirmed_at: '2026-01-01T00:00:00Z' }), true);
  assert.equal(canUsePrivateBrandData({ email: 'famebros.studio@gmail.com' }), false);
  assert.equal(canUsePrivateBrandData({ email: 'outsider@example.com', email_confirmed_at: '2026-01-01T00:00:00Z' }), false);
  assert.equal(canUsePrivateBrandData({ email: 'outsider@example.com', email_confirmed_at: '2026-01-01T00:00:00Z', brand_id: 'devi_company' }), false);
});
