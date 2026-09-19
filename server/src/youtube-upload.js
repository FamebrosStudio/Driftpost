import fs from 'node:fs/promises';
import { decryptJson, encryptJson } from './crypto.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CHUNK = 8 * 1024 * 1024;

async function gerr(res, fallback) {
  const b = await res.json().catch(() => ({}));
  return new Error(b.error?.message || b.error_description || b.error || fallback);
}

export async function validAccessToken(supabase, connection) {
  const tokens = decryptJson(connection.encrypted_tokens);
  const exp = connection.token_expires_at ? new Date(connection.token_expires_at).getTime() : 0;
  if (tokens.access_token && exp > Date.now() + 5 * 60 * 1000) return tokens.access_token;
  if (!tokens.refresh_token) throw new Error('YouTube authorization expired. Reconnect.');
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: tokens.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  const r = await res.json();
  if (!res.ok) throw new Error(r.error_description || 'Unable to refresh YouTube authorization');
  const next = { ...tokens, ...r, refresh_token: tokens.refresh_token };
  const expiry = new Date(Date.now() + r.expires_in * 1000).toISOString();
  const { error } = await supabase.from('platform_connections').update({
    encrypted_tokens: encryptJson(next), token_expires_at: expiry, updated_at: new Date().toISOString(),
  }).eq('id', connection.id);
  if (error) throw new Error('Unable to update YouTube authorization');
  return r.access_token;
}

export async function uploadVideoResumable({ accessToken, file, metadata, onProgress }) {
  const init = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(file.size),
      'X-Upload-Content-Type': file.mimetype,
    },
    body: JSON.stringify({
      snippet: { title: metadata.title, description: metadata.description, tags: metadata.tags },
      status: { privacyStatus: metadata.privacy },
    }),
  });
  if (!init.ok) throw await gerr(init, 'Unable to start YouTube upload');
  const url = init.headers.get('location');
  if (!url) throw new Error('YouTube did not return an upload session');
  const h = await fs.open(file.path, 'r');
  let offset = 0; let video;
  try {
    while (offset < file.size) {
      const len = Math.min(CHUNK, file.size - offset);
      const buf = Buffer.allocUnsafe(len);
      const { bytesRead } = await h.read(buf, 0, len, offset);
      if (!bytesRead) throw new Error('Video file could not be read');
      const end = offset + bytesRead - 1;
      const res = await fetch(url, {
        method: 'PUT', redirect: 'manual',
        headers: { 'Content-Type': file.mimetype, 'Content-Length': String(bytesRead), 'Content-Range': `bytes ${offset}-${end}/${file.size}` },
        body: bytesRead === buf.length ? buf : buf.subarray(0, bytesRead),
      });
      if (res.status === 308) { offset += bytesRead; onProgress(Math.min(99, Math.round((offset / file.size) * 100))); continue; }
      if (!res.ok) throw await gerr(res, 'YouTube upload failed');
      video = await res.json(); offset = file.size; onProgress(100);
    }
  } finally { await h.close(); }
  if (!video?.id) throw new Error('YouTube did not return a video id');
  return video;
}
