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
  { id: 'instagram', name: 'Instagram', hint: 'Photo or reel + caption' },
  { id: 'facebook', name: 'Facebook', hint: 'Text, photo or video' },
  { id: 'x', name: 'X', hint: '280 characters max' },
];

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

const TOKENS = (s) => norm(s).split(' ').filter((t) => t.length > 3);

// Similarity between two account names across platforms (page name vs IG handle etc).
export function brandScore(a, b) {
  const ta = TOKENS(a);
  const tb = TOKENS(b);
  if (!ta.length || !tb.length) return 0;
  const na = norm(a);
  const nb = norm(b);
  if (na.includes(nb) && nb.length > 4) return 100;
  if (nb.includes(na) && na.length > 4) return 100;
  // Spaceless comparison: "@famebrosstudio" must equal "Famebros Studio".
  const fa = na.replace(/ /g, '');
  const fb = nb.replace(/ /g, '');
  if (fa === fb && fa.length > 3) return 100;
  if (fa.includes(fb) && fb.length > 5) return 90;
  if (fb.includes(fa) && fa.length > 5) return 90;
  let score = 0;
  for (const t of ta) {
    if (tb.includes(t)) score += t.length >= 6 ? 30 : 10;
  }
  return score;
}

// Group connections into brands keyed by Facebook page (agency thinks in pages),
// plus standalone entries for accounts with no page match.
export function groupBrands(connections) {
  const byPlat = {};
  connections.forEach((c) => { (byPlat[c.platform] = byPlat[c.platform] || []).push(c); });
  const used = new Set();
  const brands = [];
  for (const fb of byPlat.facebook || []) {
    const brand = { key: `fb:${fb.id}`, label: fb.account_name, map: { facebook: fb.id } };
    for (const p of ['instagram', 'youtube', 'x']) {
      let best = null;
      let bestScore = 0;
      for (const c of byPlat[p] || []) {
        if (used.has(c.id)) continue;
        const s = brandScore(fb.account_name, c.account_name);
        if (s > bestScore) { bestScore = s; best = c; }
      }
      if (best && bestScore >= 10) { brand.map[p] = best.id; used.add(best.id); }
    }
    brands.push(brand);
  }
  for (const p of ['instagram', 'youtube', 'x']) {
    for (const c of byPlat[p] || []) {
      if (!used.has(c.id)) brands.push({ key: `${p}:${c.id}`, label: c.account_name, map: { [p]: c.id } });
    }
  }
  brands.sort((a, b) => a.label.localeCompare(b.label));
  return brands;
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
