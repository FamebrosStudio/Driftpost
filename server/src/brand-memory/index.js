// Brand memory: local-first, zero-LLM-token brand resolver + per-brand pack.
// Goal: NEVER send all 41 brands to the LLM. Resolve locally, inject ONE brand (~200 tokens).
// Brand memory: local-first store. ALL data lives here on disk.
// - brands.full.json  = every number, address, footer, fact, example (168KB on disk, never sent whole)
// - brands.compact.json = tiny resolver index (names/aliases only)
// - memory.json = learned overrides (owner corrections win over everything)
// Per request we resolve locally (0 tokens) and inject ONE brand's FULL record
// (~800 tokens). That is the storage place the prompt is built from.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const COMPACT_PATH = path.join(here, 'brands.compact.json');
const FULL_PATH = path.join(here, 'brands.full.json');
const MEMORY_PATH = path.join(here, 'memory.json');

let cache = null;
export function loadBrands() {
  if (!cache) cache = JSON.parse(fs.readFileSync(COMPACT_PATH, 'utf8'));
  return cache.brands;
}

let fullCache = null;
function loadFull() {
  if (!fullCache) fullCache = JSON.parse(fs.readFileSync(FULL_PATH, 'utf8'));
  return fullCache;
}

export function getFullBrand(brandId) {
  try {
    return loadFull().brands.find((b) => b.brand_id === brandId) || null;
  } catch {
    return null;
  }
}

// Full per-brand record: every phone, address, footer, fact, CTA, keyword,
// genre rule and example. This is what the AI reads before writing.
export function fullPack(brand) {
  // Deep per-brand file (Specific-brands format) wins when present —
  // it carries master instruction, playbook, hooks, CTA/hashtag banks.
  const deep = brand?.id ? getDeepBrand(brand.id) : null;
  if (deep) return deepPack(deep, brand);
  const full = brand?.id ? getFullBrand(brand.id) : null;
  if (!full) return brandPack(brand);
  const mem = loadMemory().brands?.[brand.id];
  const cd = full.caption_direction || {};
  const lines = [
    `BRAND: ${full.name} (${full.category || 'local brand'}${full.location ? `, ${full.location}` : ''})`,
    full.content_genres?.length ? `Genres: ${full.content_genres.join(', ')}` : null,
    cd.tone ? `Tone: ${cd.tone}` : null,
    cd.language ? `Language: ${cd.language}` : null,
    cd.focus?.length ? `Focus: ${cd.focus.join('; ')}` : null,
    cd.avoid?.length ? `Never: ${cd.avoid.join('; ')}` : null,
    (cd.cta_options || brand.cta || []).length ? `CTA pick one (reword, don't copy): ${(cd.cta_options || brand.cta).join(' / ')}` : null,
    full.approved_facts?.length ? `Facts: ${full.approved_facts.map((f) => (typeof f === 'string' ? f : f.text)).join('; ')}` : null,
    full.mandatory_copy?.length ? `Must include word-for-word: ${full.mandatory_copy.join('; ')}` : null,
    full.contacts?.phone?.length ? `Phone: ${full.contacts.phone.join(' / ')}` : null,
    full.contacts?.address ? `Address: ${full.contacts.address}` : null,
    full.contacts?.website ? `Website: ${full.contacts.website}` : null,
    full.contacts?.email ? `Email: ${full.contacts.email}` : null,
    full.footer_lines?.length ? `Footer (append exactly):\n${full.footer_lines.join('\n')}` : 'Footer: 💫 Managed by: @famebrosstudio',
    full.keyword_bank?.length ? `SEO keywords: ${full.keyword_bank.join(', ')}` : null,
    full.example?.body ? `Style example (match this energy, never copy facts):\n${String(full.example.body).slice(0, 500)}` : (brand.ex ? `Style example: ${brand.ex}` : null),
    full.instagram?.handle ? `IG handle: ${full.instagram.handle}` : null,
    full.readiness === 'needs_brand_identity' ? 'Identity incomplete: if the brief lacks product/subject, ask ONE short question instead of inventing.' : null,
    mem?.notes ? `Owner correction (wins over all above): ${String(mem.notes).slice(0, 300)}` : null,
    mem?.recent?.length ? `Don't repeat hooks: ${mem.recent.slice(-3).join(' | ').slice(0, 200)}` : null,
  ].filter(Boolean);
  return lines.join('\n');
}

const DEEP_DIR = path.join(here, 'brands');
let deepCache = null;
function loadDeepAll() {
  if (deepCache) return deepCache;
  deepCache = {};
  let files = [];
  try {
    files = fs.readdirSync(DEEP_DIR).filter((f) => f.endsWith('.json'));
  } catch {
    return deepCache;
  }
  for (const f of files) {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(DEEP_DIR, f), 'utf8'));
      const id = d.brand_id || f.replace(/\.json$/, '');
      deepCache[id] = d;
    } catch {}
  }
  return deepCache;
}

export function getDeepBrand(brandId) {
  return loadDeepAll()[brandId] || null;
}

export function deepBrandIds() {
  return Object.keys(loadDeepAll());
}

// Pack built from the Specific-brands deep format (~600-800 tokens).
// Precedence inside: owner memory correction > master instruction > playbook.
export function deepPack(deep, brand) {
  const mem = loadMemory().brands?.[deep.brand_id];
  const cta = deep.cta_bank
    ? [...(deep.cta_bank.booking || []), ...(deep.cta_bank.save || []), ...(deep.cta_bank.share || []), ...(deep.cta_bank.comments || [])].slice(0, 5)
    : [];
  const tags = deep.suggested_hashtag_bank
    ? [...(deep.suggested_hashtag_bank.brand || []), ...(deep.suggested_hashtag_bank.location || []), ...(deep.suggested_hashtag_bank.topic || [])].slice(0, 6)
    : [];
  const play = deep.content_playbook
    ? Object.entries(deep.content_playbook)
        .slice(0, 4)
        .map(([k, v]) => `${k}: ${v.focus || v.status || ''} ${(v.rules || []).slice(0, 3).join('; ')}`.trim())
        .join('\n')
    : '';
  const lines = [
    deep.master_brand_instruction ? `MASTER: ${deep.master_brand_instruction}` : null,
    deep.business ? `Business: ${deep.business.category || ''}${deep.business.location_area ? `, ${deep.business.location_area}` : ''}` : null,
    deep.contact?.phone_display ? `Phone: ${deep.contact.phone_display}` : null,
    deep.contact?.full_address ? `Address: ${deep.contact.full_address}` : null,
    deep.social_media?.instagram_handle ? `IG: ${deep.social_media.instagram_handle}` : null,
    deep.established_content_knowledge?.previously_featured_look
      ? `Known look: ${deep.established_content_knowledge.previously_featured_look.name} — ${deep.established_content_knowledge.previously_featured_look.reuse_rule || ''}`
      : null,
    (deep.writing_direction?.brand_voice || []).length ? `Voice: ${deep.writing_direction.brand_voice.join(', ')}` : null,
    deep.writing_direction?.positioning_for_copy ? `Positioning: ${deep.writing_direction.positioning_for_copy}` : null,
    (deep.writing_direction?.avoid_style || []).length ? `Avoid: ${deep.writing_direction.avoid_style.slice(0, 5).join('; ')}` : null,
    cta.length ? `CTAs (pick one, reword): ${cta.join(' / ')}` : null,
    (deep.suggested_hooks || []).length ? `Hook angles (vary, don't repeat): ${deep.suggested_hooks.slice(0, 4).join(' / ')}` : null,
    tags.length ? `Hashtag bank (pick exactly 3): ${tags.join(' ')}` : null,
    deep.suggested_hashtag_bank?.conditional ? `Tag conditions: ${Object.entries(deep.suggested_hashtag_bank.conditional).map(([t, r]) => `${t} ${r}`).join('; ')}` : null,
    (deep.seo_keyword_bank || []).length ? `SEO keywords: ${deep.seo_keyword_bank.slice(0, 9).join(', ')}` : null,
    (deep.fixed_footer?.lines?.length
      ? `Footer (append exactly):\n${deep.fixed_footer.lines.join('\n')}`
      : deep.footer_policy?.confirmed_footer_lines?.length
        ? `Footer (append exactly):\n${deep.footer_policy.confirmed_footer_lines.join('\n')}`
        : null),
    play ? `Playbook:\n${play}` : null,
    deep.sample_caption?.text ? `Style example (match energy, never copy facts):\n${String(deep.sample_caption.text).slice(0, 600)}` : null,
    (deep.accuracy_rules || []).length ? `Accuracy: ${deep.accuracy_rules.slice(0, 5).join(' ')}` : null,
    mem?.notes ? `Owner correction (wins over all above): ${String(mem.notes).slice(0, 300)}` : null,
    mem?.recent?.length ? `Don't repeat hooks: ${mem.recent.slice(-3).join(' | ').slice(0, 200)}` : null,
  ].filter(Boolean);
  return lines.join('\n');
}

export function loadMemory() {
  try {
    return JSON.parse(fs.readFileSync(MEMORY_PATH, 'utf8'));
  } catch {
    return { version: 1, brands: {} };
  }
}

const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// Score a query against one brand. Cheap local fuzzy match — costs 0 tokens.
function scoreBrand(b, q) {
  const query = norm(q);
  if (!query) return 0;
  const names = [b.name, b.id.replace(/_/g, ' '), ...(b.aliases || []), b.ig || ''].map(norm);
  for (const n of names) {
    if (!n) continue;
    if (query === n) return 1000;
    if (query.includes(n) && n.length > 3) return 500 + n.length;
    if (n.includes(query) && query.length > 3) return 400 + query.length;
  }
  // token overlap fallback
  const qt = new Set(query.split(' ').filter((t) => t.length > 2));
  let hit = 0;
  for (const n of names) for (const t of n.split(' ')) if (qt.has(t) && t.length > 3) hit += t.length >= 6 ? 30 : 10;
  return hit;
}

// Find brand from free text (prompt, picked brand label, file name). Returns {brand, score} or null.
export function resolveBrand(query) {
  const q = String(query || '').trim();
  if (q.length < 2) return null;
  let best = null;
  let bestScore = 0;
  for (const b of loadBrands()) {
    const s = scoreBrand(b, q);
    if (s > bestScore) {
      bestScore = s;
      best = b;
    }
  }
  // threshold 20 avoids false positives on generic words like "salon"
  if (!best || bestScore < 20) return null;
  return { brand: best, score: bestScore };
}

export function searchBrands(q, limit = 8) {
  const query = String(q || '').trim();
  const all = loadBrands();
  if (!query) return all.slice(0, limit).map((b) => ({ id: b.id, name: b.name }));
  return all
    .map((b) => ({ b, s: scoreBrand(b, query) }))
    .filter((x) => x.s > 0)
    .sort((a, b2) => b2.s - a.s)
    .slice(0, limit)
    .map((x) => ({ id: x.b.id, name: x.b.name, loc: x.b.loc }));
}

// Tiny per-brand pack injected into the LLM prompt (~200 tokens, not 40k).
export function brandPack(brand) {
  if (!brand) return '';
  const mem = loadMemory().brands?.[brand.id];
  const lines = [
    `BRAND: ${brand.name} (${brand.cat || 'local brand'}${brand.loc ? `, ${brand.loc}` : ''})`,
    brand.genres?.length ? `Genres: ${brand.genres.join(', ')}` : null,
    brand.tone ? `Tone: ${brand.tone}` : null,
    brand.lang ? `Language: ${brand.lang}` : null,
    brand.cta?.length ? `CTA pick one: ${brand.cta.join(' / ')}` : null,
    brand.avoid?.length ? `Never: ${brand.avoid.join('; ')}` : null,
    brand.footer?.length ? `Footer (append exactly):\n${brand.footer.join('\n')}` : 'Footer: 💫 Managed by: @famebrosstudio',
    brand.kw?.length ? `Hashtags: 3 only (1 brand + 2 topic). Keywords: [${brand.kw.slice(0, 6).join(', ')}]` : null,
    brand.mandatory?.length ? `Must include: ${brand.mandatory.join('; ')}` : null,
    brand.web ? `Website: ${brand.web}` : null,
    brand.ready === 'needs_brand_identity' ? 'Identity incomplete: if the brief lacks product/subject, ask ONE short question instead of inventing.' : null,
    brand.ex ? `Style example: ${brand.ex}` : null,
    mem?.notes ? `Learned: ${String(mem.notes).slice(0, 200)}` : null,
    mem?.recent?.length ? `Don't repeat hooks: ${mem.recent.slice(-3).join(' | ').slice(0, 200)}` : null,
  ].filter(Boolean);
  return lines.join('\n');
}

// Special hard rules from the master prompt that must survive compaction.
export function globalBrandRules() {
  return [
    'Caption: hook + 1 useful detail + 1 CTA, 25-55 words (8-25 comedy/cinematic, 45-90 info). No em dash. Emojis: standard 2-4 placed naturally; real offers/openings 4-8 with excitement.',
    'Append footer, then exactly 3 hashtags, then [5-8 SEO phrases]. Never reuse another brand footer. Real supplied offer facts (first 100, 0.5gm gold) are celebrated with urgency; never invent offers.',
    'MAP Clothing + Carrara never funny. Luxxe = transformation only. Rajlaxmi Sangli = Marathi. Hazel: no mithai word. Smietz: include 35 years experience + 96045 23931.',
    'Never invent phone/address/price/offers/results/quotes. Omit unknown optionals; ask only if essential.',
  ].join('\n');
}

// Save / upgrade memory WITHOUT any LLM call (file append, capped sizes).
export function learnBrand(brandId, { assetHint, finalCaption, correction } = {}) {
  const mem = loadMemory();
  mem.brands = mem.brands || {};
  const e = mem.brands[brandId] || { count: 0, recent: [] };
  e.count += 1;
  e.updatedAt = new Date().toISOString();
  if (assetHint && !e.hints?.includes(assetHint)) {
    e.hints = [...(e.hints || []), String(assetHint).slice(0, 120)].slice(-5);
  }
  if (finalCaption) {
    const hook = String(finalCaption).split('\n')[0].slice(0, 120);
    e.recent = [...(e.recent || []), hook].slice(-5);
  }
  if (correction) e.notes = String(correction).slice(0, 300);
  // hard cap: keep file < ~20KB forever
  mem.brands[brandId] = e;
  const raw = JSON.stringify(mem);
  if (raw.length < 25000) fs.writeFileSync(MEMORY_PATH, JSON.stringify(mem, null, 1));
  return e;
}
