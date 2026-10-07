import test from 'node:test';
import assert from 'node:assert/strict';
import { deleteResultsStatus } from '../src/delete-results.js';

test('delete API reports all-success requests as OK', () => {
  assert.equal(deleteResultsStatus([{ ok: true }, { ok: true }]), 200);
});

test('delete API keeps provider failures and partial success out of 5xx handling', () => {
  assert.equal(deleteResultsStatus([{ ok: true }, { ok: false }]), 207);
  assert.equal(deleteResultsStatus([{ ok: false }]), 207);
});
