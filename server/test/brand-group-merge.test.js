import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeOverlappingBrandGroups } from '../../src/brandGroupMerge.js';

test('transitively linked platform accounts appear together in one brand group', () => {
  const groups = [
    { key: 'facebook:fb-1', label: 'Devi & co', map: { facebook: 'fb-1', instagram: 'ig-1' } },
    { key: 'instagram:ig-1', label: '@deviandcompany_kanpur', map: { instagram: 'ig-1', youtube: 'yt-1' } },
    { label: 'Unrelated page', map: { facebook: 'fb-2' } },
  ];
  const merged = mergeOverlappingBrandGroups(groups);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged[0].map, { facebook: 'fb-1', instagram: 'ig-1', youtube: 'yt-1' });
  assert.deepEqual(merged[0].keys, ['facebook:fb-1', 'instagram:ig-1']);
  assert.equal(merged[0].label, 'Devi & co');
  assert.equal(merged[1].label, 'Unrelated page');
});

test('groups with conflicting accounts on the same platform are not merged', () => {
  const groups = [
    { label: 'Page A', map: { facebook: 'fb-a', instagram: 'ig-shared' } },
    { label: 'Page B', map: { facebook: 'fb-b', instagram: 'ig-shared' } },
  ];
  assert.equal(mergeOverlappingBrandGroups(groups).length, 2);
});
