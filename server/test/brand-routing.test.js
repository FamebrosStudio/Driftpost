import test from 'node:test';
import assert from 'node:assert/strict';
import { matchDriveAccounts, resolveDriveBrand } from '../src/brand-routing.js';

test('Drive brand filenames ignore capitalization, accents, punctuation, and harmless spacing', () => {
  const expected = 'Shree Mahalaxmi Jewellers';
  for (const filename of [
    'SHREE MAHALAXMI JEWELLERS KURLA.MP4',
    'shree.mahalaxmi-jewellers_kurla.mp4',
    'Shree   Mahalaxmi Jewellers Kurla.mp4',
  ]) {
    assert.equal(resolveDriveBrand(filename).brand?.name, expected, filename);
  }
});

test('Drive brand matching tolerates small spelling errors and adjacent transpositions', () => {
  assert.equal(resolveDriveBrand('Shree Mahaalaxmi Jewellers Kurla.mp4').brand?.name, 'Shree Mahalaxmi Jewellers');
  assert.equal(resolveDriveBrand('Shree Mahlaaxmi Jewellers Kurla.mp4').brand?.name, 'Shree Mahalaxmi Jewellers');
  assert.equal(resolveDriveBrand('Shree Mahalaxmi Jewelers Kurla.mp4').brand?.name, 'Shree Mahalaxmi Jewellers');
});

test('fuzzy connected-account matches do not silently choose between tied account names', () => {
  const connections = [
    { id: 'one', platform: 'instagram', account_name: 'Mahalaxmi Jewellers Kurla' },
    { id: 'two', platform: 'facebook', account_name: 'Mahalaxmi Jewelerz Kurla' },
  ];
  const result = matchDriveAccounts('MAHALAXMI JEWELERS KURLA', connections);
  assert.equal(result.ambiguous, true);
  assert.deepEqual(result.destinations, []);
});
