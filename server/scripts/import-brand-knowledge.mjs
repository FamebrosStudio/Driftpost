import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const memoryDir = path.join(here, '..', 'src', 'brand-memory');
const sourcePath = process.argv[2];
if (!sourcePath) throw new Error('Usage: node scripts/import-brand-knowledge.mjs <source.json>');

const raw = fs.readFileSync(sourcePath, 'utf8');
const source = JSON.parse(raw);
if (!Array.isArray(source.brands) || source.brands.length !== 14) {
  throw new Error('Expected the reviewed 14-brand knowledge dataset.');
}
const archivePath = path.join(memoryDir, 'source-data', 'Famebros_14_Brand_Knowledge.json');
if (fs.existsSync(archivePath) && fs.readFileSync(archivePath, 'utf8') !== raw) {
  throw new Error('A different import archive already exists; refusing to overwrite.');
}

const canonicalIds = {
  'BR-009': 'jolly_tailor',
  'BR-012': 'vj_jewels',
  'BR-015': 'bhanu_designer',
  'BR-017': 'rajlaxmi_sangli',
  'BR-022': 'paak_pehnawa_mens',
  'BR-023': 'pixi_grow',
  'BR-024': 'gs_shetty_school',
  'BR-026': 'uva_fashions',
  'BR-027': 'ideal_tailor',
  'BR-028': 'almas_bridal_gallery',
  'BR-029': 'perfume_vault',
  'BR-030': 'cotton_plus',
  'BR-031': 'chinese_and_grill',
  'BR-034': 'zivara_salon',
};
const newIds = new Set([
  'ideal_tailor', 'almas_bridal_gallery', 'perfume_vault',
  'cotton_plus', 'chinese_and_grill', 'zivara_salon',
]);
const norm = (value) => String(value || '').normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const dedupe = (values) => {
  const seen = new Set();
  return (values || []).filter((value) => {
    if (typeof value !== 'string' || !value.trim()) return false;
    const key = norm(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
const read = (file) => JSON.parse(fs.readFileSync(path.join(memoryDir, file), 'utf8'));
const write = (file, data) => fs.writeFileSync(
  path.join(memoryDir, file), `${JSON.stringify(data, null, 2)}\n`, 'utf8',
);
const compact = read('brands.compact.json');
const portable = read('source-data/Famebros_Brand_Caption_Dataset.json');
const full = read('brands.full.json');
if (compact.count !== 41 || compact.brands.length !== 41
  || portable.brands.length !== 41 || full.brands.length !== 41) {
  throw new Error('Expected the current 41-brand catalogues; no files were changed.');
}

const deepFiles = fs.readdirSync(path.join(memoryDir, 'brands')).filter((file) => file.endsWith('.json'));
const deepByName = new Map();
for (const file of deepFiles) {
  const profile = read(`brands/${file}`);
  for (const name of [profile.brand_name, ...(profile.aliases || [])]) {
    if (norm(name)) deepByName.set(norm(name), file);
  }
}
const confirmedAddendum = (brand) => ({
  dataset_prepared_on: source.prepared_on,
  knowledge_scope: brand.knowledge_scope || null,
  business: brand.business || null,
  contact: brand.contact || null,
  social_media: brand.social_media || null,
  established_content_knowledge: brand.established_content_knowledge || null,
  writing_direction: brand.writing_direction || null,
  content_playbook: brand.content_playbook || null,
  brand_content_framework: brand.brand_content_framework || null,
  caption_format: brand.caption_format || null,
  fixed_footer: brand.fixed_footer || null,
  suggested_hashtag_bank: brand.suggested_hashtag_bank || null,
  seo_keyword_bank: brand.seo_keyword_bank || null,
  cta_bank: brand.cta_bank || null,
  suggested_hooks: brand.suggested_hooks || null,
  visual_and_asset_guidance: brand.visual_and_asset_guidance || null,
  carousel_and_reel_system: brand.carousel_and_reel_system || null,
  accuracy_rules: brand.accuracy_rules || null,
  per_post_input: brand.per_post_input || null,
  missing_information: brand.missing_information || null,
});
const locationLabel = (brand) => {
  const location = brand.business?.location || {};
  const city = String(location.city || '');
  if (/candidate|unconfirmed|search/i.test(city)) return null;
  return [location.area, city].filter(Boolean).join(', ') || null;
};
const ctas = (brand) => Object.entries(brand.cta_bank || {})
  .filter(([, value]) => Array.isArray(value))
  .flatMap(([, value]) => value)
  .filter((value) => typeof value === 'string');

if (!fs.existsSync(archivePath)) fs.writeFileSync(archivePath, raw, 'utf8');
write('source-data/Famebros_14_Brand_Knowledge.mapping.json', {
  source_file: 'source-data/Famebros_14_Brand_Knowledge.json',
  prepared_on: source.prepared_on,
  note: 'Source BR IDs and brand numbers are not canonical Driftpost IDs. Use this explicit mapping.',
  canonical_ids: canonicalIds,
});

const matched = new Set();
for (const brand of source.brands) {
  const canonicalId = canonicalIds[brand.brand_id];
  if (!canonicalId) throw new Error(`Unmapped source ID: ${brand.brand_id}`);
  const incomingNames = [brand.brand_name, ...(brand.aliases || [])].map(norm);
  const current = compact.brands.find((entry) =>
    [entry.name, ...(entry.aliases || [])].map(norm).some((name) => incomingNames.includes(name)));
  const incomingAliases = dedupe(brand.aliases || [])
    .filter((alias) => norm(alias) !== norm(brand.brand_name));

  if (current) {
    if (current.id !== canonicalId) throw new Error(`Canonical ID mismatch for ${brand.brand_name}.`);
    matched.add(canonicalId);
    current.aliases = dedupe([...(current.aliases || []), ...incomingAliases])
      .filter((alias) => norm(alias) !== norm(current.name));
    const profileFile = incomingNames.map((name) => deepByName.get(name)).find(Boolean);
    if (!profileFile) throw new Error(`No runtime profile exists for ${brand.brand_name}.`);
    const profile = read(`brands/${profileFile}`);
    profile.latest_user_dataset_update = confirmedAddendum(brand);

    if (canonicalId === 'rajlaxmi_sangli') {
      profile.contact.phone_display = '+91 70205 51310';
      profile.contact.phone_e164 = '+917020551310';
      profile.contact.phone_status = 'User-provided contact in the dataset prepared 2026-11-14.';
      profile.contact.phone_publication_rule = 'Use +91 70205 51310. The previous +91 95619 43310 directory number is unconfirmed and must not be used unless the brand reconfirms it.';
      profile.contact.phone_directory_candidate_unconfirmed = '+91 95619 43310';
      profile.contact.whatsapp_status = 'Do not label +91 70205 51310 as WhatsApp without confirmation.';
      profile.contact.public_enquiry_methods = (profile.contact.public_enquiry_methods || [])
        .map((item) => item.includes('95619 43310')
          ? 'Call +91 70205 51310 (user-provided contact, 2026-11-14)' : item);
      const replaceActivePhone = (value, key = '') => {
        if (typeof value === 'string') {
          if (/source|historical|directory|registration|used_for/i.test(key)) return value;
          return value.replaceAll('+91 95619 43310', '+91 70205 51310')
            .replaceAll('+919561943310', '+917020551310')
            .replaceAll('95619 43310', '70205 51310')
            .replaceAll('9561943310', '7020551310');
        }
        if (Array.isArray(value)) return value.map((item) => replaceActivePhone(item, key));
        if (value && typeof value === 'object') {
          for (const [childKey, child] of Object.entries(value)) {
            value[childKey] = replaceActivePhone(child, childKey);
          }
        }
        return value;
      };
      replaceActivePhone(profile);
      profile.contact.phone_display = '+91 70205 51310';
      profile.contact.phone_e164 = '+917020551310';
      profile.contact.phone_directory_candidate_unconfirmed = '+91 95619 43310';
    }

    if (canonicalId === 'uva_fashions') {
      profile.business.category = 'Fashion retail, including kids’ fashion and western wear per the user-provided 2026-11-14 dataset';
      profile.business.customer_focus = 'Families shopping for children’s clothing and fashion shoppers';
      profile.business.location_area = 'Byculla, Mumbai';
      profile.contact.phone_display = '+91 98333 54400';
      profile.contact.phone_e164 = '+919833354400';
      profile.contact.full_address_preferred = 'Byculla House, Mirza Galib Road (Clare Road), Byculla, Mumbai';
      profile.established_content_knowledge ||= {};
      profile.established_content_knowledge.user_provided_business_facts_2026_11_14 = [
        'Kids’ fashion and western wear are identified in the supplied client knowledge dataset.',
        'A kids’ denim launch post was discussed.',
      ];
      profile.master_brand_instruction += ' The 2026-11-14 user-provided dataset identifies kids’ fashion and western wear and supplies Byculla House, Mirza Galib Road (Clare Road), Mumbai and +91 98333 54400. Use these details when relevant and confirm time-sensitive information.';
    }
    write(`brands/${profileFile}`, profile);
    continue;
  }

  if (!newIds.has(canonicalId)) throw new Error(`Unexpected missing existing brand: ${brand.brand_name}`);
  const profile = { ...brand, brand_id: canonicalId, aliases: dedupe(brand.aliases || []) };
  delete profile.brand_number;
  if (typeof profile.fixed_footer === 'string' && profile.fixed_footer.trim()) {
    profile.fixed_footer = { lines: [profile.fixed_footer.trim(), '💫 Managed by: @famebrosstudio'] };
  } else {
    profile.fixed_footer = null;
  }
  profile.contact = { ...(profile.contact || {}) };
  const phone = profile.contact.phone || profile.contact.phone_primary || null;
  const address = profile.contact.address || profile.business?.location?.address || null;
  if (phone && !profile.contact.phone_display) profile.contact.phone_display = phone;
  if (address && !profile.contact.full_address) profile.contact.full_address = address;
  const deepPath = path.join(memoryDir, 'brands', `${canonicalId}.json`);
  if (fs.existsSync(deepPath)) throw new Error(`Refusing to overwrite ${deepPath}`);
  write(`brands/${canonicalId}.json`, profile);

  const identityPending = ['perfume_vault', 'cotton_plus', 'chinese_and_grill'].includes(canonicalId);
  const category = profile.business?.genre || 'Brand identity pending confirmation';
  const location = locationLabel(profile);
  const keywords = dedupe(profile.seo_keyword_bank || []);
  if (!keywords.length) keywords.push(profile.brand_name);
  const footer = typeof brand.fixed_footer === 'string' && brand.fixed_footer.trim()
    ? [brand.fixed_footer.trim(), '💫 Managed by: @famebrosstudio']
    : ['💫 Managed by: @famebrosstudio'];
  const handle = profile.social_media?.instagram_handle || null;
  const cta = dedupe(ctas(profile)).slice(0, 6);
  const genres = (profile.content_playbook?.pillars || []).slice(0, 8);
  const avoid = dedupe([...(profile.writing_direction?.avoid || []), ...(profile.accuracy_rules || [])]).slice(0, 12);
  compact.brands.push({
    id: canonicalId,
    name: profile.brand_name,
    aliases: incomingAliases,
    cat: category,
    loc: location || '',
    genres,
    tone: (profile.writing_direction?.tone || []).join(', ') || 'Use the supplied brief; confirm the brand voice.',
    lang: profile.writing_direction?.language || '',
    cta,
    avoid,
    kw: keywords.slice(0, 12),
    footer,
    mandatory: [],
    ex: profile.sample_caption || '',
    ig: handle,
    ready: identityPending ? 'needs_brand_identity' : 'ready_with_post_brief',
    web: profile.contact?.website || null,
    email: profile.contact?.email || null,
  });
  const contacts = profile.contact || {};
  const fullRecord = {
    brand_id: canonicalId,
    name: profile.brand_name,
    aliases: incomingAliases,
    category,
    location,
    content_genres: genres,
    caption_direction: {
      status: 'user_provided_2026-11-14',
      tone: (profile.writing_direction?.tone || []).join(', '),
      audience: (profile.business?.audience || []).join('; ') || 'Unknown; do not infer.',
      language: profile.writing_direction?.language || 'Use the language in the supplied brief.',
      focus: [profile.brand_content_framework?.focus || 'Use only the exact service or subject in the supplied post brief.'],
      avoid,
      cta_options: cta,
    },
    keyword_bank: keywords,
    approved_facts: (profile.established_content_knowledge?.confirmed || [])
      .map((text) => ({ text, source: 'Famebros_14_Brand_Knowledge.json; qualifications remain in the detailed profile.' })),
    mandatory_copy: [],
    contacts: {
      phone: phone ? [phone] : [],
      address: address || null,
      email: contacts.email || null,
      website: contacts.website || null,
    },
    footer_lines: footer,
    instagram: {
      url: contacts.instagram_url || profile.social_media?.instagram_url || null,
      handle,
      status: handle ? 'user_supplied_handle' : 'not_resolved',
      evidence: profile.social_media?.instagram_url ? [profile.social_media.instagram_url] : [],
      note: profile.social_media?.note || 'Use only confirmed official links.',
    },
    example: {
      status: 'source_dataset_example',
      body: profile.sample_caption || null,
      full_caption: profile.sample_caption || null,
    },
    missing_details: profile.missing_information || [],
    sources: ['Famebros_14_Brand_Knowledge.json (prepared 2026-11-14)'],
    footer_policy: 'Append only confirmed footer lines for feed/reel captions. Never invent missing contact details.',
    readiness: identityPending ? 'needs_brand_identity' : 'ready_with_post_brief',
    always_exclude_from_captions: ['Internal notes', 'Source URLs and evidence notes', 'Unconfirmed details', 'Placeholders'],
  };
  portable.brands.push(fullRecord);
  full.brands.push(structuredClone(fullRecord));
}

if (matched.size !== 8 || compact.brands.length !== 47) {
  throw new Error(`Unexpected roster after merge: ${matched.size} matched, ${compact.brands.length} total.`);
}
compact.brands = compact.brands.map((brand) => ({
  ...brand,
  aliases: dedupe((brand.aliases || []).filter((alias) => norm(alias) !== norm(brand.name))),
}));
for (const dataset of [portable, full]) {
  dataset.brands = dataset.brands.map((brand) => ({
    ...brand,
    aliases: dedupe((brand.aliases || []).filter((alias) => norm(alias) !== norm(brand.name))),
  }));
  dataset.brand_count = 47;
  dataset.purpose = 'Portable AI context and developer handoff for the 47-brand active roster.';
  dataset.source_scope = 'Existing 41-brand roster plus six new brands from the dataset prepared 2026-11-14. Eight source records update existing brands. Source BR IDs are not canonical IDs.';
  if (typeof dataset.master_system_prompt === 'string') {
    dataset.master_system_prompt = dataset.master_system_prompt.replaceAll('all 41 brands', 'all 47 brands');
  }
}
compact.count = 47;
write('brands.compact.json', compact);
write('source-data/Famebros_Brand_Caption_Dataset.json', portable);
write('brands.full.json', full);
console.log(JSON.stringify({ updatedExisting: [...matched], added: [...newIds], total: 47 }, null, 2));
