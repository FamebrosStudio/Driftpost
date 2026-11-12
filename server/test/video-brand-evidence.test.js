import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVideoBrandSuggestions, parseVideoCoverChoice, selectBrandEvidenceFrames } from '../src/ai.js';

test('brand verification samples the beginning, middle, and end of available video frames', () => {
  const images = Array.from({ length: 8 }, (_, index) => ({
    name: `frame-${index}.jpg`, mimetype: 'image/jpeg', base64: `frame-data-${index}`,
  }));
  const selected = selectBrandEvidenceFrames(images);
  assert.deepEqual(selected.map((image) => image.name), ['frame-0.jpg', 'frame-4.jpg', 'frame-7.jpg']);
  assert.ok(selected.every((image) => image.detail === 'low'));
});

test('brand verification ignores unreadable or oversized frame payloads', () => {
  const selected = selectBrandEvidenceFrames([
    { name: 'bad.gif', mimetype: 'image/gif', base64: 'a' },
    { name: 'large.jpg', mimetype: 'image/jpeg', base64: 'a'.repeat(3_000_001) },
    { name: 'valid.png', mimetype: 'image/png', base64: 'valid' },
  ]);
  assert.deepEqual(selected.map((image) => image.name), ['valid.png']);
});

test('AI cover choice accepts only an in-range zero-based frame index', () => {
  assert.equal(parseVideoCoverChoice('{"index":2}', 8), 2);
  assert.equal(parseVideoCoverChoice('{"index":8}', 8), null);
  assert.equal(parseVideoCoverChoice('{"index":-1}', 8), null);
  assert.equal(parseVideoCoverChoice('not json', 8), null);
});

test('AI brand suggestions are restricted to supplied catalogue IDs and deduplicated', () => {
  const brands = [{ id: 'brand-a', name: 'Brand A' }, { id: 'brand-b', name: 'Brand B' }];
  const suggestions = parseVideoBrandSuggestions(JSON.stringify({ candidates: [
    { id: 'brand-b', confidence: 0.91, reason: 'Visible product and sign' },
    { id: 'unknown', confidence: 1, reason: 'not in catalogue' },
    { id: 'brand-b', confidence: 0.8, reason: 'duplicate' },
    { id: 'brand-a', confidence: 0.4, reason: 'another option' },
  ] }), brands);
  assert.deepEqual(suggestions.map(({ id, name }) => ({ id, name })), [{ id: 'brand-b', name: 'Brand B' }, { id: 'brand-a', name: 'Brand A' }]);
});
