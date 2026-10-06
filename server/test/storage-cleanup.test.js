import test from 'node:test';
import assert from 'node:assert/strict';
import { eraseUserMedia, listStorageFiles } from '../src/storage-cleanup.js';

function mockStorage(tree, { removeError = null } = {}) {
  const removed = [];
  return {
    removed,
    async list(prefix) { return { data: tree[prefix] || [], error: null }; },
    async remove(paths) { removed.push(...paths); return { error: removeError }; },
  };
}

test('storage cleanup walks only the given user and scheduled-media folders', async () => {
  const storage = mockStorage({
    'user-a': [
      { name: 'clip.mp4', id: 'file-1', metadata: { size: 123 } },
      { name: 'nested', id: null, metadata: null },
    ],
    'user-a/nested': [{ name: 'photo.jpg', id: 'file-2', metadata: { size: 45 } }],
    'scheduled/user-a': [{ name: 'job', id: null, metadata: null }],
    'scheduled/user-a/job': [{ name: 'cover.jpg', id: 'file-3', metadata: { size: 50 } }],
    'user-b': [{ name: 'keep.mp4', id: 'file-other', metadata: { size: 9 } }],
  });
  assert.deepEqual(await listStorageFiles(storage, 'user-a'), ['user-a/clip.mp4', 'user-a/nested/photo.jpg']);
  await eraseUserMedia(storage, 'user-a');
  assert.deepEqual(storage.removed.sort(), [
    'scheduled/user-a/job/cover.jpg', 'user-a/clip.mp4', 'user-a/nested/photo.jpg',
  ]);
});

test('storage cleanup reports deletion failures instead of claiming success', async () => {
  const storage = mockStorage({ 'user-a': [{ name: 'clip.mp4', id: 'file-1', metadata: { size: 123 } }] }, {
    removeError: new Error('storage unavailable'),
  });
  await assert.rejects(eraseUserMedia(storage, 'user-a'), /storage unavailable/);
});
