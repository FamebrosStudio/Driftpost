const compact = (value) => String(value || '').toLowerCase().normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

const words = (value) => compact(value).split(/\s+/).filter((word) => word.length >= 4);

function matchesTopic(candidate, brief) {
  const tag = compact(candidate).replace(/\s+/g, '');
  if (!tag) return false;
  return words(brief).some((word) => tag.includes(word));
}

function isAnotherBrand(candidate, brand, otherBrands = []) {
  const tag = compact(candidate).replace(/\s+/g, '');
  const own = new Set([brand?.name, ...(brand?.aliases || []), brand?.ig]
    .map((value) => compact(value).replace(/\s+/g, '')).filter(Boolean));
  return otherBrands.some((other) => {
    if (!other || other.id === brand?.id) return false;
    return [other.name, ...(other.aliases || []), other.ig]
      .map((value) => compact(value).replace(/\s+/g, ''))
      .some((name) => name.length >= 5 && tag.includes(name) && !own.has(name));
  });
}

// The selected brand tag is safe by identity. Every other hashtag must be
// supported by the current brief; broad historical keyword banks never pad
// an unrelated post. Return up to three rather than inventing filler tags.
export function safeBrandHashtags({ candidates = [], brand, brief, otherBrands = [], max = 3 }) {
  const ownTag = String(brand?.name || '').replace(/[^A-Za-z0-9]/g, '');
  const clean = (value) => String(value || '').replace(/^#+/, '').replace(/[^A-Za-z0-9_]/g, '');
  const result = ownTag ? [ownTag] : [];
  const seen = new Set(result.map((tag) => tag.toLowerCase()));
  for (const candidate of candidates) {
    const tag = clean(candidate);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key) || isAnotherBrand(tag, brand, otherBrands)) continue;
    if (!matchesTopic(tag, brief)) continue;
    seen.add(key);
    result.push(tag);
    if (result.length >= max) break;
  }
  return result.slice(0, max);
}

export function topicRelevantPhrases(candidates = [], brief, max = 8) {
  const seen = new Set();
  return candidates.map((value) => String(value || '').trim())
    .filter((value) => {
      const key = compact(value);
      if (!key || seen.has(key) || !matchesTopic(value, brief)) return false;
      seen.add(key);
      return true;
    }).slice(0, max);
}

// Empty form fields must not mask the validated brief fallback. This is
// shared by caption assembly at the API boundary to protect manual/scheduled
// posts from blank strings and whitespace-only values.
export function nonEmptyCaption(value, fallback = '') {
  const text = String(value ?? '').trim();
  return text || String(fallback ?? '').trim();
}

export function enabledInstagramCollaborators(body = {}, parse = (raw) => ({ usernames: String(raw || '').split(',').filter(Boolean), error: '' })) {
  if (String(body.ig_collabs_enabled || '') !== '1') return { usernames: [], error: '' };
  return parse(body.ig_collabs);
}

export function instagramCaptionRequiredError(platform, body = {}) {
  const targetsInstagram = platform === 'instagram'
    || (platform === 'facebook' && String(body.fb_synd_ig || '') === '1');
  if (!targetsInstagram) return '';
  const caption = platform === 'instagram' ? body.ig_caption : body.fb_message;
  return nonEmptyCaption(caption, body.text)
    ? ''
    : 'Add a caption before publishing this Instagram post or cross-post.';
}
