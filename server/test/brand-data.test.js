import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBrands, fullPack, deepPack, getFullBrand, deepFooter, getDeepForCompact, getDeepBrand } from '../src/brand-memory/index.js';

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
  const compact = JSON.parse(fs.readFileSync(path.join(memoryDir, 'brands.compact.json'), 'utf8'));
  const full = JSON.parse(fs.readFileSync(path.join(memoryDir, 'brands.full.json'), 'utf8'));
  assert.equal(archive.brands.length, 41);
  assert.equal(archive.brand_count, archive.brands.length);
  assert.equal(new Set(archive.brands.map((b) => b.brand_id)).size, archive.brands.length);
  const sortedIds = (items, key) => items.map((item) => item[key]).sort();
  assert.deepEqual(sortedIds(archive.brands, 'brand_id'), sortedIds(compact.brands, 'id'), 'portable and resolver records must cover the same brands');
  assert.deepEqual(sortedIds(archive.brands, 'brand_id'), sortedIds(full.brands, 'brand_id'), 'portable and full records must cover the same brands');
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

test('compact brand records retain valid Unicode and resolve to a detailed profile', () => {
  const compactPath = path.join(memoryDir, 'brands.compact.json');
  const compactData = JSON.parse(fs.readFileSync(compactPath, 'utf8'));
  const hasMojibake = (value) => {
    if (typeof value === 'string') return /(?:Ã.|ðŸ|â(?:€|œ|€™)|ï¿½)/u.test(value);
    if (Array.isArray(value)) return value.some(hasMojibake);
    if (value && typeof value === 'object') return Object.values(value).some(hasMojibake);
    return false;
  };
  assert.equal(hasMojibake(compactData), false, 'resolver copy must not contain broken UTF-8 text');

  for (const brand of loadBrands()) {
    assert.ok(getFullBrand(brand.id), `${brand.id} must resolve to a complete fallback profile`);
    const detailed = getDeepForCompact(brand) || getDeepBrand(brand.id);
    if (detailed) assert.ok(detailed.brand_id, `${brand.id} detailed profile must declare its brand ID`);
  }
});

test('HerChoice by Asma current identity is consistent across caption data layers', () => {
  const compact = loadBrands().find((brand) => brand.id === 'asma_women_clothing');
  const full = getFullBrand('asma_women_clothing');
  const detailed = getDeepForCompact(compact);
  const portable = JSON.parse(fs.readFileSync(path.join(memoryDir, 'source-data', 'Famebros_Brand_Caption_Dataset.json'), 'utf8'))
    .brands.find((brand) => brand.brand_id === 'asma_women_clothing');

  assert.equal(compact.name, 'HerChoice by Asma');
  assert.equal(full.name, 'HerChoice by Asma');
  assert.equal(portable.name, 'HerChoice by Asma');
  assert.equal(detailed.brand_name, 'HerChoice by Asma');
  assert.equal(detailed.social_media.instagram_handle, '@herchoice_byasma');
  assert.ok(detailed.accuracy_rules.some((rule) => /celebrity.*endors/i.test(rule)));
});

test('AI caption packs exclude agency billing and operational scope notes', () => {
  const avnikk = loadBrands().find((brand) => brand.id === 'avnikk_collection');
  const prompt = fullPack(avnikk);
  for (const privateDetail of ['35,000', '17,500', 'content shoots per month', 'reels per month', 'accounts note']) {
    assert.ok(!prompt.toLowerCase().includes(privateDetail.toLowerCase()), `AI prompt must not include ${privateDetail}`);
  }
  assert.match(prompt, /Avnikk Collection/);
  assert.match(prompt, /kurta/i, 'public product and brand guidance should remain available');

  const synthetic = deepPack({
    brand_id: 'private-field-test',
    brand_name: 'Sample Brand',
    master_brand_instruction: 'Write accurate public captions for Sample Brand.',
    accounts_note: 'PRIVATE_ACCOUNTS_SENTINEL',
    monthly_service_scope: { monthly_fee: 'PRIVATE_FEE_SENTINEL', scope_status: 'PRIVATE_SCOPE_SENTINEL' },
    per_post_input: { internal_budget: 'PRIVATE_PPI_SENTINEL', product_detail: 'Use only supplied product facts.' },
    business: { category: 'Sample retail brand', private_payment_note: 'PRIVATE_NESTED_SENTINEL' },
  }, { id: 'private-field-test', name: 'Sample Brand' });
  for (const privateDetail of ['PRIVATE_ACCOUNTS_SENTINEL', 'PRIVATE_FEE_SENTINEL', 'PRIVATE_SCOPE_SENTINEL', 'PRIVATE_PPI_SENTINEL', 'PRIVATE_NESTED_SENTINEL']) {
    assert.ok(!synthetic.includes(privateDetail), `AI prompt must exclude ${privateDetail}`);
  }
  assert.match(synthetic, /Sample retail brand/);
  assert.match(synthetic, /Use only supplied product facts/);
});

test('all checked-in brand JSON remains valid UTF-8 text', () => {
  const brokenUtf8 = /(?:\u00c3.|\u00f0\u0178|\u00e2(?:\u20ac|\u0153|\u2122)|\u00e0[\u00a4\u00a5]|\u00ef\u00bf\u00bd)/u;
  const jsonFiles = (directory) => fs.readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => entry.isDirectory()
      ? jsonFiles(path.join(directory, entry.name))
      : entry.name.endsWith('.json') ? [path.join(directory, entry.name)] : []);
  for (const filename of jsonFiles(memoryDir)) {
    const data = JSON.parse(fs.readFileSync(filename, 'utf8'));
    const containsBrokenText = (value) => {
      if (typeof value === 'string') return brokenUtf8.test(value);
      if (Array.isArray(value)) return value.some(containsBrokenText);
      if (value && typeof value === 'object') return Object.values(value).some(containsBrokenText);
      return false;
    };
    assert.equal(containsBrokenText(data), false, `${path.relative(memoryDir, filename)} contains broken text encoding`);
  }
});

test('brand keyword and hashtag banks do not contain another active brand identity', () => {
  const brands = loadBrands();
  const normalize = (value) => String(value || '').replace(/^#+|^@/g, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
  for (const brand of brands) {
    const full = getFullBrand(brand.id);
    const deep = getDeepForCompact(brand);
    const candidates = [
      ...(brand.kw || []),
      ...(full?.keyword_bank || []),
      ...(Array.isArray(deep?.seo_keyword_bank) ? deep.seo_keyword_bank : []),
      ...Object.values(deep?.suggested_hashtag_bank || {}).flatMap((value) => Array.isArray(value) ? value : typeof value === 'string' ? [value] : []),
    ].map(normalize).filter(Boolean);
    for (const other of brands) {
      if (other.id === brand.id) continue;
      const otherNames = [other.name, ...(other.aliases || []), other.ig].map(normalize).filter((name) => name.length >= 8);
      for (const name of otherNames) {
        assert.ok(!candidates.includes(name), `${brand.id} has another brand's identity in a keyword/hashtag bank: ${other.id}`);
      }
    }
  }
});
