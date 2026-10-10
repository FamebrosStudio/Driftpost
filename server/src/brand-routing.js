import { getDeepForCompact } from './brand-memory/index.js';
import { loadBrands } from './brand-memory/index.js';

const PLATFORMS = ['youtube', 'instagram', 'facebook', 'x'];
const norm = (value) => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const compact = (value) => norm(value).replace(/\s/g, '');

const BUSINESS_SUFFIXES = new Set([
  'and', 'the', 'by', 'shree', 'sri', 'smt', 'mr', 'mrs', 'dr', 'company', 'co', 'private', 'limited', 'pvt', 'ltd',
  'jeweller', 'jewellers', 'jewelry', 'jewellery', 'salon', 'studio', 'clinic',
  'academy', 'store', 'shop', 'fashion', 'clothing', 'wear', 'resort', 'hotel',
  'restaurant', 'cafe', 'market', 'furniture', 'interiors', 'unisex', 'official',
]);

function editDistance(a, b, limit = 2) {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, current[j]);
    }
    if (rowMin > limit) return limit + 1;
    previous = current;
  }
  return previous[b.length];
}

function profileAliases(brand) {
  const deep = getDeepForCompact(brand) || {};
  const social = deep.social_media || {};
  const names = [brand.name, brand.id?.replace(/_/g, ' '), ...(brand.aliases || []), brand.ig,
    deep.brand_name, deep.public_name, deep.alternate_public_name, deep.alternate_public_identity,
    deep.branch_name ? `${deep.brand_name || brand.name} ${deep.branch_name}` : '',
    deep.branch_name && deep.business?.city ? `${deep.brand_name || brand.name} ${deep.branch_name} ${deep.business.city}` : '',
    social.facebook_name, social.youtube_name, social.x_name,
    social.instagram_handle, social.facebook_handle, social.youtube_handle, social.x_handle,
  ];
  // Keep confirmed account identities, but never treat agency/managing handles
  // as the client's identity just because they appear in its research file.
  const visit = (node, path = []) => {
    if (typeof node === 'string') {
      const key = path.join('_');
      if (!/agency|manager|famebros/i.test(key) && /(handle|username|profile.?name|page.?name|channel.?name|account.?name|url)$/i.test(key)) {
        if (/^https?:\/\//i.test(node)) {
          try { names.push(new URL(node).pathname.split('/').filter(Boolean).at(-1)); } catch {}
        } else names.push(node);
      }
      return;
    }
    if (Array.isArray(node)) { node.forEach((item, index) => visit(item, [...path, String(index)])); return; }
    if (node && typeof node === 'object') Object.entries(node).forEach(([key, value]) => visit(value, [...path, key]));
  };
  visit(social, ['social_media']);

  const result = new Set();
  for (const name of names) {
    const value = String(name || '').trim();
    const normalized = norm(value);
    if (!normalized) continue;
    result.add(normalized);
    const words = normalized.split(' ');
    // Common editor shorthand: omit generic business words. If that shorthand
    // belongs to two branches, the resolver reports the tie instead of guessing.
    const short = words.filter((word) => !BUSINESS_SUFFIXES.has(word));
    if (short.length && short.join(' ').length >= 4) result.add(short.join(' '));
  }
  return [...result];
}

function aliasScore(query, alias) {
  const q = compact(query);
  const a = compact(alias);
  if (!q || !a) return 0;
  if (q === a) return 1000;
  if (q.length >= 5 && (q.includes(a) || a.includes(q))) return 890 + Math.min(q.length, a.length);
  // Allow an occasional typo/omitted character in a distinctive word/handle.
  // Short names are deliberately excluded because one typo can change the brand.
  if (Math.min(q.length, a.length) >= 6) {
    const distance = editDistance(q, a, Math.min(2, Math.floor(Math.min(q.length, a.length) / 5)));
    if (distance === 1) return 880 + Math.min(q.length, a.length);
    if (distance === 2 && Math.min(q.length, a.length) >= 10) return 860 + Math.min(q.length, a.length);
  }
  return 0;
}

// Local-only alias resolver for Drive filenames. It uses saved brand names,
// explicit aliases, public names and confirmed social identities; no model/API
// call or new guessed alias is needed, so routing stays fast and reproducible.
export function resolveDriveBrand(query) {
  const raw = String(query || '').replace(/\.(mp4|mov|m4v|mkv|webm|avi)$/i, '').trim();
  if (!raw) return { brand: null, candidates: [] };
  const normalizedQuery = norm(raw.replace(/@/g, ' '));
  const ranked = loadBrands().map((brand) => {
    const aliases = profileAliases(brand);
    const score = Math.max(0, ...aliases.map((alias) => aliasScore(normalizedQuery, alias)));
    return { brand, score };
  }).filter((item) => item.score >= 860).sort((a, b) => b.score - a.score);
  if (!ranked.length) return { brand: null, candidates: [] };
  const bestScore = ranked[0].score;
  const best = ranked.filter((item) => item.score === bestScore);
  if (best.length !== 1) return { brand: null, candidates: best.map((item) => item.brand.name), ambiguous: true };
  return { brand: best[0].brand, score: bestScore, candidates: [best[0].brand.name] };
}

// Fallback for an explicitly named connected account that has no saved brand
// profile (for example an agency-owned page). Exact names/handles may route;
// a shortened prefix that could mean several pages is held for review.
export function matchDriveAccounts(query, connections = []) {
  const input = norm(String(query || '').replace(/@/g, ' '));
  if (!input) return { destinations: [], ambiguous: false };
  const ranked = connections.map((connection) => {
    const score = Math.max(nameScore(input, connection.account_name), nameScore(input, connection.platform_account_id));
    return { connection, score };
  }).filter(({ score }) => score >= 850);
  if (!ranked.length) return { destinations: [], ambiguous: false };
  const strongest = Math.max(...ranked.map(({ score }) => score));
  const best = ranked.filter(({ score }) => score === strongest);
  const exact = strongest === 1000;
  const distinctNames = new Set(best.map(({ connection }) => norm(connection.account_name)));
  if (!exact && (best.length > 1 || distinctNames.size > 1)) return { destinations: [], ambiguous: true };
  return { destinations: best.map(({ connection }) => connection), ambiguous: false };
}

function nameScore(left, right) {
  const a = compact(left);
  const b = compact(right);
  if (!a || !b) return 0;
  if (a === b) return 1000;
  if (Math.min(a.length, b.length) >= 6 && (a.includes(b) || b.includes(a))) return 900;
  if (Math.min(a.length, b.length) >= 6) {
    const distance = editDistance(a, b, Math.min(2, Math.floor(Math.min(a.length, b.length) / 5)));
    if (distance === 1) return 880 + Math.min(a.length, b.length);
    if (distance === 2 && Math.min(a.length, b.length) >= 10) return 860 + Math.min(a.length, b.length);
  }
  const leftTokens = norm(left).split(' ').filter((word) => word.length >= 3);
  const rightTokens = norm(right).split(' ').filter((word) => word.length >= 3);
  if (leftTokens.length < 2 || rightTokens.length < 2) return 0;
  const allMatch = leftTokens.every((word) => rightTokens.some((candidate) => (
    candidate === word
      || (Math.min(word.length, candidate.length) >= 5 && (word.startsWith(candidate) || candidate.startsWith(word)))
  )));
  return allMatch ? 850 : 0;
}

function socialIdentities(brand, deep, platform) {
  const social = deep?.social_media || {};
  const platformPattern = platform === 'x' ? /(^|_)(x|twitter)(_|$)/i : new RegExp(platform, 'i');
  const blocked = /agency|manager|famebros/i;
  const values = [];
  const visit = (node, path = []) => {
    if (typeof node === 'string') {
      const key = path.join('_');
      if (platformPattern.test(key) && !blocked.test(key) && /(handle|username|profile.?name|page.?name|channel.?name|account.?name|url)$/i.test(key)) {
        const value = node.trim();
        if (value && !/^https?:\/\//i.test(value)) values.push(value);
        else if (/^https?:\/\//i.test(value)) {
          try { values.push(new URL(value).pathname.split('/').filter(Boolean).at(-1) || ''); } catch {}
        }
      }
      return;
    }
    if (Array.isArray(node)) { node.forEach((child, index) => visit(child, [...path, String(index)])); return; }
    if (node && typeof node === 'object') Object.entries(node).forEach(([childKey, child]) => visit(child, [...path, childKey]));
  };
  visit(social, ['social_media']);
  const general = [brand?.name, String(brand?.id || '').replace(/_/g, ' '), ...(brand?.aliases || [])];
  if (platform === 'instagram') general.push(brand?.ig);
  return [...new Set([...values, ...general].map((value) => String(value || '').trim()).filter(Boolean))];
}

// Resolve only strong brand/account associations. Weak or tied matches are
// reported so the intake never silently publishes one client's video to
// another client's channel.
export function mapBrandDestinations(brand, connections, selectedPlatforms = []) {
  const deep = getDeepForCompact(brand);
  const requested = selectedPlatforms.length ? selectedPlatforms : PLATFORMS;
  const destinations = [];
  const unresolved = [];
  for (const platform of requested) {
    const accounts = (connections || []).filter((connection) => connection.platform === platform);
    const identities = socialIdentities(brand, deep, platform);
    const scored = accounts.map((connection) => ({
      connection,
      score: Math.max(0, ...identities.map((identity) => Math.max(
        nameScore(identity, connection.account_name),
        nameScore(identity, connection.platform_account_id),
      ))),
    })).filter((entry) => entry.score >= 850);
    if (!scored.length) continue;
    const strongest = Math.max(...scored.map((entry) => entry.score));
    const best = scored.filter((entry) => entry.score === strongest);
    // Identical exact names can legitimately represent multiple channels;
    // equally strong fuzzy matches are ambiguous and must be fixed manually.
    if (strongest < 1000 && best.length > 1) {
      unresolved.push(`${platform}: multiple connected accounts match ${brand.name}`);
      continue;
    }
    destinations.push(...best.map((entry) => entry.connection));
  }
  return { destinations: [...new Map(destinations.map((entry) => [entry.id, entry])).values()], unresolved };
}
