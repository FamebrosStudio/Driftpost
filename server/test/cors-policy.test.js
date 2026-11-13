import test from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedOrigin, normalizeHttpOrigin } from '../src/cors-policy.js';

test('CORS normalization ignores configured URL paths and trailing slashes', () => {
  assert.equal(normalizeHttpOrigin(' https://driftpost.vercel.app/console/ '), 'https://driftpost.vercel.app');
  assert.equal(isAllowedOrigin('https://driftpost.vercel.app', ['https://driftpost.vercel.app/']), true);
});

test('known Driftpost production frontends are allowed while unrelated origins remain blocked', () => {
  const known = ['https://driftpostpage.vercel.app', 'https://driftpost.vercel.app'];
  assert.equal(isAllowedOrigin('https://driftpostpage.vercel.app', [], known), true);
  assert.equal(isAllowedOrigin('https://driftpost.vercel.app', [], known), true);
  assert.equal(isAllowedOrigin('https://attacker.example', [], known), false);
  assert.equal(isAllowedOrigin(undefined, [], known), true);
});

test('CORS rejects non-HTTP origins', () => {
  assert.equal(isAllowedOrigin('javascript://driftpost.vercel.app'), false);
});
