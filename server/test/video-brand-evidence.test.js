import test from 'node:test';
import assert from 'node:assert/strict';
import { selectBrandEvidenceFrames } from '../src/ai.js';

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
