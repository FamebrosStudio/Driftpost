// Brand memory: local-first, zero-LLM-token brand resolver + per-brand pack.
// Goal: NEVER send all 41 brands to the LLM. Resolve locally, inject ONE brand (~200 tokens).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const COMPACT_PATH = path.join(here, 'brands.compact.json');
const MEMORY_PATH = path.join(here, 'memory.json');

let cache = null;
export function loadBrands() {
  if (!cache) cache = JSON.parse(fs.readFileSync(COMPACT_PATH, 'utf8'));
  return cache.brands;
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
    'Caption: hook + 1 useful detail + 1 CTA, 25-55 words (8-25 comedy/cinematic, 45-90 info). No em dash. 0-2 emojis.',
    'Append footer, then exactly 3 hashtags, then [5-8 SEO phrases]. No viral tags. Never reuse another brand footer.',
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
