import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFfprobeDuration } from '../src/intake-processor.js';

test('parseFfprobeDuration handles numeric, N/A, and HH:MM:SS.sss durations', () => {
  assert.equal(parseFfprobeDuration('12.345'), 12.345);
  assert.equal(parseFfprobeDuration(8.5), 8.5);
  assert.equal(parseFfprobeDuration('00:01:23.450000000'), 83.45);
  assert.equal(parseFfprobeDuration('N/A'), 0);
  assert.equal(parseFfprobeDuration(''), 0);
  assert.equal(parseFfprobeDuration(-2), 0);
});
