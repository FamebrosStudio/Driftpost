import test from 'node:test';
import assert from 'node:assert/strict';
import {
  feedBrand,
  listFedBrands,
  deleteFedBrand,
  exportFedBrandsBundle,
  hydrateFedBrandsBundle,
} from '../src/brand-memory/index.js';

test('feedBrand ignores @handle-only lines when inferring brand name and supports cloud bundle export/hydrate', () => {
  const sampleText = [
    '@almas.bridal.gallery',
    'Brand Name: Test Guard Bridal Studio',
    'Category: Bridal Couture',
    'Address: Vakola, Santacruz East, Mumbai',
    'Phone: 9004656157',
    'Instagram: @almas.bridal.gallery',
  ].join('\n');

  const saved = feedBrand({ brandName: '', rawText: sampleText });
  try {
    assert.equal(saved.name, 'Test Guard Bridal Studio');
    assert.notEqual(saved.name, 'almas.bridal.gallery');

    const bundle = exportFedBrandsBundle();
    assert.ok(bundle.customEntries.some((entry) => entry.id === saved.id));
    assert.ok(bundle.deepFiles[`auto-${saved.id}.json`]);

    assert.equal(deleteFedBrand(saved.id), true);
    assert.equal(listFedBrands().some((entry) => entry.id === saved.id), false);

    const restored = hydrateFedBrandsBundle(bundle);
    assert.ok(restored >= 1);
    assert.equal(listFedBrands().some((entry) => entry.id === saved.id), true);
  } finally {
    deleteFedBrand(saved.id);
  }
});
