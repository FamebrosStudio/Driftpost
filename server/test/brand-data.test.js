import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBrands, fullPack, getFullBrand, deepFooter, getDeepForCompact } from '../src/brand-memory/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const memoryDir = path.join(here, '..', 'src', 'brand-memory');

test('active brand index has 41 unique, complete profiles with usable prompt context', () => {
  const brands = loadBrands();
  assert.equal(brands.length, 41);
  assert.equal(new Set(brands.map((b) => b.id)).size, brands.length, 'brand IDs must be unique');
  assert.equal(new Set(brands.map((b) => b.name.trim().toLowerCase())).size, brands.length, 'brand names must be unique');

  for (const brand of brands) {
    assert.ok(brand.id && brand.name, `${brand.id || '(missing id)'} needs an ID and name`);
    const full = getFullBrand(brand.id);
    assert.ok(full, `${brand.id} needs a full profile`);
    if (full.readiness === 'needs_brand_identity') {
      assert.ok(full.missing_details?.length, `${brand.id} must explain what identity data is still missing`);
    } else {
      assert.ok(brand.cat, `${brand.id} needs a category when marked ready for captions`);
    }
    assert.ok(Array.isArray(full.keyword_bank) && full.keyword_bank.length, `${brand.id} needs relevant SEO keywords`);
    assert.ok(Array.isArray(full.footer_lines), `${brand.id} needs an explicit footer list`);
    assert.ok(fullPack(brand).length >= 200, `${brand.id} must produce useful AI context`);
  }
});

test('Devi & Company prompt context retains all three owner-requested branch locations', () => {
  const devi = loadBrands().find((b) => b.id === 'devi_company');
  assert.ok(devi, 'Devi & Company must exist in the active brand index');
  const profile = getDeepForCompact(devi);
  assert.ok(profile, 'Devi & Company must resolve to its detailed branch profile');
  const footer = deepFooter(profile).join('\n');
  for (const location of [
    '60/10 Purani Dal Mandi, Naya Ganj, Kanpur, Uttar Pradesh 208001',
    'N-2 Road Chauraha, Lal Bangla, Kanpur, Uttar Pradesh 208001',
    'Kidwai Nagar Chauraha, Kanpur',
  ]) assert.ok(footer.includes(location), `caption footer must retain ${location}`);
});

test('brand source archives parse and declare the full 41-brand portable roster', () => {
  const archive = JSON.parse(fs.readFileSync(path.join(memoryDir, 'source-data', 'Famebros_Brand_Caption_Dataset.json'), 'utf8'));
  assert.equal(archive.brands.length, 41);
  assert.equal(archive.brand_count, archive.brands.length);
  assert.equal(new Set(archive.brands.map((b) => b.brand_id)).size, archive.brands.length);
  for (const brand of archive.brands) {
    assert.ok(brand.brand_id && brand.name, `${brand.brand_id || '(missing id)'} needs identity`);
    if (brand.readiness !== 'needs_brand_identity') assert.ok(brand.category, `${brand.brand_id} needs a category when marked ready`);
    else assert.ok(brand.missing_details?.length, `${brand.brand_id} must explain its missing identity details`);
    assert.ok(Array.isArray(brand.approved_facts), `${brand.brand_id} needs an explicit facts list`);
    assert.ok(brand.sources, `${brand.brand_id} needs provenance`);
  }

  const variantsDir = path.join(memoryDir, 'source-data', 'Specific-brands');
  for (const filename of fs.readdirSync(variantsDir).filter((name) => name.endsWith('.json'))) {
    const profile = JSON.parse(fs.readFileSync(path.join(variantsDir, filename), 'utf8'));
    assert.ok(profile.brand_id && profile.brand_name, `${filename} needs brand identity`);
  }
});
