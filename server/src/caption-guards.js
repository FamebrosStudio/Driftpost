const compact = (value) => String(value || '').toLowerCase().normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

const words = (value) => compact(value).split(/\s+/).filter((word) => word.length >= 4);

function matchesTopic(candidate, brief) {
  const tag = compact(candidate).replace(/\s+/g, '');
  if (!tag) return false;
  return words(brief).some((word) => tag.includes(word));
}

const TOPIC_CONCEPTS = [
  ['footwear', 'shoe', 'shoes', 'sneaker', 'sneakers', 'trainer', 'trainers', 'boot', 'boots', 'sandal', 'sandals', 'heel', 'heels', 'loafer', 'loafers', 'slipper', 'slippers'],
  ['jewelry', 'jewellery', 'jewel', 'jewels', 'jeweler', 'jeweller', 'gold', 'silver', 'ring', 'rings', 'necklace', 'necklaces', 'earring', 'earrings', 'bracelet', 'bracelets'],
  ['salon', 'hair', 'haircut', 'haircuts', 'hairstyle', 'hairstyles', 'hairstyling', 'color', 'colour', 'balayage', 'keratin', 'beauty', 'makeup'],
  ['furniture', 'sofa', 'sofas', 'couch', 'couches', 'chair', 'chairs', 'table', 'tables', 'wardrobe', 'bed', 'beds', 'interior'],
  ['restaurant', 'food', 'dish', 'dishes', 'meal', 'meals', 'menu', 'cafe', 'café', 'bakery', 'cake', 'cakes', 'dessert', 'desserts', 'recipe', 'recipes'],
  ['astronomy', 'space', 'cosmos', 'universe', 'planet', 'planets', 'star', 'stars', 'galaxy', 'galaxies', 'blackhole', 'astrophysics', 'orbit', 'orbits'],
  ['school', 'education', 'student', 'students', 'classroom', 'teacher', 'teachers', 'learning', 'lesson', 'lessons', 'curriculum'],
  ['clinic', 'medical', 'health', 'healthcare', 'doctor', 'doctors', 'patient', 'patients', 'treatment', 'therapy', 'wellness'],
  ['car', 'cars', 'automotive', 'vehicle', 'vehicles', 'motorcycle', 'motorcycles', 'bike', 'bikes', 'garage', 'dealer', 'dealership'],
  ['travel', 'tourism', 'hotel', 'resort', 'beach', 'holiday', 'vacation', 'tour', 'tours', 'destination', 'destinations'],
];
const TOPIC_CONCEPT_BY_WORD = new Map(TOPIC_CONCEPTS.flatMap((group) => group.map((word) => [word, group[0]])));
const GENERIC_BRAND_TERMS = new Set(['brand', 'business', 'collection', 'design', 'local', 'new', 'official', 'shop', 'store', 'style', 'styling', 'today']);

function topicConcepts(value) {
  return words(value).map((word) => TOPIC_CONCEPT_BY_WORD.get(word) || word)
    .filter((word) => !GENERIC_BRAND_TERMS.has(word));
}

// A selected profile may contribute its voice, CTA, footer and brand tag only
// when the brief is actually about its identity/category/products. This keeps
// an unrelated prompt (for example, black holes for a footwear account) from
// inheriting that account's marketing copy.
export function brandTopicRelevant({ brand, brief, extraTerms = [] }) {
  if (!brand) return false;
  const topic = new Set(topicConcepts(brief));
  if (!topic.size) return false;
  const profile = topicConcepts([
    brand.name, brand.cat, ...(brand.aliases || []), ...(brand.kw || []), ...extraTerms,
  ].join(' '));
  return profile.some((concept) => topic.has(concept));
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

// Add the selected brand tag only when the current topic fits that brand.
// Every other hashtag must be supported by the brief; broad historical
// keyword banks never pad an unrelated post.
export function safeBrandHashtags({ candidates = [], brand, brief, otherBrands = [], max = 3 }) {
  const ownTag = brandTopicRelevant({ brand, brief })
    ? String(brand?.name || '').replace(/[^A-Za-z0-9]/g, '')
    : '';
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

const GENERIC_TAG_STOP_WORDS = new Set([
  'about', 'after', 'again', 'also', 'because', 'before', 'caption', 'content',
  'create', 'facebook', 'from', 'give', 'ideas', 'instagram', 'make', 'more',
  'need', 'only', 'please', 'post', 'reel', 'share', 'short', 'should', 'some',
  'something', 'that', 'this', 'through', 'today', 'using', 'video', 'want',
  'what', 'with', 'write', 'youtube', 'your', 'for', 'the', 'and', 'but', 'one',
]);

// For people who are not using a saved brand profile, retain only model tags
// that can be traced to a meaningful word in their actual brief. If nothing
// fits, return fewer tags instead of decorating the post with unrelated ones.
export function safeTopicHashtags({ candidates = [], brief = '', max = 3 }) {
  const topicWords = new Set(words(brief)
    .filter((word) => !GENERIC_TAG_STOP_WORDS.has(word) && !/^\d+$/.test(word)));
  if (!topicWords.size) return [];
  const clean = (value) => String(value || '').replace(/^#+/, '').replace(/[^A-Za-z0-9_]/g, '').slice(0, 40);
  const result = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const tag = clean(candidate);
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    const compactTag = compact(tag).replace(/\s+/g, '');
    if (![...topicWords].some((word) => compactTag.includes(word))) continue;
    seen.add(key);
    result.push(tag);
    if (result.length >= max) break;
  }
  return result;
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

// --- Deterministic caption quality gates -------------------------------------
// The prompt already asks for human, distinct, non-filler copy, but a request
// is not a guarantee. These gates are the server-side guarantee: deterministic,
// offline, no model call, no network, no new dependency.
//
// ONE list of banned phrases, ONE place to tune. The YouTube fallback below
// reuses the same list, so a server-written description can never reintroduce
// a phrase the gate rejects.
export const CAPTION_FILLER_PHRASES = [
  // "unlock" only reads as slop when it sells a benefit ("unlock your X").
  { label: 'unlock your', re: /\bunlock(?:s|ed|ing)?\s+your\b/i },
  { label: 'elevate', re: /\belevat(?:e|es|ing)\b/i },
  { label: 'unleash', re: /\bunleash(?:es|ing)?\b/i },
  { label: 'game-changer', re: /\bgame[\s-]?changer\b/i },
  { label: 'game-changing', re: /\bgame[\s-]?changing\b/i },
  { label: 'moreover', re: /\bmoreover\b/i },
  { label: 'delve', re: /\bdelve(?:s|d|ing)?\b/i },
  { label: 'tapestry', re: /\btapestr(?:y|ies)\b/i },
  { label: "in today's digital age", re: /\bin today'?s digital age\b/i },
  { label: 'look no further', re: /\blook no further\b/i },
  { label: 'dive into', re: /\b(?:dive|dives|dived|diving)\s+into\b/i },
  { label: "let's dive", re: /\blet'?s\s+dive\b/i },
  { label: 'take it to the next level', re: /\btake it to the next level\b/i },
  { label: 'next level', re: /\bnext[\s-]?level\b/i },
  { label: 'cutting-edge', re: /\bcutting[\s-]?edge\b/i },
  { label: 'state-of-the-art', re: /\bstate[\s-]of[\s-]the[\s-]art\b/i },
  { label: 'must-visit', re: /\bmust[\s-]?visit\b/i },
  { label: 'hidden gem', re: /\bhidden\s+gem\b/i },
  { label: 'are you ready', re: /\bare you ready\b/i },
  { label: 'wonders await', re: /\bwonders await\b/i },
  { label: 'the world of', re: /\bthe world of\b/i },
  { label: 'nestled in', re: /\bnestled in\b/i },
  { label: 'sanctuary', re: /\bsanctuar(?:y|ies)\b/i },
  { label: 'oasis', re: /\boasis\b/i },
  { label: 'curated journey', re: /\bcurated\s+journey\b/i },
  { label: 'indulge', re: /\bindulge(?:s|d|ing)?\b/i },
  { label: 'treat yourself', re: /\btreat yourself\b/i },
  { label: 'swipe up', re: /\bswipe up\b/i },
  { label: 'double tap', re: /\bdouble tap\b/i },
  { label: 'comment below', re: /\bcomment below\b/i },
  { label: 'tag a friend', re: /\btag[\s-]a[\s-]friend\b/i },
  { label: 'link in bio', re: /\blink in bio\b/i },
];

// Three or more of the same noise punctuation ("!!!", "???", "!?!").
const PUNCTUATION_NOISE_RE = /[!?]{3,}/g;

// Filler gate. Returns one issue string per banned phrase found in a RAW
// model body (before the footer/hashtag assembly). `platform` only shapes
// the message so the repair feedback can name the card to rewrite.
export function captionFillerIssues(text, { platform = '' } = {}) {
  const body = String(text || '');
  if (!body.trim()) return [];
  const prefix = platform ? `${platform} caption ` : 'caption ';
  const issues = [];
  const seen = new Set();
  const add = (label) => {
    if (seen.has(label)) return;
    seen.add(label);
    issues.push(`${prefix}uses filler phrase "${label}"`);
  };
  for (const entry of CAPTION_FILLER_PHRASES) {
    if (entry.re.test(body)) add(entry.label);
  }
  for (const run of body.match(PUNCTUATION_NOISE_RE) || []) add(run);
  return issues;
}

const normalizedBody = (value) => String(value || '').toLowerCase()
  .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();

// Distinctness gate: two platform bodies that are the same copy wearing two
// platform names. Token-set Jaccard >= threshold, or one body is a prefix of
// the other. Pure, offline, no model call.
export function captionBodiesNearlyIdentical(a, b, { threshold = 0.85, minPrefixLength = 12 } = {}) {
  const na = normalizedBody(a);
  const nb = normalizedBody(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  if (shorter.length >= minPrefixLength && longer.startsWith(shorter)) return true;
  const ta = new Set(na.split(' ').filter(Boolean));
  const tb = new Set(nb.split(' ').filter(Boolean));
  if (!ta.size || !tb.size) return false;
  let shared = 0;
  for (const token of ta) if (tb.has(token)) shared += 1;
  const union = ta.size + tb.size - shared;
  return union > 0 && shared / union >= threshold;
}

// A caption body may never carry a phone-like number: the footer owns the
// contact line. Used by the YouTube fallback so it can never publish one.
const PHONE_LIKE_RE = /(?:\+?91[\s-]?)?[6-9]\d{4}[\s-]?\d{5}\b/g;
const LONG_DIGIT_RUN_RE = /\b\d{7,}\b/g;

export function stripPhoneLikeNumbers(text) {
  return String(text || '')
    .replace(PHONE_LIKE_RE, ' ')
    .replace(LONG_DIGIT_RUN_RE, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const flatText = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const uniqueList = (values, max, limit = 140) => [...new Set(
  [].concat(values || []).map(flatText).filter((value) => value && value.length <= limit),
)].slice(0, max);

const lowerFirst = (value) => {
  const text = flatText(value);
  if (!text) return '';
  const [first, ...rest] = text.split(' ');
  // Keep acronyms (SAR Institute) as written; only a normal word is lowered.
  const head = /^[A-Z0-9]{2,}$/.test(first) ? first : first.charAt(0).toLowerCase() + first.slice(1);
  return [head, ...rest].join(' ');
};

const articleFor = (word) => (/^[aeiou]/i.test(word) ? 'an' : 'a');

const listPhrase = (items) => {
  const list = items.filter(Boolean);
  if (!list.length) return '';
  if (list.length === 1) return list[0];
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
};

const countSentences = (text) => (String(text || '').match(/[.!?]+(?=\s|$)/g) || []).length;

// Factual YouTube description for the case where the model returns a title
// but no description. Assembled only from the generated title, the post brief
// and the selected brand's verified record. It never invents prices, phone
// numbers, addresses, offers, stock, results or credentials, and it never
// contains a banned filler phrase: the fallback has to pass its own gate.
export function youtubeFallbackDescription({
  title = '', brandName = '', category = '', city = '',
  products = [], facts = [], brief = '', goal = '',
} = {}) {
  const safeTitle = flatText(stripPhoneLikeNumbers(title)).replace(/[.!?]+$/, '').trim();
  const safeBrief = flatText(stripPhoneLikeNumbers(brief)).replace(/[.!?]+$/, '').trim();
  const brand = flatText(brandName);
  const cat = lowerFirst(category);
  const place = flatText(city);
  const productList = uniqueList(products, 3);
  const factList = uniqueList(facts, 3, 160);
  const goalWords = flatText(goal).toLowerCase().split(' ').filter(Boolean).slice(0, 3).join(' ');

  const titleLine = safeTitle ? `This video covers: ${safeTitle}.` : '';
  let identityLine = '';
  if (brand) {
    const what = productList.length ? `, working with ${listPhrase(productList)}` : '';
    if (cat && place) identityLine = `${brand} is ${articleFor(cat)} ${cat} in ${place}${what}.`;
    else if (cat) identityLine = `${brand} is ${articleFor(cat)} ${cat}${what}.`;
    else if (place) identityLine = `${brand} is located in ${place}${what}.`;
    else identityLine = `${brand} is the business behind this post${what}.`;
  }
  const detailLine = safeBrief
    ? `About this post: ${safeBrief}.`
    : (factList.length ? `Key details: ${listPhrase(factList)}.` : '');
  const keywordTerms = [safeTitle, cat, place, goalWords].filter(Boolean);
  const keywordLine = keywordTerms.length ? `Keywords: ${listPhrase(keywordTerms)}.` : '';

  const lines = [titleLine, identityLine, detailLine].filter(Boolean);
  const candidates = [
    lines,
    lines.filter((line) => line !== titleLine),
    lines.filter((line) => line !== detailLine),
    lines.filter((line) => line !== identityLine),
    [identityLine, detailLine].filter(Boolean),
    [detailLine, identityLine].filter(Boolean),
    [identityLine].filter(Boolean),
    [detailLine].filter(Boolean),
  ];
  let picked = '';
  for (const candidate of candidates) {
    const text = candidate.join(' ').trim();
    if (!text) continue;
    if (captionFillerIssues(text).length) continue;
    picked = text;
    break;
  }
  if (!picked) {
    // Every available source is dirty: publish the least-wrong honest line.
    picked = brand ? `${brand} is the business behind this post.` : 'This video is published for this post.';
  }
  if (countSentences(picked) < 2 && keywordLine && !captionFillerIssues(keywordLine).length) {
    picked = `${picked} ${keywordLine}`;
  }
  return stripPhoneLikeNumbers(picked);
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
