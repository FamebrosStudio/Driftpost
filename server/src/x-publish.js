import fs from 'node:fs/promises';
import { decryptJson, encryptJson } from './crypto.js';

const TOKEN_URL = 'https://api.x.com/2/oauth2/token';
const MEDIA_URL = 'https://api.x.com/2/media/upload';
const POSTS_URL = 'https://api.x.com/2/tweets';
const CHUNK_SIZE = 4 * 1024 * 1024;

function clientAuthorization() {
  return `Basic ${Buffer.from(`${process.env.X_CLIENT_ID}:${process.env.X_CLIENT_SECRET}`).toString('base64')}`;
}

async function xError(response, fallback) {
  const body = await response.json().catch(() => ({}));
  return new Error(body.detail || body.error_description || body.errors?.[0]?.message || body.title || body.error || fallback);
}

export async function validXAccessToken(supabase, connection) {
  const tokens = decryptJson(connection.encrypted_tokens);
  const expiresAt = connection.token_expires_at ? new Date(connection.token_expires_at).getTime() : 0;
  if (tokens.access_token && expiresAt > Date.now() + 5 * 60 * 1000) return tokens.access_token;
  if (!tokens.refresh_token) throw new Error('X authorization expired. Reconnect the account.');
  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: clientAuthorization(), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ refresh_token: tokens.refresh_token, grant_type: 'refresh_token' }),
  });
  const refreshed = await response.json();
  if (!response.ok) throw new Error(refreshed.error_description || refreshed.error || 'Unable to refresh X authorization');
  const next = { ...tokens, ...refreshed, refresh_token: refreshed.refresh_token || tokens.refresh_token };
  const expiry = new Date(Date.now() + refreshed.expires_in * 1000).toISOString();
  const { error } = await supabase.from('platform_connections').update({
    encrypted_tokens: encryptJson(next), token_expires_at: expiry, updated_at: new Date().toISOString(),
  }).eq('id', connection.id);
  if (error) throw new Error('Unable to update X authorization');
  return refreshed.access_token;
}

async function uploadImage(accessToken, file) {
  const bytes = await fs.readFile(file.path);
  const response = await fetch(MEDIA_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ media: bytes.toString('base64'), media_type: file.mimetype, media_category: 'tweet_image' }),
  });
  if (!response.ok) throw await xError(response, 'X image upload failed');
  const body = await response.json();
  return body.data?.id || body.media_id_string;
}

async function waitForXMedia(accessToken, mediaId, processingInfo, onProgress) {
  let info = processingInfo;
  while (info && !['succeeded', 'failed'].includes(info.state)) {
    await new Promise((r) => setTimeout(r, Math.max(1, info.check_after_secs || 2) * 1000));
    const params = new URLSearchParams({ command: 'STATUS', media_id: mediaId });
    const response = await fetch(`${MEDIA_URL}?${params}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!response.ok) throw await xError(response, 'Unable to read X media status');
    const body = await response.json();
    info = body.data?.processing_info || body.processing_info;
    if (info?.progress_percent != null) onProgress(info.progress_percent);
  }
  if (info?.state === 'failed') throw new Error(info.error?.message || 'X could not process the media');
}

async function uploadChunkedMedia(accessToken, file, onProgress) {
  const category = file.mimetype === 'image/gif' ? 'tweet_gif' : 'tweet_video';
  const init = new FormData();
  init.append('command', 'INIT');
  init.append('media_type', file.mimetype);
  init.append('total_bytes', String(file.size));
  init.append('media_category', category);
  const initRes = await fetch(MEDIA_URL, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` }, body: init });
  if (!initRes.ok) throw await xError(initRes, 'Unable to start X media upload');
  const initBody = await initRes.json();
  const mediaId = initBody.data?.id || initBody.media_id_string;
  if (!mediaId) throw new Error('X did not return a media id');
  const handle = await fs.open(file.path, 'r');
  let offset = 0; let segment = 0;
  try {
    while (offset < file.size) {
      const length = Math.min(CHUNK_SIZE, file.size - offset);
      const buffer = Buffer.allocUnsafe(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      if (!bytesRead) throw new Error('Media file could not be read');
      const append = new FormData();
      append.append('command', 'APPEND');
      append.append('media_id', String(mediaId));
      append.append('segment_index', String(segment));
      append.append('media', new Blob([buffer.subarray(0, bytesRead)], { type: file.mimetype }), file.originalname);
      const appendRes = await fetch(MEDIA_URL, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` }, body: append });
      if (!appendRes.ok) throw await xError(appendRes, 'X media chunk failed');
      offset += bytesRead; segment += 1;
      onProgress(Math.min(95, Math.round((offset / file.size) * 95)));
    }
  } finally { await handle.close(); }
  const finalize = new FormData();
  finalize.append('command', 'FINALIZE');
  finalize.append('media_id', String(mediaId));
  const finRes = await fetch(MEDIA_URL, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` }, body: finalize });
  if (!finRes.ok) throw await xError(finRes, 'Unable to finalize X media');
  const finBody = await finRes.json();
  await waitForXMedia(accessToken, String(mediaId), finBody.data?.processing_info || finBody.processing_info, (p) => onProgress(Math.min(99, 95 + Math.round(p * 0.04))));
  return String(mediaId);
}

export async function uploadXMedia(accessToken, file, onProgress) {
  if (!file) return null;
  if (file.mimetype.startsWith('image/') && file.mimetype !== 'image/gif') {
    const id = await uploadImage(accessToken, file);
    onProgress(100);
    return id;
  }
  return uploadChunkedMedia(accessToken, file, onProgress);
}

export async function createXPost(accessToken, text, mediaId, replySettings) {
  const response = await fetch(POSTS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      ...(mediaId ? { media: { media_ids: [String(mediaId)] } } : {}),
      ...(['following', 'mentionedUsers'].includes(replySettings) ? { reply_settings: replySettings } : {}),
    }),
  });
  if (!response.ok) throw await xError(response, 'X post failed');
  const body = await response.json();
  if (!body.data?.id) throw new Error('X did not return a post id');
  return body.data;
}
