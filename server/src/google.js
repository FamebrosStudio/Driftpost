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
  if (!res.ok) throw new Error(data.error?.message || `Google Business Profile API returned ${res.status}`);
  return data;
}

export async function listBusinessProfileLocations(accessToken) {
  const accountsData = await businessRequest('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', accessToken);
  const result = [];
  for (const account of (accountsData.accounts || []).slice(0, 100)) {
    let pageToken = '';
    do {
      const params = new URLSearchParams({ readMask: 'name,title,storefrontAddress', pageSize: '100' });
      if (pageToken) params.set('pageToken', pageToken);
      const data = await businessRequest(`https://mybusinessbusinessinformation.googleapis.com/v1/${account.name}/locations?${params}`, accessToken);
      for (const location of data.locations || []) result.push({ account_id: account.name.split('/').pop(), location_id: location.name?.split('/').pop(), resource_name: location.name, title: location.title || 'Business location', address: location.storefrontAddress?.addressLines?.join(', ') || '' });
      pageToken = data.nextPageToken || '';
    } while (pageToken && result.length < 500);
  }
  return result;
}

export async function listBusinessReviews(accessToken, accountId, locationId) {
  const params = new URLSearchParams({ pageSize: '50', orderBy: 'updateTime desc' });
  const data = await businessRequest(`https://mybusiness.googleapis.com/v4/accounts/${encodeURIComponent(accountId)}/locations/${encodeURIComponent(locationId)}/reviews?${params}`, accessToken);
  return data.reviews || [];
}

export async function replyBusinessReview(accessToken, accountId, locationId, reviewId, comment) {
  return businessRequest(`https://mybusiness.googleapis.com/v4/accounts/${encodeURIComponent(accountId)}/locations/${encodeURIComponent(locationId)}/reviews/${encodeURIComponent(reviewId)}/reply`, accessToken, { method: 'PUT', body: JSON.stringify({ comment }) });
}

export function businessReviewRating(value) {
  const numeric = Number(value);
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 5) return numeric;
  return ({ ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 })[String(value || '').toUpperCase()] || 0;
}

export function shouldAutoReplyToBusinessReview(review, rules = {}) {
  if (!review?.name || review.reviewReply?.comment || review.reviewReply?.updateTime) return false;
  const rating = businessReviewRating(review.starRating);
  const minimum = Math.max(1, Math.min(5, Number(rules.minimum_rating) || 1));
  return rating >= minimum && !!String(rules.reply_text || '').trim();
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
  const data = await res.json();
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
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || 'Google token exchange failed');
  return data;
}

export async function getYouTubeChannel(accessToken) {
  const res = await fetch('https://www.googleapis.com/youtube/v3/channels?part=id,snippet&mine=true', {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Unable to read YouTube channel');
  const ch = data.items?.[0];
  if (!ch) throw new Error('No YouTube channel found for this Google account');
  return { id: ch.id, name: ch.snippet?.title || 'YouTube channel', avatar_url: ch.snippet?.thumbnails?.default?.url || null };
}
