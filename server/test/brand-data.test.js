import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadBrands, fullPack, deepPack, getFullBrand, deepFooter, getDeepForCompact, getDeepBrand, ensureAutoBrand } from '../src/brand-memory/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const memoryDir = path.join(here, '..', 'src', 'brand-memory');

test('active brand index has 47 unique, complete profiles with usable prompt context', () => {
  const brands = loadBrands();
  assert.equal(brands.length, 47);
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

test('brand source archives parse and declare the full 47-brand portable roster', () => {
  const archive = JSON.parse(fs.readFileSync(path.join(memoryDir, 'source-data', 'Famebros_Brand_Caption_Dataset.json'), 'utf8'));
  const compact = JSON.parse(fs.readFileSync(path.join(memoryDir, 'brands.compact.json'), 'utf8'));
  const full = JSON.parse(fs.readFileSync(path.join(memoryDir, 'brands.full.json'), 'utf8'));
  assert.equal(archive.brands.length, 47);
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

  const sourceArchive = JSON.parse(fs.readFileSync(
    path.join(memoryDir, 'source-data', 'Famebros_14_Brand_Knowledge.json'), 'utf8',
  ));
  const mapping = JSON.parse(fs.readFileSync(
    path.join(memoryDir, 'source-data', 'Famebros_14_Brand_Knowledge.mapping.json'), 'utf8',
  ));
  assert.equal(sourceArchive.brands.length, 14);
  assert.equal(Object.keys(mapping.canonical_ids).length, 14);
  for (const id of [
    'ideal_tailor', 'almas_bridal_gallery', 'perfume_vault',
    'cotton_plus', 'chinese_and_grill', 'zivara_salon',
  ]) {
    assert.ok(archive.brands.some((brand) => brand.brand_id === id), `${id} must be in portable data`);
    assert.ok(loadBrands().some((brand) => brand.id === id), `${id} must resolve at runtime`);
  }

  const variantsDir = path.join(memoryDir, 'source-data', 'Specific-brands');
  for (const filename of fs.readdirSync(variantsDir).filter((name) => name.endsWith('.json'))) {
    const profile = JSON.parse(fs.readFileSync(path.join(variantsDir, filename), 'utf8'));
    assert.ok(profile.brand_id && profile.brand_name, `${filename} needs brand identity`);
  }
});

test('newer user-supplied brand updates reach the selected-brand caption context', () => {
  const rajlaxmi = loadBrands().find((brand) => brand.id === 'rajlaxmi_sangli');
  const context = fullPack(rajlaxmi);
  assert.match(context, /\+91 70205 51310/);
  assert.match(context, /2026-11-14/);
  assert.match(context, /95619 43310/);
  assert.match(context, /not been confirmed|unconfirmed/i);

  const uva = loadBrands().find((brand) => brand.id === 'uva_fashions');
  assert.match(fullPack(uva), /kids’ fashion and western wear/i);
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

test('MAP user-supplied caption details reach the prompt while Luxxe retains its uncertainty', () => {
  const map = fullPack(loadBrands().find((brand) => brand.id === 'map_clothing'));
  assert.match(map, /APPROVED FACTS.*Never funny/i);
  assert.match(map, /mens clothing/i);
  assert.match(map, /SOURCE PROVENANCE.*data\.txt/i);
  assert.match(map, /\+91 98925 65737/);
  assert.match(map, /Shop No\. 3, Shyam Apt\..*Mulund West/);
  assert.match(map, /LATEST USER-SUPPLIED CAPTION DATA/);

  const luxxe = fullPack(loadBrands().find((brand) => brand.id === 'luxxe_nail_studio'));
  assert.match(luxxe, /Only transformation content is listed/i);
  assert.match(luxxe, /nail studio Powai/i);
  assert.match(luxxe, /not_resolved/i);
  assert.match(luxxe, /Confirmed official Instagram page/i);
});

test('new user captions update the matching brand context and keep caption-specific facts scoped', () => {
  const archive = JSON.parse(fs.readFileSync(
    path.join(memoryDir, 'source-data', 'Famebros_user_supplied_brand_captions_2026-11-14.json'), 'utf8',
  ));
  assert.equal(archive.brands.length, 11);
  for (const id of ['reshine_clinic', 'sk_furniture', 'vj_jewels', 'roopali_saree', 'zam_zam_motors', 'cotton_plus', 'chinese_and_grill']) {
    const context = fullPack(loadBrands().find((brand) => brand.id === id));
    assert.match(context, /LATEST USER-SUPPLIED CAPTION DATA/);
    assert.match(context, /Managed by: @famebrosstudio/);
  }
  const parrfums = loadBrands().find((brand) => brand.id === 'perfume_vault');
  assert.equal(parrfums.name, 'Parrfums Vault');
  assert.ok(parrfums.aliases.includes('Perfume Vault'), 'keep the old spelling as a compatibility alias');
  const zam = fullPack(loadBrands().find((brand) => brand.id === 'zam_zam_motors'));
  assert.match(zam, /not current inventory/i);
  const cotton = fullPack(loadBrands().find((brand) => brand.id === 'cotton_plus'));
  assert.match(cotton, /not mapped to individual branches/i);
  const paak = getDeepForCompact(loadBrands().find((brand) => brand.id === 'paak_pehnawa_mens'));
  assert.equal(paak.brand_id, 'paak_pehnawa', 'caption update must retain the existing detailed Paak profile');
});

test('a business name in a one-off brief cannot create persistent brand memory', () => {
  assert.equal(ensureAutoBrand({ brandParam: '', brief: 'XYZ Salon shows a new haircut' }), null);
  assert.equal(ensureAutoBrand({ brandParam: '   ', brief: 'ABC Jewellers gold ring' }), null);
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
