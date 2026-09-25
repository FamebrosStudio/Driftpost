const apiUrlRaw = import.meta.env.VITE_API_URL;
export const apiUrl = apiUrlRaw?.replace(/\/$/, '') || '';

// Optional server-backed brand list with safe fallback.
// Keeps current behaviour identical when the API is unreachable.
let brandsCache = null;
let brandsCacheTime = 0;
const BRAND_CACHE_MS = 5 * 60 * 1000;

export async function fetchBrands(token) {
  try {
    const now = Date.now();
    if (brandsCache && (now - brandsCacheTime) < BRAND_CACHE_MS) return brandsCache;
    if (!apiUrl || !token) return ACTIVE_BRANDS;
    const res = await fetch(`${apiUrl}/api/ai/brands`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.brands) && data.brands.length) {
        brandsCache = data.brands;
        brandsCacheTime = now;
        return brandsCache;
      }
    }
  } catch {}
  return ACTIVE_BRANDS;
}

export function invalidateBrandsCache() {
  brandsCache = null;
  brandsCacheTime = 0;
}

export const PLATFORMS = [
  { id: 'youtube', name: 'YouTube', hint: 'Video + title required' },
  { id: 'instagram', name: 'Instagram', hint: 'Photo(s) or reel + caption' },
  { id: 'facebook', name: 'Facebook', hint: 'Text, photo(s) or video' },
  { id: 'x', name: 'X', hint: '280 characters max' },
];

// One-tap trio: the 3 jeweller brands that always post together.
// Matched by substring so "(Kurla)/(Chembur)/(Ghatla)" suffixes still hit.
export const TRIO_BRANDS = [
  'Shree Mahalaxmi Jewellers',
  'Kanchanmala Jewellers',
  'Mahalaxmi Jewellers',
];

export function findTrioBrands(brands) {
  const norm = (s) => String(s || '').toLowerCase();
  // Longest names first so "Shree Mahalaxmi" wins over plain "Mahalaxmi".
  const sorted = [...TRIO_BRANDS].sort((a, b) => b.length - a.length);
  const out = [];
  const taken = new Set();
  for (const name of sorted) {
    const hit = (brands || []).find((b) => !taken.has(b.key) && norm(b.label).includes(norm(name)));
    if (hit) { out.push({ name, brand: hit }); taken.add(hit.key); }
  }
  return out;
}

// Active client brands. Connections matching these get an "Active" badge;
// everything else can be hidden so inactive accounts stay out of the way.
export const ACTIVE_BRANDS = [
  'Hair Match Salon', 'Velvet Salon', 'UNS Creation', 'Reshine Clinic', 'AK Factor',
  'Vivid Resort', 'Cocos Inn Resort', 'SK Furniture', 'Shree Mahalaxmi Jewellers (Kurla)',
  'Kanchanmala Jewellers (Chembur)', 'Mahalaxmi Jewellers (Ghatla)', 'Synergic Interior',
  'Ali Salon', 'Jolly Tailor', 'Pardesi Sneakers', 'VJ Jewels', 'Charan Singh Sapra',
  'Roopali Saree', 'MAP Clothing', 'Luxxe Nail Studio', 'Bhanu Designer', 'Smietz Beauty Hub',
  'Carrara Trouser Manufacturer', 'Rajlaxmi Jewellers (Sangli)', 'Devi & Company (Kanpur)',
  'Hazel Dryfruits', 'The Creamy Layer', 'Zam Zam Motors', 'Avnikk Collection',
  'Laxya Lel Fitness', 'Qash Makeover', 'Asma Women Clothing', 'Paak Pehnawa Mens',
  'Pixi Grow', 'Sarang Hospital', 'GS Shetty School Bhandup', 'Seven Cube Footwear',
  'Sarama Furniture', 'OLVKIIXK', 'Anand Furniture',
];

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

export function isActiveBrand(accountName) {
  const a = norm(accountName);
  if (!a) return false;
  return ACTIVE_BRANDS.some((b) => {
    const n = norm(b);
    return a.includes(n) || n.includes(a);
  });
}

const STOP = new Set(['for', 'the', 'and', 'of']);
const TOKENS = (s) => norm(s).split(' ').filter((t) => t.length >= 3 && !STOP.has(t));

// Similarity between two account names across platforms (page name vs IG handle etc).
// Exact / substring / handle matches run FIRST so short-word brands
// ("MAP for men" vs "@map_for_men") never fall through the token guard.
// `rare` = tokens used by few accounts: sharing one is strong evidence
// ("map"), sharing a common one ("salon") is weak — scored accordingly.
export function brandScore(a, b, rare = null) {
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return 0;
  if (na.includes(nb) && nb.length > 4) return 100;
  if (nb.includes(na) && na.length > 4) return 100;
  // Spaceless comparison: "@famebrosstudio" must equal "Famebros Studio".
  const fa = na.replace(/ /g, '');
  const fb = nb.replace(/ /g, '');
  if (fa === fb && fa.length > 3) return 100;
  if (fa.includes(fb) && fb.length > 5) return 90;
  if (fb.includes(fa) && fa.length > 5) return 90;
  const ta = TOKENS(a);
  const tb = TOKENS(b);
  if (!ta.length || !tb.length) return 0;
  let score = 0;
  let bonusUsed = false;
  const seen = new Set();
  for (const t of ta) {
    if (seen.has(t) || !tb.includes(t)) continue;
    seen.add(t);
    score += 10;
    if (!bonusUsed && rare && rare.has(t)) { score += 20; bonusUsed = true; }
  }
  return score;
}

// Group connections into brands. Anchors in priority order: a Facebook page
// first (agency thinks in pages), then leftover Instagram accounts, then
// leftover YouTube ones. X never anchors — it only joins. So IG+X (or YT+X)
// of one business form ONE brand instead of lonely single-platform rows,
// while page-first matching is preserved whenever a page exists.
export function groupBrands(connections) {
  const byPlat = {};
  connections.forEach((c) => { (byPlat[c.platform] = byPlat[c.platform] || []).push(c); });
  // Rare-word set: tokens used by few accounts ("map") prove sameness;
  // tokens everywhere ("salon") prove nothing. Recomputed per grouping.
  const df = new Map();
  connections.forEach((c) => {
    new Set(TOKENS(c.account_name)).forEach((t) => df.set(t, (df.get(t) || 0) + 1));
  });
  const rareLimit = Math.max(2, Math.ceil(connections.length * 0.1));
  const rare = new Set([...df].filter(([, d]) => d <= rareLimit).map(([t]) => t));
  const used = new Set();
  const brands = [];
  const anchorOrder = ['facebook', 'instagram', 'youtube'];
  const joinable = {
    facebook: ['instagram', 'youtube', 'x'],
    instagram: ['youtube', 'x'],
    youtube: ['x'],
  };
  for (const a of anchorOrder) {
    for (const anchor of byPlat[a] || []) {
      if (brands.some((b) => b.map[a] === anchor.id)) continue;
      brands.push({ key: `${a}:${anchor.id}`, label: anchor.account_name, map: { [a]: anchor.id } });
    }
  }
  const claimedBy = new Map();
  // Two passes so a sure match always beats a fuzzy one: an exact handle
  // can never be stolen by another account that only vaguely resembles it.
  // FB-seeded brands pick first (seed order), preserving page priority.
  const tryMatch = (min) => {
    for (const brand of brands) {
      const anchorPlat = Object.keys(brand.map)[0];
      for (const p of joinable[anchorPlat] || []) {
        if (brand.map[p]) continue;
        let best = null;
        let bestScore = 0;
        for (const c of byPlat[p] || []) {
          if (used.has(c.id)) continue;
          const s = brandScore(brand.label, c.account_name, rare);
          if (s > bestScore) { bestScore = s; best = c; }
        }
        // Threshold 30: exact/substring/handle matches (90–100) always pass;
        // fuzzy word matches need a rare shared word (10 + 20 bonus).
        // Generic single words ("salon") score 10 and never merge businesses.
        if (best && bestScore >= min) { brand.map[p] = best.id; used.add(best.id); claimedBy.set(best.id, brand); }
      }
    }
  };
  tryMatch(90);
  tryMatch(30);
  // Dissolve hollow seeds: an anchor claimed by a stronger brand leaves
  // behind an empty single-account row — drop it so the account shows once,
  // under its real brand, with all linked platforms.
  const alive = brands.filter((b) => {
    const ids = Object.values(b.map);
    if (ids.length > 1) return true;
    const by = claimedBy.get(ids[0]);
    return !by || by === b;
  });
  for (const c of byPlat.x || []) {
    if (!used.has(c.id)) alive.push({ key: `x:${c.id}`, label: c.account_name, map: { x: c.id } });
  }
  alive.sort((a, b) => a.label.localeCompare(b.label));
  return alive;
}

// Fresh start after posting: wipes the finished post's content (media,
// prompt, outputs, done flags) and returns to Stage 1. Account setup,
// groups, style prefs, cross-post choice and the AI answer cache survive.
export async function resetPostState() {
  const DROP = ['driftpost-stage2-brief', 'driftpost-stage2-outputs', 'driftpost-stage2-done', 'driftpost-stage1-done'];
  try {
    const rm = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && DROP.some((p) => k.startsWith(p))) rm.push(k);
    }
    rm.forEach((k) => localStorage.removeItem(k));
    localStorage.setItem('driftpost-stage', '1');
  } catch {}
  try {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('driftpost-stage2', 1);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    await new Promise((res) => {
      try {
        const tx = db.transaction('media', 'readwrite');
        tx.objectStore('media').clear();
        tx.oncomplete = res; tx.onerror = res;
      } catch { res(); }
    });
    db.close();
  } catch {}
}

export async function api(path, token, options = {}) {
  const res = await fetch(`${apiUrl}${path}`, {
    ...options,
    headers: {
      ...(options.headers || {}),
      Authorization: `Bearer ${token}`,
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}
