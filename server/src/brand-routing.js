import { getDeepForCompact } from './brand-memory/index.js';

const PLATFORMS = ['youtube', 'instagram', 'facebook', 'x'];
const norm = (value) => String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const compact = (value) => norm(value).replace(/\s/g, '');

function nameScore(left, right) {
  const a = compact(left);
  const b = compact(right);
  if (!a || !b) return 0;
  if (a === b) return 1000;
  if (Math.min(a.length, b.length) >= 6 && (a.includes(b) || b.includes(a))) return 900;
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
    if (strongest < 900 && best.length > 1) {
      unresolved.push(`${platform}: multiple connected accounts match ${brand.name}`);
      continue;
    }
    destinations.push(...best.map((entry) => entry.connection));
  }
  return { destinations: [...new Map(destinations.map((entry) => [entry.id, entry])).values()], unresolved };
}
