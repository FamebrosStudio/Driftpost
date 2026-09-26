import { getSupabase, pokeSession } from './session.js';

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

// Edit distance for typo tolerance ("reshinee" vs "reshine",
// missing dots/underscores). Only used on long handles.
function lev(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = new Array(n + 1);
  let cur = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    const ca = a[i - 1];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca === b[j - 1] ? 0 : 1));
    }
    const tmp = prev; prev = cur; cur = tmp;
  }
  return prev[n];
}

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
  // Near-identical long handles: typos, missing dots ("reshinee" vs
  // "reshine"). Scores 80 — below exact tiers, above fuzzy word scores.
  if (fa.length >= 8 && fb.length >= 8 && Math.abs(fa.length - fb.length) <= 2) {
    const allow = Math.max(1, Math.min(2, Math.floor(Math.min(fa.length, fb.length) * 0.12)));
    if (lev(fa, fb) <= allow) return 80;
  }
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

// Queue a post for the server to publish later. Media rides along as
// multipart so the worker can rebuild the exact upload at fire time.
export async function schedulePost(token, { platform, connectionId, when, body, files = [], thumb = null }) {
  const form = new FormData();
  form.append('platform', platform);
  form.append('connection_id', connectionId || '');
  form.append('scheduled_at', when);
  for (const [k, v] of Object.entries(body || {})) form.append(k, v == null ? '' : String(v));
  for (const f of files) if (f?.raw) form.append('media', f.raw, f.name);
  if (thumb?.raw) form.append('thumbnail', thumb.raw, thumb.name);
  const res = await fetch(`${apiUrl}/api/schedule`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Could not schedule the post');
  return data.schedule;
}

export const listSchedules = (token) => api('/api/schedules', token).then((d) => d.schedules || []);
export const cancelSchedule = (token, id) => api(`/api/schedules/${id}`, token, { method: 'DELETE' });

// Fresh start after posting: wipes the finished post's content (media,
// prompt, outputs, per-card review/account choices, done flags) and returns
// to Stage 1. Account setup, groups, style prefs, cross-post choice and the
// AI answer cache survive. Only the given user's media vault entry is
// dropped — never the whole vault (shared browsers hold several users).
export async function resetPostState(userId) {
  const DROP = ['driftpost-stage2-brief', 'driftpost-stage2-outputs', 'driftpost-stage2-done', 'driftpost-stage1-done', 'driftpost-stage3-reviewed', 'driftpost-stage3-accounts'];
  try {
    const rm = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && DROP.some((p) => k.startsWith(p))) rm.push(k);
    }
    rm.forEach((k) => localStorage.removeItem(k));
    localStorage.setItem('driftpost-stage', '1');
  } catch {}
  if (!userId) return;
  try {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('driftpost-stage2', 1);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    await new Promise((res) => {
      try {
        const tx = db.transaction('media', 'readwrite');
        tx.objectStore('media').delete(`driftpost-stage2-media:${userId}`);
        tx.oncomplete = res; tx.onerror = res;
      } catch { res(); }
    });
    db.close();
  } catch {}
}

// A dead server answers nothing at all (the browser reports it as a CORS
// or network failure) — say what it actually means instead of passing the
// cryptic text through.
const DOWN_MSG = 'Server is unreachable — it may be waking up. Wait a minute and retry.';
const isNetworkFail = (e) => e?.name === 'TypeError'
  || /Failed to fetch|Network request failed|NetworkError|Load failed/i.test(String(e?.message || ''));

// One shared refresh flight: ten 401s at once trigger exactly one token
// refresh, and every waiter replays with the same fresh token.
let refreshInflight = null;
async function freshToken() {
  try {
    if (!refreshInflight) {
      refreshInflight = (async () => {
        const client = await getSupabase();
        if (!client) return null;
        const { data, error } = await client.auth.refreshSession();
        if (error || !data?.session?.access_token) return null;
        try { pokeSession(); } catch {}
        return data.session.access_token;
      })().finally(() => { refreshInflight = null; });
    }
    return await refreshInflight;
  } catch {
    return null;
  }
}

// Seconds until this JWT expires (0 = unreadable — don't guess).
const expOf = (t) => {
  try {
    const p = JSON.parse(atob(String(t || '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return Number(p.exp) || 0;
  } catch { return 0; }
};
// Pre-flight: a token dying within 60s (or already dead) is swapped BEFORE
// the request — a 65MB upload can outlive the token it started with, and
// every poll after that would 401 one by one.
async function ensureFresh(token) {
  if (!token) return token;
  const exp = expOf(token);
  if (!exp || exp * 1000 > Date.now() + 60000) return token;
  try {
    const f = await freshToken();
    return f || token;
  } catch { return token; }
}

export async function api(path, token, options = {}) {
  // Every request carries a timeout so a cold/sleeping server can never hang
  // a button forever. Safe GETs get one transparent retry (no side effects);
  // writes fail fast with a plain message instead of hanging.
  // A 401 replays exactly once with a freshly-refreshed login token first —
  // the rejected attempt never reached any route, so replays are safe.
  const method = String(options.method || 'GET').toUpperCase();
  const call = async (t, timeoutMs) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`${apiUrl}${path}`, {
        ...options,
        signal: ctrl.signal,
        headers: {
          ...(options.headers || {}),
          Authorization: `Bearer ${t}`,
          ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        },
      });
      const ct = res.headers.get('content-type') || '';
      // A same-origin index.html fallback (wrong API URL) is HTML, not JSON
      // — say so plainly instead of dying downstream with no message.
      if (!ct.includes('json')) throw new Error('API unreachable — check your connection and try again.');
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        const err = new Error(data.error || 'Session expired');
        err.status = 401;
        throw err;
      }
      if (!res.ok) throw new Error(data.error || 'Request failed');
      return data;
    } catch (e) {
      if (e?.status === 401) throw e;
      if (e?.name === 'AbortError') throw new Error('Server is waking up — try again in a few seconds.');
      if (isNetworkFail(e)) throw new Error(DOWN_MSG);
      throw e;
    } finally {
      clearTimeout(timer);
    }
  };
  const invoke = async (t) => {
    try {
      return await call(t, 25000);
    } catch (e) {
      if (e?.status === 401) throw e;
      const retryable = method === 'GET' && /waking up/i.test(e.message || '');
      if (!retryable) throw e;
      await new Promise((r) => setTimeout(r, 1500));
      return call(t, 30000);
    }
  };
  try {
    return await invoke(await ensureFresh(token));
  } catch (e) {
    if (e?.status !== 401 || !token) throw e;
    const fresh = await freshToken();
    if (!fresh || fresh === token) throw new Error('Session expired — sign out and sign in again.');
    return invoke(fresh);
  }
}

// Raw fetch with the same auth resilience (for FormData posts that need the
// raw response). Returns { res, data, refreshedToken? }.
// The timeout scales with the upload size — a 65MB video can never make a
// 30s budget on a normal connection, so the budget is ~0.5MB/s + 30s
// headroom, capped at 8 minutes. Slow uploads fail as "too slow", never as
// a misleading "waking up".
export async function fetchWithAuth(url, token, init = {}) {
  const { onUploadProgress, ...rest } = init;
  const bodyBytes = (() => {
    try {
      let n = 0;
      const b = rest.body;
      if (b && typeof b.entries === 'function') {
        for (const [, v] of b.entries()) if (v && typeof v.size === 'number') n += v.size;
      }
      return n;
    } catch { return 0; }
  })();
  const budget = Math.min(480000, 30000 + Math.round((bodyBytes / (512 * 1024)) * 1000));
  // Upload phase progress needs XHR (fetch exposes download progress only).
  // The browser fires upload events as bytes leave — mapped to the first 15%.
  const xhrPost = (t) => new Promise((resolve, reject) => {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      xhr.setRequestHeader('Authorization', `Bearer ${t}`);
      if (xhr.upload && onUploadProgress) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable && e.total > 0) {
            onUploadProgress(Math.max(0, Math.min(1, e.loaded / e.total)));
          }
        };
      }
      xhr.onload = () => {
        const ct = xhr.getResponseHeader('content-type') || '';
        let data = {};
        try { data = ct.includes('json') ? JSON.parse(xhr.responseText || '{}') : {}; } catch {}
        if (xhr.status === 401) {
          const err = new Error(data.error || 'Session expired');
          err.status = 401;
          reject(err);
          return;
        }
        resolve({ res: { ok: xhr.status >= 200 && xhr.status < 300, status: xhr.status }, data });
      };
      xhr.onerror = () => reject(new Error(DOWN_MSG));
      xhr.send(rest.body || null);
    } catch (e) { reject(e); }
  });
  const doPost = async (t, timeoutMs) => {
    if (onUploadProgress) return xhrPost(t);
    const ctrl = new AbortController();
    // File uploads are never aborted — a big video takes what it takes.
    // Plain JSON posts keep the timeout so a dead server can't hang a button.
    const timer = bodyBytes > 0 ? null : setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        ...rest,
        signal: ctrl.signal,
        headers: { ...(rest.headers || {}), Authorization: `Bearer ${t}` },
      });
      const ct = res.headers.get('content-type') || '';
      const data = ct.includes('json') ? await res.json().catch(() => ({})) : {};
      if (res.status === 401) {
        const err = new Error(data.error || 'Session expired');
        err.status = 401;
        throw err;
      }
      return { res, data };
    } catch (e) {
      if (e?.status === 401) throw e;
      if (e?.name === 'AbortError') {
        throw new Error(timeoutMs > 60000
          ? 'Upload timed out — the file is too big for this connection. Try a smaller file or faster network.'
          : 'Server is waking up — try again in a few seconds.');
      }
      if (isNetworkFail(e)) throw new Error(DOWN_MSG);
      throw e;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
  try {
    return await doPost(await ensureFresh(token), budget);
  } catch (e) {
    if (e?.status !== 401 || !token) throw e;
    const fresh = await freshToken();
    if (!fresh || fresh === token) throw new Error('Session expired — sign out and sign in again.');
    const out = await doPost(fresh, budget);
    out.refreshedToken = fresh;
    return out;
  }
}
