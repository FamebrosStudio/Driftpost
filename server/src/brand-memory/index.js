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
const CUSTOM_PATH = path.join(here, 'brands.custom.json');
const MAX_AUTO = 50;

let cache = null;
function loadCustom() {
  try {
    const d = JSON.parse(fs.readFileSync(CUSTOM_PATH, 'utf8'));
    return Array.isArray(d.brands) ? d.brands : [];
  } catch {
    return [];
  }
}
function saveCustom(brands) {
  const raw = JSON.stringify({ version: 1, brands: brands.slice(0, MAX_AUTO) });
  if (raw.length < 30000) fs.writeFileSync(CUSTOM_PATH, raw);
}
export function loadBrands() {
  if (!cache) cache = JSON.parse(fs.readFileSync(COMPACT_PATH, 'utf8'));
  // Custom/auto-onboarded brands merge in — matcher sees them like natives.
  // Reloaded per call would cost disk IO; refresh when custom file changes.
  try {
    const st = fs.statSync(CUSTOM_PATH);
    if (!cache._customMtime || cache._customMtime < st.mtimeMs) {
      cache = { brands: [...JSON.parse(fs.readFileSync(COMPACT_PATH, 'utf8')).brands, ...loadCustom()], _customMtime: st.mtimeMs };
    }
  } catch {}
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
  const deep = brand?.id ? getDeepForCompact(brand) || getDeepBrand(brand.id) : null;
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
    mem?.recent?.length ? `Approved voice — same energy, new words, never copy exactly: ${mem.recent.slice(-3).join(' | ').slice(0, 200)}` : null,
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
      // Alias keys: file brand_ids don't always match the compact index
      // (reshine_skin_clinic vs reshine_clinic), so also file by name slug.
      if (d.brand_name) deepCache[`name:${slugify(d.brand_name)}`] = d;
    } catch {}
  }
  return deepCache;
}

export function getDeepBrand(brandId) {
  const all = loadDeepAll();
  return all[brandId] || all[`name:${slugify(brandId)}`] || null;
}

// Resolve a deep file for a compact index brand (handles id mismatches).
export function getDeepForCompact(compactBrand) {
  if (!compactBrand) return null;
  const all = loadDeepAll();
  if (all[compactBrand.id]) return all[compactBrand.id];
  const nameSlug = slugify(compactBrand.name);
  if (all[nameSlug] || all[`name:${nameSlug}`]) return all[nameSlug] || all[`name:${nameSlug}`];
  for (const b of loadBrands()) {
    if (b.id === compactBrand.id) {
      for (const a of [b.name, ...(b.aliases || [])]) {
        const hit = all[slugify(a)] || all[`name:${slugify(a)}`];
        if (hit) return hit;
      }
    }
  }
  // Token fallback: "Reshine Clinic" vs file "Reshine Skin Clinic" share
  // a distinctive token (reshine). Accept on a 6+ char shared token.
  const mine = new Set(
    [compactBrand.name, ...(compactBrand.aliases || [])]
      .flatMap((s) => norm(s).split(' '))
      .filter((t) => t.length > 4)
  );
  let best = null;
  let bestLen = 0;
  for (const k of Object.keys(all)) {
    if (k.startsWith('name:')) continue;
    const d = all[k];
    const theirs = new Set(
      [d.brand_name, ...(d.aliases || [])].flatMap((s) => norm(s).split(' ')).filter((t) => t.length > 4)
    );
    for (const t of mine) {
      if (theirs.has(t) && t.length > bestLen) {
        bestLen = t.length;
        best = d;
      }
    }
  }
  return bestLen >= 6 ? best : null;
}

export function deepBrandIds() {
  return Object.keys(loadDeepAll());
}

// Footer/phone/address readers that tolerate every file variant seen so far:
// fixed_footer.lines | .full_lines | .<branch>_only_lines (never group_*),
// .compact_designation_line + social/agency (public figures),
// .*general*lines (multi-footer brands: brand-wide default),
// footer_policy.confirmed_footer_lines; contact.phone_display |
// .primary_phone_display | .customer_care_display.
export function deepFooter(deep) {
  const ff = deep?.fixed_footer;
  if (ff) {
    if (ff.prefer_group_footer && ff.group_footer_lines?.length) return ff.group_footer_lines;
    if (ff.lines?.length) return ff.lines;
    if (ff.full_lines?.length) return ff.full_lines;
    const only = Object.keys(ff).filter((k) => k.endsWith('_only_lines') && Array.isArray(ff[k]) && ff[k].length);
    if (only.length) return ff[only[0]];
    // Public-figure format: compact designation + social + agency (routine captions).
    if (typeof ff.compact_designation_line === 'string' && ff.compact_designation_line.trim()) {
      return [ff.compact_designation_line.trim(), ff.social_line, ff.agency_line].filter((l) => typeof l === 'string' && l.trim());
    }
    // Multi-footer brands: the *general* footer is the brand-wide default
    // (campaign/showroom footers apply only to those posts).
    const general = Object.keys(ff).find((k) => /general/i.test(k) && k.endsWith('_lines') && Array.isArray(ff[k]) && ff[k].length);
    if (general) return ff[general];
  }
  if (deep?.footer_policy?.confirmed_footer_lines?.length) return deep.footer_policy.confirmed_footer_lines;
  // Last resort: first *_lines array present (never usage/rules strings).
  if (ff) {
    const any = Object.keys(ff).find((k) => k.endsWith('_lines') && Array.isArray(ff[k]) && ff[k].length);
    if (any) return ff[any];
  }
  return [];
}

export function deepPhone(deep) {
  return deep?.contact?.phone_display || deep?.contact?.primary_phone_display || deep?.contact?.customer_care_display || '';
}

export function deepAddress(deep) {
  return deep?.contact?.full_address || '';
}
// Pack built from the Specific-brands deep format (~600-800 tokens).
// Precedence inside: owner memory correction > master instruction > playbook.
export function deepPack(deep, brand) {
  const mem = loadMemory().brands?.[deep.brand_id];
  // CTA bank keys vary per file (booking/enquiry/visit/call/shop/...):
  // collect every array, skip the selection_rule note.
  const cta = deep.cta_bank
    ? Object.entries(deep.cta_bank)
        .filter(([k, v]) => k !== 'selection_rule' && Array.isArray(v))
        .flatMap(([, v]) => v)
        .filter((s) => typeof s === 'string' && s.trim())
        .filter((v, i, a) => a.indexOf(v) === i)
        .slice(0, 6)
    : [];
  // Hashtag buckets vary too (brand/category/occasion/location/personal/...):
  // collect every array except meta keys; campaign-only tags stay out of the
  // default bank and are surfaced as a conditional note instead.
  const SKIP_TAG_KEYS = new Set(['rule', 'conditional', 'campaign_only_when_active']);
  const tags = deep.suggested_hashtag_bank
    ? Object.entries(deep.suggested_hashtag_bank)
        .filter(([k, v]) => !SKIP_TAG_KEYS.has(k) && Array.isArray(v))
        .flatMap(([, v]) => v)
        .filter((s) => typeof s === 'string' && s.trim())
        .filter((v, i, a) => a.indexOf(v) === i)
        .slice(0, 8)
    : [];
  const campaignTags = Array.isArray(deep.suggested_hashtag_bank?.campaign_only_when_active)
    ? deep.suggested_hashtag_bank.campaign_only_when_active.filter((s) => typeof s === 'string' && s.trim())
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
    // Public-figure designation block (approved titles — never reword into current office).
    Array.isArray(deep.business?.approved_designation_block) && deep.business.approved_designation_block.length
      ? `Approved titles (use exactly, never upgrade to current office): ${deep.business.approved_designation_block.join(' | ')}`
      : null,
    deep.business?.public_positioning ? `Positioning: ${deep.business.public_positioning}` : null,
    deepPhone(deep) ? `Phone: ${deepPhone(deep)}` : null,
    deepAddress(deep) ? `Address: ${deepAddress(deep)}` : null,
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
    campaignTags.length ? `Campaign-only tags (use ONLY when that offer/campaign is active): ${campaignTags.join(' ')}` : null,
    typeof deep.suggested_hashtag_bank?.rule === 'string' ? `Tag rule: ${deep.suggested_hashtag_bank.rule}` : null,
    (deep.seo_keyword_bank || []).length ? `SEO keywords: ${deep.seo_keyword_bank.slice(0, 9).join(', ')}` : null,
    (deepFooter(deep).length
      ? `Footer (append exactly):\n${deepFooter(deep).join('\n')}`
      : null),
    play ? `Playbook:\n${play}` : null,
    deep.sample_caption?.text ? `Style example (match energy, never copy facts):\n${String(deep.sample_caption.text).slice(0, 600)}` : null,
    (deep.accuracy_rules || []).length ? `Accuracy: ${deep.accuracy_rules.slice(0, 5).join(' ')}` : null,
    mem?.notes ? `Owner correction (wins over all above): ${String(mem.notes).slice(0, 300)}` : null,
    mem?.recent?.length ? `Approved voice — same energy, new words, never copy exactly: ${mem.recent.slice(-3).join(' | ').slice(0, 200)}` : null,
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
    mem?.recent?.length ? `Approved voice — same energy, new words, never copy exactly: ${mem.recent.slice(-3).join(' | ').slice(0, 200)}` : null,
  ].filter(Boolean);
  return lines.join('\n');
}

// --- Brief breakdown: GOOD PROMPT = GOOD CAPTION, BAD PROMPT = plain answer.
// Parses any brief into | BRAND | MOTIVE | WHEN | TYPE |, all locally, free.
// Rich briefs get a structured breakdown the writer must honor; thin/nonsense
// briefs are flagged WEAK so the model answers directly instead of forcing
// structure onto garbage.
const OFFER_RE = /(\d+\s*%|\boff\b|offer|discount|deal|free|gold|gift|first\s+\d+|only\s+\d+|launch|opening|new\s+(shop|store|branch|collection)|sale|combo|valid|expire|hurry|limited)/i;
const WHEN_RE = /(before\s+\d+[a-z]*|after\s+\d+[a-z]*|till\s+[a-z0-9 ]+|valid[^.,;]*|first\s+\d+[^.,;]*|only\s+\d+[^.,;]*|ends[^.,;]*|today|tomorrow|this\s+week|this\s+month|\d+\s*(am|pm))/i;
const FUNNY_RE = /(funny|comedy|comic|meme|skit|prank|bloopers|laugh|relatable|sarcasm)/i;
const REVIEW_RE = /(review|feedback|testimonial|rating|customer\s+said|client\s+said|google\s+review)/i;
const INFO_RE = /(tips?|guide|how\s+to|benefits?|why\s+|explained|awareness|myths?|facts?|did\s+you\s+know)/i;
const SHOW_RE = /(transformation|makeover|reveal|before\s*(and|\/|-) *after|new\s+look|result|showcase|walkthrough|tour|photoshoot)/i;

export function parseBrief(brief, brand) {
  const b = String(brief || '');
  const words = b.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2);
  const weak = b.trim().length < 15 || words.length < 3;
  let motive = 'general post';
  let type = 'standard: warm hook + detail + concrete CTA';
  if (OFFER_RE.test(b)) {
    const all = b.match(new RegExp(OFFER_RE.source, 'gi')) || [];
    const best = all.find((x) => /\d/.test(x)) || all[0];
    motive = `OFFER — ${best.trim()}`;
    type = 'HYPE/OFFER: bold excited hook, exact terms, urgency, tag-a-friend CTA';
  } else if (FUNNY_RE.test(b)) {
    motive = 'entertainment';
    type = 'FUNNY: one punchline from the reel, tag/share CTA, never insult';
  } else if (REVIEW_RE.test(b)) {
    motive = 'social proof';
    type = 'REVIEW: use only the actual feedback given, faithful paraphrase';
  } else if (INFO_RE.test(b)) {
    motive = 'education';
    type = 'INFORMATIONAL: one clear takeaway + save/enquiry CTA';
  } else if (SHOW_RE.test(b)) {
    motive = 'showcase';
    type = 'SHOWCASE: describe the visible result with sensory words';
  }
  const when = (b.match(WHEN_RE)?.[0] || '').trim();
  return {
    brand: brand?.name || 'unknown',
    motive,
    when: when || 'no time limit stated',
    type,
    weak,
  };
}

export function breakdownBlock(parsed) {
  if (parsed.weak) {
    return `\nBRIEF STATUS: WEAK — the prompt is thin or nonsense. Answer directly and briefly from exactly what was asked. Do not force hype, footer theater, or invented details. GOOD PROMPT = GOOD CAPTION, BAD PROMPT = plain direct output.`;
  }
  return `\nBRIEF BREAKDOWN (honor every slot):\n| BRAND = ${parsed.brand} | MOTIVE = ${parsed.motive} | WHEN/CONDITIONS = ${parsed.when} | TYPE = ${parsed.type} |`;
}
export function globalBrandRules() {
  return [
    'Caption: hook + 1 useful detail + 1 CTA (length and emoji count follow the user request). No em dash. Real supplied offer facts (first 100, 0.5gm gold) are celebrated with urgency; never invent offers.',
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

// --- Auto-onboarding: unknown brands get stored + upgraded, zero LLM tokens.
// Trigger: explicit brand label (picked/typed) that matches nothing, or a
// business-type name inside the brief ("XYZ Salon", "ABC Jewellers").
// Generic prompts ("diwali offer") never create brands.
const BIZ_WORDS = /(salon|lounge|studio|clinic|jewellers|jewels|clothing|apparel|boutique|furniture|interior|resort|hotel|motors|garage|hospital|dental|school|classes|footwear|sneakers|saree|tailor|dryfruits|bakery|cafe|restaurant|fitness|gym|spa|nails|tattoo|photography|decor|mart|store|bakers|cakes)/i;

export function slugify(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'brand';
}

function extractPhones(text) {
  const out = new Set();
  const re = /(?:\+91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}/g;
  let m;
  while ((m = re.exec(String(text || '')))) {
    const digits = m[0].replace(/\D/g, '').slice(-10);
    if (digits.length === 10) out.add(`+91 ${digits.slice(0, 5)} ${digits.slice(5)}`);
    if (out.size >= 2) break;
  }
  return [...out];
}

function candidateFromBrief(brief) {
  const m = String(brief || '').match(/\b([A-Z][A-Za-z&'’]{1,24}(?:\s+[A-Z][A-Za-z&'’]{1,24}){0,3})\b/);
  if (!m) return '';
  const name = m[1].trim();
  if (name.length < 4 || name.length > 48) return '';
  if (!BIZ_WORDS.test(name)) return '';
  return name;
}

// Main entry: returns {brand, isNew} or null when nothing brand-like found.
// Creates brands/auto-<slug>.json deep file + custom index entry on first sight,
// then upgrades topics/phones/hints on every later sighting. All local, free.
export function ensureAutoBrand({ brandParam, brief, assetHint }) {
  let name = String(brandParam || '').trim().slice(0, 60);
  let via = 'label';
  if (!name) {
    name = candidateFromBrief(brief);
    via = 'brief';
  }
  if (!name || name.length < 3) return null;
  if (/^(instagram|facebook|youtube|post|reel|photo|video|offer|diwali)$/i.test(name)) return null;

  const custom = loadCustom();
  const slug = slugify(name);
  let entry = custom.find((c) => c.id === slug || norm(c.name) === norm(name));
  const phones = extractPhones(`${brandParam} ${brief}`);
  const topic = String(brief || '').split('\n')[0].slice(0, 120);

  if (!entry) {
    if (custom.length >= MAX_AUTO) return null;
    entry = {
      id: slug, name, aliases: [], cat: 'local brand', loc: '',
      genres: [], tone: 'Warm, vivid, human', lang: '', cta: [],
      avoid: [], kw: [name], footer: ['💫 Managed by: @famebrosstudio'],
      mandatory: [], ex: '', ig: null, ready: '', auto: true, via,
      count: 0, topics: [],
    };
    custom.push(entry);
    try { saveCustom(custom); } catch {}
    cache = null; // force matcher to see the newcomer immediately
  }
  entry.count = (entry.count || 0) + 1;
  if (topic && !entry.topics?.includes(topic)) entry.topics = [...(entry.topics || []), topic].slice(-5);
  try { saveCustom(custom); } catch {}

  // Auto deep file: full detail shelf for this brand, upgraded each sighting.
  const autoPath = path.join(DEEP_DIR, `auto-${slug}.json`);
  let auto = null;
  try { auto = JSON.parse(fs.readFileSync(autoPath, 'utf8')); } catch {}
  if (!auto) {
    auto = {
      schema_version: 'auto-1', brand_id: slug, brand_name: name,
      knowledge_scope: 'Auto-onboarded from live prompts. Facts below are observed, not owner-confirmed.',
      business: { category: entry.cat, location_area: '' },
      contact: { phone_display: null, full_address: null },
      social_media: {},
      master_brand_instruction: `Write as ${name}. Warm, vivid, human voice. Hook + supporting detail + concrete CTA, 2+ sentences. Append the agency footer, exactly 3 hashtags, one SEO bracket. Never invent phone, address, prices or offers.`,
      fixed_footer: { lines: ['💫 Managed by: @famebrosstudio'] },
      seo_keyword_bank: [name],
      cta_bank: { booking: [], save: ['Save this for later.'] },
      suggested_hooks: [], suggested_hashtag_bank: { brand: [], location: [], topic: [] },
      sample_caption: null, accuracy_rules: [], observed_briefs: [], confirmed: false,
    };
  }
  if (phones.length && !auto.contact.phone_display) {
    auto.contact.phone_display = phones[0]; // observed, unconfirmed until owner says so
  }
  if (topic && !(auto.observed_briefs || []).includes(topic)) {
    auto.observed_briefs = [...(auto.observed_briefs || []), topic].slice(-8);
    const words = topic.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 4 && !/^(with|from|that|this|your|hair|shop|store)$/.test(w)).slice(0, 3);
    for (const w of words) {
      const phrase = `${w} ${entry.cat === 'local brand' ? '' : ''}`.trim();
      if (phrase && !auto.seo_keyword_bank.includes(phrase) && auto.seo_keyword_bank.length < 9) auto.seo_keyword_bank.push(phrase);
    }
    if (!auto.seo_keyword_bank.includes(name)) auto.seo_keyword_bank.unshift(name);
  }
  if (assetHint && !(auto.observed_assets || []).includes(assetHint)) {
    auto.observed_assets = [...(auto.observed_assets || []), String(assetHint).slice(0, 120)].slice(-5);
  }
  try {
    const raw = JSON.stringify(auto);
    if (raw.length < 12000) fs.writeFileSync(autoPath, JSON.stringify(auto, null, 1));
  } catch {}
  deepCache = null; // new/changed shelf file must be visible immediately
  // learning memory counts it too
  try { learnBrand(slug, { assetHint: assetHint || topic }); } catch {}
  return { brand: { ...entry, kw: auto.seo_keyword_bank?.length ? auto.seo_keyword_bank : entry.kw }, isNew: entry.count <= 1, auto };
}
