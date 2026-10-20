import test from 'node:test';
import assert from 'node:assert/strict';
import { platformsNeedingGeneratedCovers } from '../src/telegram-intake.js';

test('photo carousels do not require generated video cover frames', () => {
  assert.deepEqual(platformsNeedingGeneratedCovers(true, ['facebook', 'instagram']), []);
});

test('video cover generation is limited to platforms that support selected covers', () => {
  assert.deepEqual(
    platformsNeedingGeneratedCovers(false, ['facebook', 'x', 'instagram', 'facebook']),
    ['facebook', 'instagram'],
  );
});
