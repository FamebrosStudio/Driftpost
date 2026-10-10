import test from 'node:test';
import assert from 'node:assert/strict';
import { createTemporaryMediaUrl, isOwnedMediaPath, SIGNED_MEDIA_TTL_SECONDS } from '../src/media-links.js';

const userId = 'd8f7a451-81cf-4b88-8918-c9a5daec1ab0';

test('owned media paths accept only direct user uploads or scheduled files in that user folder', () => {
  assert.equal(isOwnedMediaPath(userId, `${userId}/d8f7a451-81cf-4b88-8918-c9a5daec1ab1.mp4`), true);
  assert.equal(isOwnedMediaPath(userId, `scheduled/${userId}/d8f7a451-81cf-4b88-8918-c9a5daec1ab1/clip.mp4`), true);
  assert.equal(isOwnedMediaPath(userId, 'd8f7a451-81cf-4b88-8918-c9a5daec1ab2/d8f7a451-81cf-4b88-8918-c9a5daec1ab1.mp4'), false);
  assert.equal(isOwnedMediaPath(userId, `scheduled/${userId}/../other/clip.mp4`), false);
  assert.equal(isOwnedMediaPath(userId, `${userId}/nested/d8f7a451-81cf-4b88-8918-c9a5daec1ab1.mp4`), false);
});

test('temporary links are signed for a bounded lifetime and storage errors fail closed', async () => {
  let requested;
  const storage = { async createSignedUrl(path, ttl) { requested = { path, ttl }; return { data: { signedUrl: 'https://storage.example/signed' }, error: null }; } };
  assert.equal(await createTemporaryMediaUrl(storage, 'user/file.mp4'), 'https://storage.example/signed');
  assert.deepEqual(requested, { path: 'user/file.mp4', ttl: SIGNED_MEDIA_TTL_SECONDS });
  await assert.rejects(createTemporaryMediaUrl({ async createSignedUrl() { return { data: null, error: new Error('private provider detail') }; } }, 'x'), /temporary media link/);
});
