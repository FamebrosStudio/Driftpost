import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVideoBrandSuggestions, parseVideoCoverChoice, selectBrandEvidenceFrames, videoEvidenceSampleTimes } from '../src/ai.js';

test('brand verification samples the full timeline including a final logo/end card', () => {
  const times = videoEvidenceSampleTimes(8.289, 5);
  assert.equal(times.length, 5);
  assert.ok(times[0] < 0.1);
  assert.ok(Math.abs(times[2] - 4.1445) < 0.01);
  assert.ok(times[4] > 8.1);
  assert.deepEqual(times, [...times].sort((a, b) => a - b));
  const frames = times.map((time, index) => ({
    name: index === 4 ? 'final-brand-end-card.jpg' : `frame-${time}.jpg`,
    mimetype: 'image/jpeg',
    base64: `frame-${index}`,
  }));
  assert.deepEqual(selectBrandEvidenceFrames(frames, 5).map((frame) => frame.name), [
    'frame-0.08.jpg',
    'frame-2.11225.jpg',
    'frame-4.1445.jpg',
    'frame-6.17675.jpg',
    'final-brand-end-card.jpg',
  ]);
});

test('brand evidence sampling returns safe, unique timestamps for very short clips', () => {
  const times = videoEvidenceSampleTimes(0.1, 5);
  assert.equal(times.length, 5);
  assert.ok(times.every((time) => time >= 0 && time < 0.1));
  assert.equal(new Set(times).size, times.length);
  assert.deepEqual(videoEvidenceSampleTimes(0), []);
});

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
