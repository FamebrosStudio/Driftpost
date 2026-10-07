import test from 'node:test';
import assert from 'node:assert/strict';
import { captionQualityIssue, requestedCaptionPlatforms } from '../src/ai.js';

const memory = { loadBrands: () => [] };
const valid = {
  youtube: { title: 'A considered look at this new collection', description: 'A new collection brings together thoughtful details and versatile pieces. Explore the style and find the one that feels right for you.' },
  instagram: { caption: 'A closer look at the details that make this collection feel special. Find a piece that fits your everyday style.' },
  facebook: { message: 'Thoughtful details, made for everyday moments. Take a closer look at the new collection and tell us which piece you would choose.' },
  x: { text: 'Thoughtful details for everyday style. Take a closer look at the new collection.' },
};

test('caption platform selection preserves explicit choices and rejects an empty selection', () => {
  assert.deepEqual(requestedCaptionPlatforms('["instagram","facebook","instagram"]'), ['instagram', 'facebook']);
  assert.deepEqual(requestedCaptionPlatforms('', ['x']), ['x']);
  assert.deepEqual(requestedCaptionPlatforms(''), ['youtube', 'instagram', 'facebook', 'x']);
  assert.throws(() => requestedCaptionPlatforms('[]'), /Choose at least one valid platform/);
  assert.throws(() => requestedCaptionPlatforms('["tiktok"]'), /Choose at least one valid platform/);
  assert.throws(() => requestedCaptionPlatforms('not-a-platform'), /Choose at least one valid platform/);
});

test('caption quality validation requires a usable YouTube title', () => {
  const draft = structuredClone(valid);
  draft.youtube.title = '';
  assert.equal(captionQualityIssue(draft, { platforms: ['youtube'], mem: memory }), 'youtube title is missing or too long');
  draft.youtube.title = 'A'.repeat(101);
  assert.equal(captionQualityIssue(draft, { platforms: ['youtube'], mem: memory }), 'youtube title is missing or too long');
  draft.youtube.title = valid.youtube.title;
  assert.equal(captionQualityIssue(draft, { platforms: ['youtube'], mem: memory }), '');
});

test('caption quality validation prevents X copy from exceeding its character limit', () => {
  const draft = structuredClone(valid);
  draft.x.text = 'A'.repeat(281);
  assert.equal(captionQualityIssue(draft, { platforms: ['x'], mem: memory }), 'x exceeds 280 characters');
  draft.x.text = 'A'.repeat(280);
  assert.equal(captionQualityIssue(draft, { platforms: ['x'], mem: memory }), '');
});
