import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import multer from 'multer';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { decryptJson, encryptJson, signState, verifyState } from './crypto.js';
import { exchangeGoogleCode, getYouTubeChannel, youtubeAuthorizationUrl } from './google.js';
import { uploadVideoResumable, validAccessToken } from './youtube-upload.js';
import { exchangeMetaCode, getMetaPages, longLivedToken, metaAuthorizationUrl, metaBusinessLoginUrl, publishFacebook, publishInstagram } from './meta.js';
import { createPkcePair, exchangeXCode, getXUser, xAuthorizationUrl } from './x.js';
import { createXPost, uploadXMedia, validXAccessToken } from './x-publish.js';

const required = ['FRONTEND_URL', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'TOKEN_ENCRYPTION_KEY', 'STATE_SIGNING_SECRET'];
const missing = required.filter((n) => !process.env[n]);
if (missing.length) throw new Error(`Missing env: ${missing.join(', ')}`);

const app = express();
const port = Number(process.env.PORT || 10000);
const BUCKET = process.env.MEDIA_BUCKET || 'driftpost-media';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const jobs = new Map();
const upload = multer({ dest: path.join(os.tmpdir(), 'driftpost-uploads'), limits: { fileSize: 2 * 1024 * 1024 * 1024, files: 2 } });

app.set('trust proxy', 1);
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: process.env.FRONTEND_URL }));
app.use(express.json({ limit: '1mb' }));

async function requireUser(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Sign in required' });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return res.status(401).json({ error: 'Session expired' });
  req.user = data.user;
  next();
}

app.get('/', (_req, res) => res.json({ ok: true, service: 'driftpost-api', platforms: ['youtube', 'instagram', 'facebook'] }));
app.get('/health', (_req, res) => res.json({ ok: true }));

app.get('/api/connections', requireUser, async (req, res) => {
  const { data, error } = await supabase.from('platform_connections')
    .select('id, platform, platform_account_id, account_name, avatar_url, created_at')
    .eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: 'Unable to load accounts' });
  res.json({ connections: data });
});

app.delete('/api/connections/:id', requireUser, async (req, res) => {
  const { data, error } = await supabase.from('platform_connections').delete()
    .eq('id', req.params.id).eq('user_id', req.user.id).select('id').maybeSingle();
  if (error) return res.status(500).json({ error: 'Unable to disconnect' });
  if (!data) return res.status(404).json({ error: 'Not found' });
  res.json({ disconnected: data });
});

app.get('/api/jobs/:id', requireUser, (req, res) => {
  const j = jobs.get(req.params.id);
  if (!j || j.userId !== req.user.id) return res.status(404).json({ error: 'Job not found' });
  res.json({ job: j });
});

// --- OAuth: YouTube (Google) ---
app.post('/api/oauth/youtube/start', requireUser, (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) return res.status(503).json({ error: 'YouTube OAuth not configured' });
  res.json({ url: youtubeAuthorizationUrl(signState({ userId: req.user.id, nonce: crypto.randomUUID(), exp: Date.now() + 10 * 60 * 1000 })) });
});

app.get('/api/oauth/youtube/callback', async (req, res) => {
  const back = new URL(process.env.FRONTEND_URL);
  try {
    if (req.query.error) throw new Error(String(req.query.error_description || req.query.error));
    const state = verifyState(req.query.state);
    const tokens = await exchangeGoogleCode(String(req.query.code || ''));
    const ch = await getYouTubeChannel(tokens.access_token);
    const { error } = await supabase.from('platform_connections').upsert({
      user_id: state.userId, platform: 'youtube', platform_account_id: ch.id,
      account_name: ch.name, avatar_url: ch.avatar_url,
      encrypted_tokens: encryptJson({ access_token: tokens.access_token, refresh_token: tokens.refresh_token }),
      token_expires_at: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,platform,platform_account_id' });
    if (error) throw error;
    back.searchParams.set('connected', 'youtube');
  } catch (e) { back.searchParams.set('oauth_error', e.message); }
  res.redirect(back.toString());
});

// --- OAuth: Meta (Facebook: regular Login / Instagram: Login for Business) ---
app.post('/api/oauth/facebook/start', requireUser, (req, res) => {
  if (!process.env.META_APP_ID) return res.status(503).json({ error: 'Meta OAuth not configured' });
  res.json({ url: metaAuthorizationUrl(signState({ userId: req.user.id, nonce: crypto.randomUUID(), exp: Date.now() + 10 * 60 * 1000 })) });
});
app.post('/api/oauth/instagram/start', requireUser, (req, res) => {
  if (!process.env.META_APP_ID) return res.status(503).json({ error: 'Meta OAuth not configured' });
  if (!process.env.META_CONFIG_ID) return res.status(503).json({ error: 'Instagram needs a Business Login configuration ID (META_CONFIG_ID)' });
  res.json({ url: metaBusinessLoginUrl(signState({ userId: req.user.id, nonce: crypto.randomUUID(), exp: Date.now() + 10 * 60 * 1000 })) });
});

app.get('/api/oauth/meta/callback', async (req, res) => {
  const back = new URL(process.env.FRONTEND_URL);
  try {
    if (req.query.error) throw new Error(String(req.query.error_description || req.query.error));
    const state = verifyState(req.query.state);
    const short = await exchangeMetaCode(String(req.query.code || ''));
    const long = await longLivedToken(short.access_token);
    const userToken = long.access_token;
    const pages = await getMetaPages(userToken);
    if (!pages.length) throw new Error('No Facebook Page found. Create a Page and link Instagram in Page Settings first.');
    for (const page of pages.slice(0, 5)) {
      await supabase.from('platform_connections').upsert({
        user_id: state.userId, platform: 'facebook', platform_account_id: page.id,
        account_name: page.name, avatar_url: null,
        encrypted_tokens: encryptJson({ access_token: page.access_token }),
        token_expires_at: null, updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,platform,platform_account_id' });
      const ig = page.instagram_business_account;
      if (ig?.id) {
        await supabase.from('platform_connections').upsert({
          user_id: state.userId, platform: 'instagram', platform_account_id: ig.id,
          account_name: ig.username ? `@${ig.username}` : page.name, avatar_url: null,
          encrypted_tokens: encryptJson({ access_token: page.access_token, page_id: page.id }),
          token_expires_at: null, updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,platform,platform_account_id' });
      }
    }
    back.searchParams.set('connected', 'facebook/instagram');
  } catch (e) { back.searchParams.set('oauth_error', e.message); }
  res.redirect(back.toString());
});

// --- OAuth: X ---
app.post('/api/oauth/x/start', requireUser, (req, res) => {
  if (!process.env.X_CLIENT_ID || !process.env.X_CLIENT_SECRET || !process.env.X_REDIRECT_URI) {
    return res.status(503).json({ error: 'X OAuth is not configured yet' });
  }
  const pkce = createPkcePair();
  const state = signState({
    userId: req.user.id,
    nonce: crypto.randomUUID(),
    pkce: encryptJson({ verifier: pkce.verifier }),
    exp: Date.now() + 10 * 60 * 1000,
  });
  res.json({ url: xAuthorizationUrl(state, pkce.challenge) });
});

app.get('/api/oauth/x/callback', async (req, res) => {
  const back = new URL(process.env.FRONTEND_URL);
  try {
    if (!process.env.X_CLIENT_ID || !process.env.X_CLIENT_SECRET || !process.env.X_REDIRECT_URI) {
      throw new Error('X OAuth is not configured yet');
    }
    if (req.query.error) throw new Error(String(req.query.error_description || req.query.error));
    const state = verifyState(req.query.state);
    const { verifier } = decryptJson(state.pkce);
    const tokens = await exchangeXCode(String(req.query.code || ''), verifier);
    const account = await getXUser(tokens.access_token);
    const { error } = await supabase.from('platform_connections').upsert({
      user_id: state.userId, platform: 'x', platform_account_id: account.id,
      account_name: account.name, avatar_url: account.avatar_url,
      encrypted_tokens: encryptJson({ access_token: tokens.access_token, refresh_token: tokens.refresh_token }),
      token_expires_at: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id,platform,platform_account_id' });
    if (error) throw error;
    back.searchParams.set('connected', 'x');
  } catch (e) { back.searchParams.set('oauth_error', e.message); }
  res.redirect(back.toString());
});

// --- Unified publish: youtube | facebook | instagram | x ---
app.post('/api/publish', requireUser, upload.single('media'), async (req, res) => {
  const platform = String(req.body.platform || '');
  const connectionId = String(req.body.connection_id || '');
  if (!['youtube', 'facebook', 'instagram', 'x'].includes(platform)) {
    if (req.file) await fs.unlink(req.file.path).catch(() => {});
    return res.status(400).json({ error: 'Pick YouTube, Instagram, Facebook or X' });
  }
  const { data: conn, error } = await supabase.from('platform_connections')
    .select('*').eq('id', connectionId).eq('user_id', req.user.id).eq('platform', platform).maybeSingle();
  if (error || !conn) {
    if (req.file) await fs.unlink(req.file.path).catch(() => {});
    return res.status(409).json({ error: `Connect a ${platform} account first` });
  }
  const id = crypto.randomUUID();
  const job = { id, userId: req.user.id, platform, state: 'queued', progress: 0, message: 'Queued', createdAt: Date.now() };
  jobs.set(id, job);
  res.status(202).json({ job });
  void runPublish(job, conn, req.file, req.body, req.user.id);
});

async function runPublish(job, conn, file, body, userId) {
  try {
    const text = String(body.text || '').trim();
    if (job.platform === 'youtube') {
      if (!file || !file.mimetype.startsWith('video/')) throw new Error('YouTube needs a video file');
      if (!String(body.title || '').trim()) throw new Error('YouTube needs a title');
      job.state = 'uploading'; job.message = 'Uploading to YouTube';
      const token = await validAccessToken(supabase, conn);
      const video = await uploadVideoResumable({
        accessToken: token, file,
        metadata: { title: String(body.title).slice(0, 100), description: text.slice(0, 5000), tags: [], privacy: ['public', 'unlisted', 'private'].includes(body.privacy) ? body.privacy : 'private' },
        onProgress: (p) => { job.progress = p; },
      });
      job.url = `https://www.youtube.com/watch?v=${video.id}`;
    } else if (job.platform === 'x') {
      const xText = String(body.text || '').trim();
      if (!xText) throw new Error('Write some text for X');
      if (Array.from(xText).length > 280) throw new Error('X allows 280 characters or fewer');
      job.state = 'uploading'; job.progress = 20; job.message = 'Preparing X post';
      const token = await validXAccessToken(supabase, conn);
      let mediaId = null;
      if (file) {
        const isImage = file.mimetype.startsWith('image/');
        const isVideo = file.mimetype.startsWith('video/');
        if (!isImage && !isVideo) throw new Error('X supports images, GIFs and video only');
        mediaId = await uploadXMedia(token, file, (p) => { job.progress = Math.min(90, Math.round(p * 0.9)); });
      }
      job.state = 'publishing'; job.progress = 95; job.message = 'Posting to X';
      const post = await createXPost(token, xText, mediaId);
      job.url = `https://x.com/i/status/${post.id}`;
    } else {
      const { decryptJson: dec } = await import('./crypto.js');
      const tokens = dec(conn.encrypted_tokens);
      const pageToken = tokens.access_token;
      const pageId = tokens.page_id || conn.platform_account_id;
      let media = null;
      let publicUrl = null;
      if (file) {
        const bytes = await fs.readFile(file.path);
        media = { ...file, bytes };
        // Instagram needs a public URL -> upload to Supabase Storage
        if (job.platform === 'instagram') {
          const ext = path.extname(file.originalname || '') || (file.mimetype.startsWith('video/') ? '.mp4' : '.jpg');
          const key = `${userId}/${Date.now()}${ext}`;
          const { error: upErr } = await supabase.storage.from(BUCKET).upload(key, bytes, { contentType: file.mimetype, upsert: true });
          if (upErr) throw new Error('Media upload for Instagram failed. Create public bucket "' + BUCKET + '" in Supabase Storage.');
          const { data } = supabase.storage.from(BUCKET).getPublicUrl(key);
          publicUrl = data.publicUrl;
        }
      }
      job.state = 'publishing'; job.progress = 60; job.message = `Publishing to ${job.platform}`;
      if (job.platform === 'facebook') {
        const out = await publishFacebook({ pageId: conn.platform_account_id, pageToken, text, media });
        job.url = out.url;
      } else {
        const igId = conn.platform_account_id;
        const out = await (await import('./meta.js')).publishInstagram({
          igUserId: igId, pageToken, caption: text, mediaUrl: publicUrl, isVideo: !!file?.mimetype.startsWith('video/'),
        });
        job.url = out.url;
      }
    }
    job.state = 'completed'; job.progress = 100; job.message = 'Published'; job.completedAt = Date.now();
    await supabase.from('post_history').insert({ user_id: userId, platform: job.platform, status: 'published', url: job.url || null, caption: String(body.text || '').slice(0, 500) }).then(() => {});
  } catch (e) {
    job.state = 'failed'; job.message = e.message; job.completedAt = Date.now();
  } finally {
    if (file?.path) await fs.unlink(file.path).catch(() => {});
  }
}

setInterval(() => {
  const cut = Date.now() - 60 * 60 * 1000;
  for (const [id, j] of jobs) if (j.completedAt && j.completedAt < cut) jobs.delete(id);
}, 10 * 60 * 1000).unref();

app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ error: 'Server error' }); });
app.listen(port, '0.0.0.0', () => console.log(`Driftpost API on :${port}`));
