import crypto from 'node:crypto';

const AUTHORIZE_URL = 'https://x.com/i/oauth2/authorize';
const TOKEN_URL = 'https://api.x.com/2/oauth2/token';

export function createPkcePair() {
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function xAuthorizationUrl(state, challenge) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.X_CLIENT_ID,
    redirect_uri: process.env.X_REDIRECT_URI,
    scope: 'tweet.read tweet.write users.read media.write offline.access',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  return `${AUTHORIZE_URL}?${params}`;
}

function clientAuthorization() {
  return `Basic ${Buffer.from(`${process.env.X_CLIENT_ID}:${process.env.X_CLIENT_SECRET}`).toString('base64')}`;
}

export async function exchangeXCode(code, verifier) {
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: clientAuthorization(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, grant_type: 'authorization_code', redirect_uri: process.env.X_REDIRECT_URI, code_verifier: verifier }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error_description || data.error || 'X token exchange failed');
  return data;
}

export async function getXUser(accessToken) {
  const response = await fetch('https://api.x.com/2/users/me?user.fields=name,username,profile_image_url', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.detail || body.errors?.[0]?.message || body.title || 'Unable to read X account');
  if (!body.data?.id) throw new Error('X did not return an account');
  return { id: body.data.id, name: body.data.username ? `@${body.data.username}` : body.data.name, avatar_url: body.data.profile_image_url || null };
}
