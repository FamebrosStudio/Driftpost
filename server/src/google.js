const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export function youtubeAuthorizationUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    scope: [
      'https://www.googleapis.com/auth/youtube.upload',
      'https://www.googleapis.com/auth/youtube.readonly',
      'https://www.googleapis.com/auth/youtube.force-ssl',
    ].join(' '),
    state,
  });
  return `${AUTH_URL}?${params}`;
}

export function businessProfileAuthorizationUrl(state) {
  const redirectUri = process.env.GOOGLE_BUSINESS_REDIRECT_URI || process.env.GOOGLE_REDIRECT_URI;
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri,
    response_type: 'code', access_type: 'offline', prompt: 'consent',
    include_granted_scopes: 'true',
    scope: 'openid email https://www.googleapis.com/auth/business.manage', state,
  });
  return `${AUTH_URL}?${params}`;
}

export async function exchangeBusinessProfileCode(code) {
  const redirectUri = process.env.GOOGLE_BUSINESS_REDIRECT_URI || process.env.GOOGLE_REDIRECT_URI;
  const res = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: redirectUri, grant_type: 'authorization_code' }), signal: AbortSignal.timeout(30000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.error || 'Google token exchange failed');
  return data;
}

async function businessRequest(url, accessToken, init = {}) {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${accessToken}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers }, signal: AbortSignal.timeout(20000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error?.message || `Google Business Profile API returned ${res.status}`);
    error.status = res.status;
    error.details = data.error;
    throw error;
  }
  return data;
}

export function businessProfileErrorMessage(error, context = 'locations') {
  const message = String(error?.message || error || 'Unknown Google Business Profile error').slice(0, 1200);
  const actionLabel = context === 'reviews' ? 'review replies' : 'location discovery';
  if (/quota exceeded|rate limit|requests per minute/i.test(message)) {
    return `Google temporarily rate-limited ${actionLabel}. Wait a few minutes and retry. Google says: ${message}`;
  }
  if (/has not been used in project|api .*disabled|accessNotConfigured|service_disabled/i.test(message)) {
    return `A required Google Business Profile API is disabled for the OAuth project. Enable the API named in Google's message, wait for it to propagate, then retry. Google says: ${message}`;
  }
  if (/permission denied|insufficient authentication scopes|not authorized/i.test(message)) {
    return `This Google account does not have sufficient Business Profile access for ${actionLabel}. Check its manager/owner access and Google API approval. Google says: ${message}`;
  }
  if (context === 'reviews') {
    return `Could not load or reply to Google reviews. Check Business Profile API approval and enabled APIs (including Google My Business API), then retry. Google says: ${message}`;
  }
  return `Google account connected, but locations could not be loaded. Check Business Profile API approval and enabled APIs, then retry. Google says: ${message}`;
}

export async function listBusinessProfileLocations(accessToken) {
  const result = [];
  let accountsPageToken = '';
  let accountCount = 0;
  do {
    const accountParams = new URLSearchParams({ pageSize: '20' });
    if (accountsPageToken) accountParams.set('pageToken', accountsPageToken);
    const accountsData = await businessRequest(`https://mybusinessaccountmanagement.googleapis.com/v1/accounts?${accountParams}`, accessToken);
    for (const account of accountsData.accounts || []) {
      if (!account.name || result.length >= 500) continue;
      accountCount++;
      let pageToken = '';
      do {
        const params = new URLSearchParams({ readMask: 'name,title,storefrontAddress', pageSize: '100' });
        if (pageToken) params.set('pageToken', pageToken);
        const data = await businessRequest(`https://mybusinessbusinessinformation.googleapis.com/v1/${account.name}/locations?${params}`, accessToken);
        for (const location of data.locations || []) {
          if (!location.name || result.length >= 500) continue;
          result.push({ account_id: account.name.split('/').pop(), location_id: location.name.split('/').pop(), resource_name: location.name, title: location.title || 'Business location', address: location.storefrontAddress?.addressLines?.join(', ') || '' });
        }
        pageToken = result.length < 500 ? (data.nextPageToken || '') : '';
      } while (pageToken);
      if (result.length >= 500) break;
    }
    accountsPageToken = result.length < 500 ? (accountsData.nextPageToken || '') : '';
  } while (accountsPageToken && accountCount < 500);
  return result;
}

export async function listBusinessReviews(accessToken, accountId, locationId) {
  const reviews = [];
  let pageToken = '';
  for (let page = 0; page < 5; page++) {
    const params = new URLSearchParams({ pageSize: '50', orderBy: 'updateTime desc' });
    if (pageToken) params.set('pageToken', pageToken);
    const data = await businessRequest(`https://mybusiness.googleapis.com/v4/accounts/${encodeURIComponent(accountId)}/locations/${encodeURIComponent(locationId)}/reviews?${params}`, accessToken);
    if (Array.isArray(data.reviews)) reviews.push(...data.reviews);
    pageToken = data.nextPageToken || '';
    if (!pageToken) break;
  }
  return reviews;
}

export async function replyBusinessReview(accessToken, accountId, locationId, reviewId, comment) {
  return businessRequest(`https://mybusiness.googleapis.com/v4/accounts/${encodeURIComponent(accountId)}/locations/${encodeURIComponent(locationId)}/reviews/${encodeURIComponent(reviewId)}/reply`, accessToken, { method: 'PUT', body: JSON.stringify({ comment }) });
}

export function businessReviewRating(value) {
  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 5) return numeric;
  return ({ ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 })[String(value || '').toUpperCase()] || 0;
}

export const DEFAULT_REVIEW_REPLIES = Object.freeze({
  1: Object.freeze([
    'We are sorry you had a bad experience. We will try to do better.',
    'Sorry to hear this. Your feedback is important to us.',
    'We are sorry we could not make you happy. We hope to do better next time.',
    'Thank you for telling us. We will work on making things better.',
    'We are sorry you feel this way. We would like to know what went wrong.',
    'Sorry for the trouble. We hope you give us another chance.',
    'We feel bad that you did not have a good experience. We will try our best to improve.',
    'We are sorry to hear this. Please contact us so we can understand the problem.',
  ]),
  2: Object.freeze([
    'Thank you for your review. We will try to make your next visit better.',
    'Sorry we could not meet your hopes. We will work on improving.',
    'Thank you for sharing your thoughts. We will try to do better.',
    'We are sorry you were not fully happy. Your feedback helps us improve.',
    'Thank you for being honest. We hope to give you a better experience next time.',
    'We are sorry things did not go well. We will keep working to improve.',
    'Thank you for your feedback. We hope to make you happier next time.',
    'We are sorry for any trouble. Thank you for helping us get better.',
  ]),
  3: Object.freeze([
    'Thank you for your review! We hope to make your next visit even better.',
    'Thanks for your feedback. We are always trying to improve.',
    'Thank you for visiting us! We hope to see you again soon.',
    'We are happy you shared your thoughts. We will keep working to do better.',
    'Thanks for your rating! We hope to earn five stars next time.',
    'Thank you for choosing us. We hope your next experience is even better.',
    'Your review means a lot to us. Thank you for helping us improve.',
    'Thanks for sharing your experience! We hope to see you again.',
  ]),
  4: Object.freeze([
    'Thank you so much! We are happy you liked our service.',
    'Thanks for your lovely review! Hope to see you again soon.',
    'We are happy you had a good experience. Thank you!',
    'Thank you for your support! It means a lot to us.',
    'So happy to see your rating! Thanks for choosing us.',
    'Thank you! We are glad you enjoyed your visit.',
    'Your kind review made us smile! Hope to see you again.',
    'Thanks for the four stars! We hope to make your next visit even better.',
  ]),
  5: Object.freeze([
    'Thank you so much for the five stars! We are so happy!',
    'Wow! Thank you for your lovely review. Hope to see you again!',
    'Your five stars made our day! Thank you for your love and support.',
    'Thank you! We are so glad you had a great time with us.',
    'We love happy customers! Thanks for your amazing review.',
    'Big thanks for the five stars! We hope to see you again soon.',
    'Thank you for choosing us! Your support means a lot.',
    'We are so happy you liked us! Thank you for your five-star rating.',
  ]),
});

export const HAIR_MATCH_SALON_REPLY = 'We\u2019re sorry our service didn\u2019t meet your expectations. We\u2019ll review your concerns with our team and work towards providing you with a better experience at Hair Match Salon.';

export function sanitizeStarReplies(starReplies) {
  if (!starReplies || typeof starReplies !== 'object') return null;
  const out = {};
  let hasAny = false;
  for (const star of [1, 2, 3, 4, 5]) {
    const raw = starReplies[star] ?? starReplies[String(star)];
    const lines = Array.isArray(raw)
      ? raw.map((s) => String(s || '').trim().slice(0, 1000)).filter(Boolean).slice(0, 20)
      : typeof raw === 'string'
        ? raw.split(/\r?\n/).map((s) => s.trim().slice(0, 1000)).filter(Boolean).slice(0, 20)
        : [];
    if (lines.length) {
      out[star] = lines;
      hasAny = true;
    }
  }
  return hasAny ? out : null;
}

export function pickBusinessReviewReply(review, rules = {}, locationName = '') {
  if (!review?.name || review.reviewReply?.comment || review.reviewReply?.updateTime) return '';
  const rating = businessReviewRating(review.starRating);
  const minimum = Math.max(1, Math.min(5, Number(rules.minimum_rating) || 1));
  if (rating < minimum || rating < 1 || rating > 5) return '';

  const useDefaults = rules.mode === 'default'
    || rules.use_default_replies === true
    || (rules.reply_text === undefined && rules.mode !== 'template');
  if (!useDefaults) {
    return String(rules.reply_text || '').trim();
  }

  const customStarPool = sanitizeStarReplies(rules.star_replies)?.[rating];
  if (customStarPool?.length) {
    let hash = 0;
    for (const ch of String(review.name)) {
      hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    }
    return customStarPool[hash % customStarPool.length];
  }

  if (/hair\s*match/i.test(String(locationName || '')) && rating <= 2) {
    return HAIR_MATCH_SALON_REPLY;
  }

  const pool = DEFAULT_REVIEW_REPLIES[rating];
  if (!pool?.length) return '';
  let hash = 0;
  for (const ch of String(review.name)) {
    hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  }
  return pool[hash % pool.length];
}

export function shouldAutoReplyToBusinessReview(review, rules = {}, locationName = '') {
  return !!pickBusinessReviewReply(review, rules, locationName);
}

export async function refreshBusinessProfileToken(refreshToken) {
  const res = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, refresh_token: refreshToken, grant_type: 'refresh_token' }), signal: AbortSignal.timeout(20000) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) throw new Error(data.error_description || data.error || 'Could not refresh Google Business Profile access');
  return data;
}

export function driveIntakeAuthorizationUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID,
    redirect_uri: process.env.GOOGLE_REDIRECT_URI,
    response_type: 'code',
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    scope: [
      'openid',
      'email',
      'https://www.googleapis.com/auth/drive.readonly',
    ].join(' '),
    state,
  });
  return `${AUTH_URL}?${params}`;
}

export async function getGoogleIdentity(accessToken) {
  const res = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.email) throw new Error(data.error?.message || 'Could not verify the Google account.');
  return { email: String(data.email).trim().toLowerCase(), verified: data.verified_email === true };
}

export async function exchangeGoogleCode(code) {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      redirect_uri: process.env.GOOGLE_REDIRECT_URI,
      grant_type: 'authorization_code',
    }),
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error_description || data.error || 'Google token exchange failed');
  return data;
}

export async function getYouTubeChannel(accessToken) {
  const res = await fetch('https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true', {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message || 'Unable to read YouTube channel');
  const ch = data.items?.[0];
  if (!ch) throw new Error('No YouTube channel found for this Google account');
  return { id: ch.id, name: ch.snippet?.title || 'YouTube channel', avatar_url: ch.snippet?.thumbnails?.default?.url || null };
}
