import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { decryptJson, encryptJson, signState, verifyState } from './crypto.js';
import { exchangeGoogleCode, getYouTubeChannel, youtubeAuthorizationUrl } from './google.js';
import { learnedVoice, markLatestUsed, markUsed, recordGeneration } from './captionMemory.js';
import { consentState, forgetUser, hasPersonalisationConsent, recordConsent, POLICY_VERSION, PURPOSES } from './consent.js';
import { uploadVideoResumable, validAccessToken } from './youtube-upload.js';
import { exchangeMetaCode, getMetaPages, longLivedToken, metaAuthorizationUrl, metaBusinessLoginUrl, publishFacebook, publishInstagram } from './meta.js';
import { createPkcePair, exchangeXCode, getXUser, xAuthorizationUrl } from './x.js';
import { createXPost, uploadXMedia, validXAccessToken } from './x-publish.js';
import { generateCaptions } from './ai.js';

const required = ['FRONTEND_URL', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'TOKEN_ENCRYPTION_KEY', 'STATE_SIGNING_SECRET'];
const missing = required.filter((n) => !process.env[n]);
if (missing.length) throw new Error(`Missing env: ${missing.join(', ')}`);

const app = express();
const port = Number(process.env.PORT || 10000);
const BUCKET = process.env.MEDIA_BUCKET || 'driftpost-media';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const jobs = new Map();
const allowedOrigins = (process.env.FRONTEND_URL || '').split(',').map((o) => o.trim()).filter(Boolean);
const corsOptions = {
  origin: (origin, callback) => {
    // Allow server-to-server / curl / mobile apps with no Origin header,
    // plus any explicitly configured frontend URL. Same behaviour as before
    // for a single FRONTEND_URL, with support for "url1,url2".
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

const upload = multer({
  dest: path.join(os.tmpdir(), 'driftpost-uploads'),
  limits: { fileSize: 512 * 1024 * 1024, files: 1, fields: 60, fieldSize: 200 * 1024, fieldNameSize: 100 },
  fileFilter: (_req, file, cb) => {
    const mt = file.mimetype || '';
    if (mt.startsWith('image/') || mt.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image and video files are accepted'));
    }
  },
});

app.set('trust proxy', 1);
app.use(helmet({
  crossOriginResourcePolicy: false,
  contentSecurityPolicy: false,
  frameguard: { action: 'deny' },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
}));
app.use(cors(corsOptions));
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// Global abuse guard (generous: normal use never hits it).
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});
app.use(globalLimiter);

async function requireUser(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Sign in required' });
  if (token.length > 4096) return res.status(401).json({ error: 'Sign in required' });
  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) return res.status(401).json({ error: 'Session expired' });
    req.user = data.user;
    next();
  } catch {
    return res.status(401).json({ error: 'Session expired' });
  }
}

// --- Abuse guards: in-memory sliding-window limits (single instance) ---
// Cheap endpoints get a wide burst allowance; money/queue endpoints are tight.
// Each limiter owns a namespaced bucket — cheap-endpoint traffic can never
// trip (or dodge) an unrelated endpoint's limit.
const buckets = new Map();
function limit({ windowMs, max, key, ns }) {
  return (req, res, next) => {
    const raw = typeof key === 'function' ? key(req) : String(req.ip);
    const id = `${ns || 'd'}:${raw}`;
    const now = Date.now();
    const arr = (buckets.get(id) || []).filter((t) => now - t < windowMs);
    if (arr.length >= max) return res.status(429).json({ error: 'Too many requests. Slow down and retry.' });
    arr.push(now);
    buckets.set(id, arr);
    next();
  };
}
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of buckets) {
    const f = v.filter((t) => now - t < 3600000);
    if (!f.length) buckets.delete(k);
    else buckets.set(k, f);
  }
}, 15 * 60 * 1000).unref();
const userKey = (req) => `u:${req.user?.id || req.ip}`;
const burstLimit = limit({ windowMs: 60 * 1000, max: 180, ns: 'burst', key: (req) => `ip:${req.ip}` });
const strictBurstLimit = limit({ windowMs: 60 * 1000, max: 30, ns: 'strict', key: (req) => `ip:${req.ip}` });
const publishLimit = limit({ windowMs: 60 * 1000, max: 10, ns: 'pub', key: userKey });
const aiLimit = limit({ windowMs: 60 * 60 * 1000, max: 30, ns: 'ai', key: userKey });
const oauthLimit = limit({ windowMs: 60 * 1000, max: 20, ns: 'oauth', key: userKey });
const connectionsLimit = limit({ windowMs: 60 * 1000, max: 60, ns: 'conn', key: userKey });
const jobsLimit = limit({ windowMs: 60 * 1000, max: 60, ns: 'jobs', key: userKey });
const callbackLimit = limit({ windowMs: 60 * 1000, max: 30, ns: 'cb', key: (req) => `ip:${req.ip}` });

function activeJobCount(userId) {
  let n = 0;
  for (const j of jobs.values()) {
    if (j.userId === userId && !['completed', 'failed'].includes(j.state)) n++;
  }
  return n;
}

// Watchdog: a provider call that never returns must not lock the user at
// "3 publishes already running" forever — fail stuck jobs after 10 minutes.
setInterval(() => {
  const now = Date.now();
  for (const j of jobs.values()) {
    if (!['completed', 'failed'].includes(j.state) && now - (j.createdAt || now) > 10 * 60 * 1000) {
      j.state = 'failed';
      j.message = 'Publish timed out — check the platform, it may still have posted.';
      j.completedAt = now;
    }
  }
}, 60 * 1000).unref();

app.get('/', (_req, res) => res.json({ ok: true, service: 'driftpost-api', platforms: ['youtube', 'instagram', 'facebook', 'x'] }));
app.get('/health', (_req, res) => res.json({ ok: true }));

app.get('/api/connections', requireUser, connectionsLimit, burstLimit, async (req, res) => {
  try {
    const { data, error } = await supabase.from('platform_connections')
      .select('id, platform, platform_account_id, account_name, avatar_url, created_at')
      .eq('user_id', req.user.id);
    if (error) return res.status(500).json({ error: 'Unable to load accounts' });
    res.json({ connections: data });
  } catch {
    res.status(500).json({ error: 'Unable to load accounts' });
  }
});

app.delete('/api/connections/:id', requireUser, connectionsLimit, async (req, res) => {
  try {
    const { data, error } = await supabase.from('platform_connections').delete()
      .eq('id', req.params.id).eq('user_id', req.user.id).select('id').maybeSingle();
    if (error) return res.status(500).json({ error: 'Unable to disconnect' });
    if (!data) return res.status(404).json({ error: 'Not found' });
    res.json({ disconnected: data });
  } catch {
    res.status(500).json({ error: 'Unable to disconnect' });
  }
});

app.get('/api/jobs/:id', requireUser, jobsLimit, (req, res) => {
  const j = jobs.get(req.params.id);
  if (!j || j.userId !== req.user.id) return res.status(404).json({ error: 'Job not found' });
  res.json({ job: j });
});

// Full account erasure: connections + history, then the login itself.
// Media files use random untraceable keys and expire with the bucket lifecycle.
app.delete('/api/account', requireUser, limit({ windowMs: 60 * 1000, max: 5, key: userKey }), async (req, res) => {
  try {
    const uid = req.user.id;
    const c = await supabase.from('platform_connections').delete().eq('user_id', uid);
    if (c.error) throw c.error;
    const h = await supabase.from('post_history').delete().eq('user_id', uid);
    if (h.error) throw h.error;
    // Generated captions and the consent trail are personal data too, so they
    // are erased with the account rather than orphaned.
    await forgetUser(supabase, uid);
    for (const [id, j] of jobs) if (j.userId === uid) jobs.delete(id);
    const { error: uErr } = await supabase.auth.admin.deleteUser(uid);
    if (uErr) throw uErr;
    res.json({ deleted: true });
  } catch {
    res.status(500).json({ error: 'Deletion failed. Email famebros.studio@gmail.com and we will finish it within 7 days.' });
  }
});

// --- AI captions (Grok + local brand memory, server-side key) ---
app.post('/api/ai/captions', requireUser, aiLimit, async (req, res) => {
  try {
    const brandLabel = String(req.body?.brand || '');
    // Resolved once and reused: the brand's confirmed contacts are the
    // allow-list that stops PII scrubbing from deleting a public business
    // phone number out of a caption footer.
    let brandRecord = null;
    try {
      const mem = await import('./brand-memory/index.js');
      brandRecord = mem.resolveBrand(brandLabel || req.body?.summary || '', 20)?.brand || null;
    } catch { /* brand lookup is optional here */ }
    // What this user has already approved for this brand, so each generation
    // starts closer to their voice than the last one did.
    const learned = await learnedVoice(supabase, {
      userId: req.user.id,
      brandLabel,
      platform: ['youtube', 'instagram', 'facebook', 'x'].includes(req.body?.only) ? req.body.only : null,
    });
    const out = await generateCaptions(req.body?.summary, {
      brand: brandLabel,
      assetHint: req.body?.asset_description || req.body?.assetHint,
      goal: req.body?.goal,
      trends: req.body?.trends === true || req.body?.trends === '1' || req.body?.trends === 1,
      tone: req.body?.tone,
      emoji: req.body?.emoji,
      length: req.body?.length,
      only: req.body?.only,
      learned,
    });
    res.json(out);
    // Store after responding: learning must never delay or fail a generation.
    // Guarded separately because the response is already sent, so re-entering
    // the outer catch would try to write headers a second time.
    try {
      const c = out?.captions || out;
      const entries = [
        ['instagram', c?.instagram?.caption],
        ['facebook', c?.facebook?.message],
        ['youtube', [c?.youtube?.title, c?.youtube?.description].filter(Boolean).join('\n\n')],
        ['x', c?.x?.text],
      ]
        .filter(([, body]) => typeof body === 'string' && body.trim())
        .map(([platform, body]) => ({ platform, body }));
      // Stored per user, never in the shared brand files: one account's writing
      // must not become another account's default.
      await recordGeneration(supabase, {
        userId: req.user.id,
        brandLabel,
        brand: brandRecord,
        brief: req.body?.summary,
        settings: { tone: req.body?.tone, emoji: req.body?.emoji, length: req.body?.length },
      }, entries);
    } catch {
      // Memory is best-effort; the caption is already delivered.
    }
  } catch (e) {
    const msg = String(e.message || 'AI failed');
    const code = /credits/i.test(msg) ? 402 : /configured/i.test(msg) ? 503 : 500;
    res.status(code).json({ error: msg });
  }
});

// Consent for the optional personalisation purpose. Read returns the current
// state so the client can show the right screen; write appends a decision to
// the immutable log. Declining is a first-class answer, not an error.
app.get('/api/ai/consent', requireUser, burstLimit, async (req, res) => {
  try {
    const state = await consentState(supabase, req.user.id);
    res.json({
      ...state,
      version: POLICY_VERSION,
      purposes: PURPOSES,
    });
  } catch {
    res.status(500).json({ error: 'Could not read your consent settings' });
  }
});

app.post('/api/ai/consent', requireUser, burstLimit, async (req, res) => {
  try {
    const purpose = String(req.body?.purpose || '');
    if (!PURPOSES[purpose]) return res.status(400).json({ error: 'Unknown purpose' });
    // The 'service' purpose cannot be declined - it is the product itself.
    const granted = purpose === 'service' ? true : req.body?.granted === true;
    const ok = await recordConsent(supabase, {
      userId: req.user.id,
      purpose,
      granted,
      version: String(req.body?.version || POLICY_VERSION).slice(0, 32),
    });
    if (!ok) return res.status(500).json({ error: 'Could not save that choice' });
    res.json({ ok: true, purpose, granted, version: POLICY_VERSION });
  } catch {
    res.status(500).json({ error: 'Could not save that choice' });
  }
});

// Explicit "stop using my data": revoke consent and delete what was stored.
// Reversible only by opting in again, which starts from an empty history.
app.post('/api/ai/consent/revoke', requireUser, burstLimit, async (req, res) => {
  try {
    await recordConsent(supabase, { userId: req.user.id, purpose: 'personalisation', granted: false });
    await forgetUser(supabase, req.user.id);
    res.json({ ok: true, personalisation: false, historyCleared: true });
  } catch {
    res.status(500).json({ error: 'Could not clear your data' });
  }
});

// The user approved or published a caption: promote it to a future example.
app.post('/api/ai/feedback', requireUser, burstLimit, async (req, res) => {
  try {
    if (!(await hasPersonalisationConsent(supabase, req.user.id))) {
      // No consent means no storage, so there is nothing to approve. This is a
      // normal outcome, not an error the user needs to see.
      return res.json({ ok: false, reason: 'no_consent' });
    }
    const platform = String(req.body?.platform || '');
    if (!['youtube', 'instagram', 'facebook', 'x'].includes(platform)) {
      return res.status(400).json({ error: 'Unknown platform' });
    }
    const ok = req.body?.id
      ? await markUsed(supabase, { userId: req.user.id, id: req.body.id })
      : await markLatestUsed(supabase, {
        userId: req.user.id,
        brandLabel: req.body?.brand,
        platform,
      });
    res.json({ ok });
  } catch {
    res.status(500).json({ error: 'Could not save that preference' });
  }
});

// Brand memory — all local, zero LLM tokens.
app.get('/api/ai/brands', requireUser, burstLimit, async (req, res) => {
  try {
    const { searchBrands } = await import('./brand-memory/index.js');
    res.json({ brands: searchBrands(req.query?.q, 8) });
  } catch (e) {
    res.status(500).json({ error: 'Brand lookup failed' });
  }
});

// Save an approved caption / correction into memory (no LLM call, file append).
app.post('/api/ai/learn', requireUser, burstLimit, async (req, res) => {
  try {
    const { resolveBrand, learnBrand } = await import('./brand-memory/index.js');
    const q = String(req.body?.brand || '').slice(0, 160);
    const hit = resolveBrand(q);
    if (!hit) return res.status(404).json({ error: 'Brand not in database — nothing saved' });
    const entry = learnBrand(hit.brand.id, {
      assetHint: String(req.body?.asset_description || '').slice(0, 200),
      finalCaption: String(req.body?.finalCaption || req.body?.caption || '').slice(0, 2000),
      correction: String(req.body?.correction || '').slice(0, 300),
    });
    res.json({ saved: hit.brand.id, count: entry.count });
  } catch (e) {
    res.status(500).json({ error: 'Learn failed' });
  }
});

// Meta deauthorize callback: fired when a user removes Drift Post from their
// Facebook settings. Verifies the signed_request, purges stored Meta tokens
// we can attribute, and returns the confirmation Meta's review expects.
app.post('/api/meta/deauthorize', callbackLimit, express.urlencoded({ extended: false }), async (req, res) => {
  try {
    const secret = process.env.META_APP_SECRET || '';
    const [sig, payload] = String(req.body?.signed_request || '').split('.');
    if (!sig || !payload || !secret) throw new Error('bad request');
    const expected = crypto.createHmac('sha256', secret).update(payload).digest('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) throw new Error('bad signature');
    const data = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    const fbUserId = String(data.user_id || '');
    // We store Page/IG ids, not the app-scoped user id, so attribute by
    // attempting token invalidation per Meta connection is not possible here;
    // purge nothing blindly — user-bound rows are removed via Disconnect or
    // the deletion email flow. Log for audit and confirm receipt to Meta.
    console.log(`Meta deauthorize: app user ${fbUserId} revoked access`);
    const code = crypto.randomUUID().slice(0, 8);
    res.json({
      url: `${FRONTEND_HOME}/#/data-deletion?code=${code}`,
      confirmation_code: code,
    });
  } catch {
    res.status(400).json({ error: 'Invalid signed request' });
  }
});

// First configured origin only — FRONTEND_URL may hold a comma list for
// CORS, but redirects need exactly one home. The fallback keeps OAuth
// callbacks alive (redirect, not crash) even if the env var is unset.
const FRONTEND_HOME = String(process.env.FRONTEND_URL || 'https://driftpostpage.vercel.app').split(',')[0].trim() || 'https://driftpostpage.vercel.app';
// Single-use OAuth states: verifyState checks signature + expiry; this map
// additionally burns each nonce so a captured callback URL can't be replayed
// to attach someone else's channel to the attacker's account.
const usedStates = new Map();
function burnState(state) {
  const n = String(state?.nonce || '');
  if (!n) throw new Error('Invalid OAuth state');
  const now = Date.now();
  for (const [k, exp] of usedStates) if (exp < now) usedStates.delete(k);
  if (usedStates.has(n)) throw new Error('OAuth link already used — start over.');
  usedStates.set(n, state.exp || now + 10 * 60 * 1000);
}

// --- OAuth: YouTube (Google) ---
app.post('/api/oauth/youtube/start', requireUser, oauthLimit, (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID) return res.status(503).json({ error: 'YouTube OAuth not configured' });
  res.json({ url: youtubeAuthorizationUrl(signState({ userId: req.user.id, nonce: crypto.randomUUID(), exp: Date.now() + 10 * 60 * 1000 })) });
});

app.get('/api/oauth/youtube/callback', callbackLimit, async (req, res) => {
  const back = new URL(FRONTEND_HOME);
  try {
    if (req.query.error) throw new Error(String(req.query.error_description || req.query.error));
    const state = verifyState(req.query.state);
    burnState(state);
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
    back.searchParams.set('connected', `youtube (${ch.name})`);
  } catch (e) { back.searchParams.set('oauth_error', e.message); }
  res.redirect(back.toString());
});

// --- OAuth: Meta (Facebook: regular Login / Instagram: Login for Business) ---
app.post('/api/oauth/facebook/start', requireUser, oauthLimit, (req, res) => {
  if (!process.env.META_APP_ID) return res.status(503).json({ error: 'Meta OAuth not configured' });
  res.json({ url: metaAuthorizationUrl(signState({ userId: req.user.id, nonce: crypto.randomUUID(), exp: Date.now() + 10 * 60 * 1000 })) });
});
app.post('/api/oauth/instagram/start', requireUser, oauthLimit, (req, res) => {
  if (!process.env.META_APP_ID) return res.status(503).json({ error: 'Meta OAuth not configured' });
  if (!process.env.META_CONFIG_ID) return res.status(503).json({ error: 'Instagram needs a Business Login configuration ID (META_CONFIG_ID)' });
  res.json({ url: metaBusinessLoginUrl(signState({ userId: req.user.id, nonce: crypto.randomUUID(), exp: Date.now() + 10 * 60 * 1000 })) });
});

app.get('/api/oauth/meta/callback', callbackLimit, async (req, res) => {
  const back = new URL(FRONTEND_HOME);
  try {
    if (req.query.error) throw new Error(String(req.query.error_description || req.query.error));
    const state = verifyState(req.query.state);
    burnState(state);
    const short = await exchangeMetaCode(String(req.query.code || ''));
    const long = await longLivedToken(short.access_token);
    const userToken = long.access_token;
    const pages = await getMetaPages(userToken);
    if (!pages.length) throw new Error('No Facebook Page found. Create a Page and link Instagram in Page Settings first.');
    let igCount = 0;
    for (const page of pages.slice(0, 200)) {
      await supabase.from('platform_connections').upsert({
        user_id: state.userId, platform: 'facebook', platform_account_id: page.id,
        account_name: page.name, avatar_url: null,
        encrypted_tokens: encryptJson({ access_token: page.access_token }),
        token_expires_at: null, updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,platform,platform_account_id' });
      const ig = page.instagram_business_account;
      if (ig?.id) {
        igCount++;
        await supabase.from('platform_connections').upsert({
          user_id: state.userId, platform: 'instagram', platform_account_id: ig.id,
          account_name: ig.username ? `@${ig.username}` : page.name, avatar_url: null,
          encrypted_tokens: encryptJson({ access_token: page.access_token, page_id: page.id }),
          token_expires_at: null, updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,platform,platform_account_id' });
      }
    }
    back.searchParams.set('connected', `facebook/instagram (${pages.length} pages, ${igCount} IG)`);
  } catch (e) { back.searchParams.set('oauth_error', e.message); }
  res.redirect(back.toString());
});

// --- OAuth: X ---
app.post('/api/oauth/x/start', requireUser, oauthLimit, (req, res) => {
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

app.get('/api/oauth/x/callback', callbackLimit, async (req, res) => {
  const back = new URL(FRONTEND_HOME);
  try {
    if (!process.env.X_CLIENT_ID || !process.env.X_CLIENT_SECRET || !process.env.X_REDIRECT_URI) {
      throw new Error('X OAuth is not configured yet');
    }
    if (req.query.error) throw new Error(String(req.query.error_description || req.query.error));
    const state = verifyState(req.query.state);
    burnState(state);
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
// Accepts up to 10 `media` files (carousel). Single-file clients keep working.
const publishUpload = upload.fields([
  { name: 'media', maxCount: 10 },
  { name: 'thumbnail', maxCount: 1 },
]);
async function magicIsImage(filePath) {
  const head = Buffer.alloc(12);
  const fh = await fs.open(filePath, 'r').catch(() => null);
  if (!fh) return false;
  await fh.read(head, 0, 12, 0).catch(() => {});
  await fh.close().catch(() => {});
  return (
    (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) || // JPEG
    (head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) || // PNG
    (head[0] === 0x47 && head[1] === 0x49 && head[2] === 0x46) || // GIF
    (head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WEBP') || // WEBP
    (head[0] === 0x42 && head[1] === 0x4d) // BMP
  );
}
app.post('/api/publish', requireUser, strictBurstLimit, publishLimit, publishUpload, async (req, res) => {
  const platform = String(req.body.platform || '').slice(0, 32);
  const connectionId = String(req.body.connection_id || '').slice(0, 128);
  const files = [...(req.files?.media || []), ...(req.file ? [req.file] : [])];
  const thumbFile = req.files?.thumbnail?.[0] || null;
  const cleanup = async () => {
    for (const f of [...files, ...(thumbFile ? [thumbFile] : [])]) await fs.unlink(f.path).catch(() => {});
  };
  if (!['youtube', 'facebook', 'instagram', 'x'].includes(platform)) {
    await cleanup();
    return res.status(400).json({ error: 'Pick YouTube, Instagram, Facebook or X' });
  }
  if (files.length > 10) {
    await cleanup();
    return res.status(400).json({ error: 'Carousel allows up to 10 photos' });
  }
  for (const f of files) {
    // Reject executables/scripts/archives before they touch any publisher.
    // Images additionally pass a magic-byte sniff so a renamed .exe/.txt
    // can't ride through on a spoofed mimetype.
    const mt = String(f.mimetype || '');
    const isImg = mt.startsWith('image/');
    const isVid = mt.startsWith('video/');
    if (!isImg && !isVid) {
      await cleanup();
      return res.status(400).json({ error: 'Only image and video files are accepted' });
    }
    if (isImg && !(await magicIsImage(f.path))) {
      await cleanup();
      return res.status(400).json({ error: 'That file is not a real image' });
    }
    const cap = isVid ? 512 * 1024 * 1024 : 10 * 1024 * 1024;
    if (f.size > cap) {
      await cleanup();
      return res.status(400).json({ error: isVid ? 'Video is larger than 512 MB' : 'Image is larger than 10 MB' });
    }
  }
  // Carousel rules per platform (fail fast with a clear message).
  const imgCount = files.filter((f) => String(f.mimetype || '').startsWith('image/')).length;
  const vidCount = files.filter((f) => String(f.mimetype || '').startsWith('video/')).length;
  if (files.length > 1 && vidCount > 0 && (platform === 'instagram' || platform === 'facebook')) {
    await cleanup();
    return res.status(400).json({ error: 'Carousel takes photos only (2-10). Post videos one at a time.' });
  }
  if (platform === 'x' && files.length > 4) {
    await cleanup();
    return res.status(400).json({ error: 'X allows up to 4 photos per post' });
  }
  if (activeJobCount(req.user.id) >= 3) {
    await cleanup();
    return res.status(429).json({ error: '3 publishes already running. Wait for one to finish.' });
  }
  const { data: conn, error } = await supabase.from('platform_connections')
    .select('*').eq('id', connectionId).eq('user_id', req.user.id).eq('platform', platform).maybeSingle();
  if (error || !conn) {
    await cleanup();
    return res.status(409).json({ error: `Connect a ${platform} account first` });
  }
  const id = crypto.randomUUID();
  const job = { id, userId: req.user.id, platform, state: 'queued', progress: 0, message: 'Queued', createdAt: Date.now() };
  jobs.set(id, job);
  res.status(202).json({ job });
  void runPublish(job, conn, { files, thumbFile }, req.body, req.user.id);
});

function splitTags(raw) {
  return String(raw || '').split(/[,\s#]+/).map((t) => t.trim()).filter(Boolean).slice(0, 30);
}

async function runPublish(job, conn, payload, body, userId) {
  const files = payload?.files || (payload?.path ? [payload] : []);
  const file = files[0] || null;
  const allFiles = files;
  const cleanupFiles = async () => {
    for (const f of [...allFiles, ...(payload?.thumbFile ? [payload.thumbFile] : [])]) {
      if (f?.path) await fs.unlink(f.path).catch(() => {});
    }
  };
  try {
    const fallbackText = String(body.text || '').trim();
    // skip_crosspost=1 is sent by "Post to all" so one tap never double-posts
    // via IG->FB and FB->IG mirrors at the same time.
    const allowCrossPost = String(body.skip_crosspost || '') !== '1';
    if (job.platform === 'youtube') {
      const title = String(body.yt_title || body.title || '').trim().slice(0, 100);
      const description = String(body.yt_description ?? fallbackText).slice(0, 5000);
      const privacy = ['public', 'unlisted', 'private'].includes(body.yt_privacy || body.privacy)
        ? (body.yt_privacy || body.privacy) : 'private';
      if (file && String(file.mimetype || '').startsWith('image/')) {
        throw new Error('YouTube only accepts video through its API. Use “Post photo as a video” in the YouTube card and it will be converted for you.');
      }
      if (!file || !String(file.mimetype || '').startsWith('video/')) throw new Error('YouTube needs a video file — use “Post photo as a video” in the YouTube card to convert your photo.');
      if (allFiles.length > 1) throw new Error('YouTube takes 1 video per post');
      if (!title) throw new Error('YouTube needs a title');
      const categoryId = /^\d{1,3}$/.test(String(body.yt_category || '')) ? String(body.yt_category) : null;
      const madeForKids = body.yt_kids === 'yes' ? true : body.yt_kids === 'no' ? false : null;
      const license = ['youtube', 'creativeCommon'].includes(body.yt_license) ? body.yt_license : null;
      const embeddable = body.yt_embed === 'yes' ? true : body.yt_embed === 'no' ? false : null;
      const publicStatsViewable = body.yt_stats === 'yes' ? true : body.yt_stats === 'no' ? false : null;
      job.state = 'uploading'; job.message = 'Uploading to YouTube';
      const token = await validAccessToken(supabase, conn);
      const video = await uploadVideoResumable({
        accessToken: token, file,
        metadata: {
          title, description, tags: splitTags(body.yt_tags ?? body.tags), privacy,
          categoryId, madeForKids, license, embeddable, publicStatsViewable,
          notifySubscribers: body.yt_notify === 'off' ? false : true,
        },
        onProgress: (p) => { job.progress = p; },
      });
      job.url = `https://www.youtube.com/watch?v=${video.id}`;
    } else if (job.platform === 'x') {
      const xText = String(body.x_text ?? fallbackText).trim();
      if (!xText) throw new Error('Write some text for X');
      if (Array.from(xText).length > 280) throw new Error('X allows 280 characters or fewer');
      job.state = 'uploading'; job.progress = 20; job.message = 'Preparing X post';
      const token = await validXAccessToken(supabase, conn);
      let mediaIds = [];
      if (allFiles.length) {
        if (allFiles.length > 4) throw new Error('X allows up to 4 photos per post');
        const hasVideo = allFiles.some((f) => String(f.mimetype || '').startsWith('video/'));
        if (hasVideo && allFiles.length > 1) throw new Error('X video posts take 1 video only (no carousel with video)');
        let i = 0;
        for (const f of allFiles.slice(0, 4)) {
          const isImage = String(f.mimetype || '').startsWith('image/');
          const isVideo = String(f.mimetype || '').startsWith('video/');
          if (!isImage && !isVideo) throw new Error('X supports images, GIFs and video only');
          const id = await uploadXMedia(token, f, (p) => { job.progress = Math.min(90, Math.round(((i + p / 100) / allFiles.length) * 90)); });
          mediaIds.push(id);
          i++;
        }
      }
      job.state = 'publishing'; job.progress = 95; job.message = 'Posting to X';
      let poll = null;
      const rawOpts = String(body.x_poll_options || '').trim();
      if (rawOpts && rawOpts !== '[]') {
        let opts;
        try {
          opts = JSON.parse(rawOpts);
        } catch {
          throw new Error('X poll options were unreadable — turn the poll off or retype the answers');
        }
        if (Array.isArray(opts) && opts.length) {
          const clean = opts.map((o) => String(o || '').trim()).filter(Boolean);
          if (clean.length < 2 || clean.length > 4) throw new Error('X polls need 2 to 4 options');
          if (clean.some((o) => Array.from(o).length > 25)) throw new Error('Each poll option allows 25 characters');
          const mins = Math.min(10080, Math.max(5, Number(body.x_poll_minutes) || 1440));
          poll = { options: clean, duration_minutes: mins };
        }
      }
      const post = await createXPost(token, xText, mediaIds.length ? mediaIds : null, body.x_reply, poll);
      job.url = `https://x.com/i/status/${post.id}`;
    } else {
      const { decryptJson: dec } = await import('./crypto.js');
      const meta = await import('./meta.js');
      const tokens = dec(conn.encrypted_tokens);
      const pageToken = tokens.access_token;
      const pageId = tokens.page_id || conn.platform_account_id;
      const otherConn = async (platform, id) => {
        if (!id) return null;
        const { data } = await supabase.from('platform_connections')
          .select('*').eq('id', id).eq('user_id', userId).eq('platform', platform).maybeSingle();
        return data || null;
      };
      const isCarousel = allFiles.length >= 2 && allFiles.every((f) => String(f.mimetype || '').startsWith('image/'));
      let media = null;
      let mediaList = [];
      let publicUrl = null;
      let publicUrls = [];
      const uploadOnePublic = async (f) => {
        const bytes = await fs.readFile(f.path);
        const rawExt = path.extname(f.originalname || '');
        const safeExt = rawExt.replace(/[^a-z0-9.]/gi, '').slice(0, 8)
          || (String(f.mimetype || '').startsWith('video/') ? '.mp4' : '.jpg');
        const key = `${crypto.randomUUID()}${safeExt}`;
        const { error: upErr } = await supabase.storage.from(BUCKET).upload(key, bytes, { contentType: f.mimetype, upsert: true });
        if (upErr) throw new Error('Media upload failed. Create public bucket "' + BUCKET + '" in Supabase Storage.');
        const { data } = supabase.storage.from(BUCKET).getPublicUrl(key);
        return { url: data.publicUrl, bytes, file: f };
      };
      if (allFiles.length) {
        // Upload every file once so carousel + mirrors share the same URLs.
        // Single-photo/video keeps the old `media`/`publicUrl` behaviour.
        for (const f of allFiles) {
          const up = await uploadOnePublic(f);
          publicUrls.push(up.url);
          mediaList.push({ ...f, bytes: up.bytes, originalname: f.originalname, mimetype: f.mimetype });
        }
        publicUrl = publicUrls[0] || null;
        const firstBytes = mediaList[0]?.bytes;
        if (firstBytes) media = { ...mediaList[0], bytes: firstBytes };
      }
      job.state = 'publishing'; job.progress = 60; job.message = `Publishing to ${job.platform}${isCarousel ? ' (carousel)' : ''}`;
      if (job.platform === 'facebook') {
        const link = String(body.fb_link || '').trim() || null;
        const ageMin = ['13', '18', '21', '25'].includes(String(body.fb_age || '')) ? Number(body.fb_age) : null;
        const ctaType = ['LEARN_MORE', 'SHOP_NOW', 'SIGN_UP', 'MESSAGE_PAGE'].includes(body.fb_cta) ? body.fb_cta : null;
        let out;
        if (isCarousel) {
          out = await meta.publishFacebookCarousel({
            pageId: conn.platform_account_id, pageToken,
            text: String(body.fb_message ?? fallbackText),
            mediaList,
          });
        } else {
          out = await publishFacebook({
            pageId: conn.platform_account_id, pageToken,
            text: String(body.fb_message ?? fallbackText),
            link,
            linkMeta: {
              name: String(body.fb_link_name || '').trim() || null,
              caption: String(body.fb_link_caption || '').trim() || null,
              description: String(body.fb_link_desc || '').trim() || null,
              picture: String(body.fb_link_pic || '').trim() || null,
            },
            targeting: ageMin ? { age_min: ageMin } : null,
            cta: ctaType && link ? { type: ctaType } : null,
            unpublished: String(body.fb_unpublished || '') === '1',
            media,
          });
        }
        job.url = out.url;
        // Optional mirror to Instagram (needs media; text-only cannot mirror).
        // Skipped automatically on "Post to all" (skip_crosspost=1) to avoid doubles.
        if (allowCrossPost && String(body.fb_synd_ig || '') === '1') {
          const igConn = await otherConn('instagram', body.ig_connection_id);
          if (!igConn) {
            job.warning = 'Facebook published, but no Instagram account was chosen for the mirror.';
          } else if (!publicUrl) {
            job.warning = 'Facebook published. Instagram mirror skipped: attach a photo or video to mirror.';
          } else {
            try {
              const igTokens = dec(igConn.encrypted_tokens);
              if (isCarousel) {
                await meta.publishInstagramCarousel({
                  igUserId: igConn.platform_account_id, pageToken: igTokens.access_token,
                  caption: String(body.fb_message ?? fallbackText),
                  mediaUrls: publicUrls,
                });
              } else {
                await meta.publishInstagram({
                  igUserId: igConn.platform_account_id, pageToken: igTokens.access_token,
                  caption: String(body.fb_message ?? fallbackText),
                  mediaUrl: publicUrl, isVideo: !!file?.mimetype?.startsWith('video/'),
                });
              }
              job.warning = 'Also mirrored to Instagram.';
            } catch (e) {
              job.warning = `Facebook published, but the Instagram mirror failed: ${e.message}`;
            }
          }
        }
      } else {
        const igId = conn.platform_account_id;
        // Topics ride along as hashtags; partner mention rides as an @mention.
        let caption = String(body.ig_caption ?? fallbackText);
        const topics = splitTags(body.ig_topics).slice(0, 3).map((t) => `#${t}`);
        if (topics.length) caption = `${caption}\n\n${topics.join(' ')}`.trim();
        const partner = String(body.ig_partner || '').trim().replace(/^@+/, '');
        if (partner) caption = `${caption}\n\nPaid partnership with @${partner}`.trim();
        const collabs = String(body.ig_collabs || '').split(/[, ]+/).map((s) => s.trim().replace(/^@+/, '')).filter(Boolean).slice(0, 3);
        const locationId = String(body.ig_location || '').trim() || null;
        let out;
        if (isCarousel) {
          out = await meta.publishInstagramCarousel({
            igUserId: igId, pageToken, caption, collabs, locationId,
            mediaUrls: publicUrls,
          });
        } else {
          out = await meta.publishInstagram({
            igUserId: igId, pageToken, caption,
            alt: String(body.ig_alt || ''), collabs, locationId,
            mediaUrl: publicUrl, isVideo: !!file?.mimetype?.startsWith('video/'),
          });
        }
        job.url = out.url;
        // Optional auto story: same media re-published as a 24h IG story.
        // Runs after the feed post so one tap covers feed + story.
        if (String(body.ig_post_story || '') === '1' && publicUrl) {
          try {
            await meta.publishInstagramStory({
              igUserId: igId, pageToken,
              mediaUrl: publicUrl, isVideo: !!file?.mimetype?.startsWith('video/'),
            });
            job.warning = [job.warning, 'Also posted as a story.'].filter(Boolean).join(' ');
          } catch (e) {
            job.warning = [job.warning, `Feed published, but story failed: ${e.message}`].filter(Boolean).join(' ');
          }
        }
        // Optional mirror to the linked Facebook Page.
        // Skipped automatically on "Post to all" to avoid double-posting.
        if (allowCrossPost && String(body.ig_share_fb || '') === '1') {
          const fbConn = await otherConn('facebook', body.fb_connection_id);
          if (!fbConn) {
            job.warning = 'Instagram published, but no Facebook Page was chosen for sharing.';
          } else {
            try {
              const fbTokens = dec(fbConn.encrypted_tokens);
              if (isCarousel) {
                await meta.publishFacebookCarousel({
                  pageId: fbConn.platform_account_id, pageToken: fbTokens.access_token,
                  text: caption, mediaList,
                });
              } else {
                await publishFacebook({
                  pageId: fbConn.platform_account_id, pageToken: fbTokens.access_token,
                  text: caption, media,
                });
              }
              job.warning = 'Also shared to the Facebook Page.';
            } catch (e) {
              job.warning = `Instagram published, but Facebook sharing failed: ${e.message}`;
            }
          }
        }
      }
    }
    job.state = 'completed'; job.progress = 100; job.message = 'Published'; job.completedAt = Date.now();
    await supabase.from('post_history').insert({ user_id: userId, platform: job.platform, status: 'published', url: job.url || null, caption: String(body.text || '').slice(0, 500) }).then(() => {});
  } catch (e) {
    job.state = 'failed'; job.message = e.message; job.completedAt = Date.now();
  } finally {
    await cleanupFiles();
  }
}

setInterval(() => {
  const cut = Date.now() - 60 * 60 * 1000;
  for (const [id, j] of jobs) if (j.completedAt && j.completedAt < cut) jobs.delete(id);
}, 10 * 60 * 1000).unref();

// --- Scheduled posts -----------------------------------------------------
// The browser uploads media once, we park it in Storage with the request
// body, and a lightweight worker re-assembles the upload when it is due.
// Everything (tokens, connection) is validated at fire time again, so a
// disconnected or revoked account fails loudly instead of silently.
const SCHED_BATCH = 5;

function validateMedia(platform, files) {
  if (files.length > 10) return 'Carousel allows up to 10 photos';
  for (const f of files) {
    const mt = String(f.mimetype || '');
    if (!mt.startsWith('image/') && !mt.startsWith('video/')) return 'Only image and video files are accepted';
    if (mt.startsWith('image/') && f.size > 10 * 1024 * 1024) return 'Image is larger than 10 MB';
    if (mt.startsWith('video/') && f.size > 512 * 1024 * 1024) return 'Video is larger than 512 MB';
  }
  const imgCount = files.filter((f) => String(f.mimetype || '').startsWith('image/')).length;
  const vidCount = files.filter((f) => String(f.mimetype || '').startsWith('video/')).length;
  if (files.length > 1 && vidCount > 0 && (platform === 'instagram' || platform === 'facebook')) {
    return 'Carousel takes photos only (2-10). Post videos one at a time.';
  }
  if (platform === 'x' && files.length > 4) return 'X allows up to 4 photos per post';
  return null;
}

async function removeStored(paths) {
  for (const p of [].concat(paths || []).filter(Boolean)) {
    await supabase.storage.from(BUCKET).remove([p]).catch(() => {});
  }
}

app.get('/api/schedules', requireUser, jobsLimit, async (req, res) => {
  const { data, error } = await supabase.from('scheduled_posts')
    .select('*').eq('user_id', req.user.id)
    .order('scheduled_at', { ascending: true }).limit(100);
  if (error) return res.status(500).json({ error: 'Could not load scheduled posts' });
  res.json({ schedules: data || [] });
});

app.post('/api/schedule', requireUser, strictBurstLimit, publishLimit, publishUpload, async (req, res) => {
  const platform = String(req.body.platform || '').slice(0, 32);
  const connectionId = String(req.body.connection_id || '').slice(0, 128);
  const files = [...(req.files?.media || []), ...(req.file ? [req.file] : [])];
  const thumbFile = req.files?.thumbnail?.[0] || null;
  const cleanupTmp = async () => {
    for (const f of [...files, ...(thumbFile ? [thumbFile] : [])]) await fs.unlink(f.path).catch(() => {});
  };
  if (!['youtube', 'facebook', 'instagram', 'x'].includes(platform)) {
    await cleanupTmp();
    return res.status(400).json({ error: 'Pick YouTube, Instagram, Facebook or X' });
  }
  const when = Date.parse(req.body.scheduled_at || '');
  if (!Number.isFinite(when)) {
    await cleanupTmp();
    return res.status(400).json({ error: 'Pick a valid date and time' });
  }
  if (when < Date.now() + 60 * 1000) {
    await cleanupTmp();
    return res.status(400).json({ error: 'Schedule at least 1 minute from now' });
  }
  if (when > Date.now() + 365 * 24 * 3600 * 1000) {
    await cleanupTmp();
    return res.status(400).json({ error: 'Schedule within the next year' });
  }
  const mediaErr = validateMedia(platform, files);
  if (mediaErr) {
    await cleanupTmp();
    return res.status(400).json({ error: mediaErr });
  }
  const { data: conn, error: connErr } = await supabase.from('platform_connections')
    .select('*').eq('id', connectionId).eq('user_id', req.user.id).eq('platform', platform).maybeSingle();
  if (connErr || !conn) {
    await cleanupTmp();
    return res.status(409).json({ error: `Connect a ${platform} account first` });
  }
  // Quota: parked media lives in your Storage bucket — cap live schedules.
  const { count: liveCount } = await supabase.from('scheduled_posts')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', req.user.id).in('status', ['scheduled', 'publishing']);
  if ((liveCount || 0) >= 50) {
    await cleanupTmp();
    return res.status(429).json({ error: 'Schedule limit reached (50) — cancel one or let some publish first.' });
  }
  // Park the media so the worker can rebuild the upload later.
  const prefix = `scheduled/${req.user.id}/${crypto.randomUUID()}`;
  const stored = [];
  try {
    for (const f of files) {
      const bytes = await fs.readFile(f.path);
      const ext = (path.extname(f.originalname || '') || (String(f.mimetype).startsWith('video/') ? '.mp4' : '.jpg'))
        .replace(/[^a-z0-9.]/gi, '').slice(0, 8);
      const key = `${prefix}/${crypto.randomUUID()}${ext}`;
      const { error: upErr } = await supabase.storage.from(BUCKET)
        .upload(key, bytes, { contentType: f.mimetype, upsert: false });
      if (upErr) throw new Error('Media upload failed. Create public bucket "' + BUCKET + '" in Supabase Storage.');
      stored.push({ path: key, mimetype: f.mimetype, name: f.originalname || key.split('/').pop() });
    }
    let thumbPath = null;
    if (thumbFile) {
      const bytes = await fs.readFile(thumbFile.path);
      const key = `${prefix}/cover.jpg`;
      const { error: upErr } = await supabase.storage.from(BUCKET)
        .upload(key, bytes, { contentType: thumbFile.mimetype, upsert: false });
      if (upErr) throw new Error('Cover upload failed. Create public bucket "' + BUCKET + '" in Supabase Storage.');
      thumbPath = key;
    }
    const { data, error } = await supabase.from('scheduled_posts').insert({
      user_id: req.user.id,
      platform,
      connection_id: connectionId,
      scheduled_at: new Date(when).toISOString(),
      status: 'scheduled',
      body: req.body || {},
      media: stored,
      thumb_path: thumbPath,
    }).select().single();
    if (error) throw new Error('Could not save the schedule');
    await cleanupTmp();
    res.status(201).json({ schedule: data });
  } catch (e) {
    await removeStored([...stored.map((s) => s.path), thumbPath]);
    await cleanupTmp();
    res.status(500).json({ error: e.message || 'Could not schedule the post' });
  }
});

app.delete('/api/schedules/:id', requireUser, jobsLimit, async (req, res) => {
  const { data: row } = await supabase.from('scheduled_posts')
    .select('*').eq('id', req.params.id).eq('user_id', req.user.id).maybeSingle();
  if (!row) return res.status(404).json({ error: 'Schedule not found' });
  if (['publishing', 'published'].includes(row.status)) {
    return res.status(409).json({ error: 'This post is already publishing or published' });
  }
  // Conditional cancel: if the worker claimed the row a millisecond ago,
  // zero rows update and we report it instead of deleting media under it.
  const { data: cancelled } = await supabase.from('scheduled_posts')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', row.id).eq('status', row.status).select('id');
  if (!cancelled || !cancelled.length) {
    return res.status(409).json({ error: 'This post just started publishing — too late to cancel' });
  }
  await removeStored([...(row.media || []).map((m) => m.path), row.thumb_path]);
  res.json({ ok: true });
});

// Worker: pull due rows, rebuild the upload from Storage, run the real
// publisher. One bad row never blocks the rest.
let scheduleTickRunning = false;
async function runDueSchedules() {
  if (scheduleTickRunning) return;
  scheduleTickRunning = true;
  try {
    const { data: due } = await supabase.from('scheduled_posts')
      .select('*').eq('status', 'scheduled').lte('scheduled_at', new Date().toISOString())
      .order('scheduled_at', { ascending: true }).limit(SCHED_BATCH);
    for (const row of due || []) {
      // Claim the row so a second instance/loop cannot double-post.
      const { data: claimed } = await supabase.from('scheduled_posts')
        .update({ status: 'publishing', updated_at: new Date().toISOString() })
        .eq('id', row.id).eq('status', 'scheduled').select();
      if (!claimed || !claimed.length) continue;
      const { data: conn } = await supabase.from('platform_connections')
        .select('*').eq('id', row.connection_id).eq('user_id', row.user_id).maybeSingle();
      const job = {
        id: crypto.randomUUID(),
        userId: row.user_id,
        platform: row.platform,
        state: 'queued',
        progress: 0,
        message: 'Scheduled publish',
        createdAt: Date.now(),
      };
      jobs.set(job.id, job);
      try {
        if (!conn) throw new Error('The connected account is gone — reconnect it.');
        const localFiles = [];
        for (const m of row.media || []) {
          const { data, error: dlErr } = await supabase.storage.from(BUCKET).download(m.path);
          if (dlErr || !data) throw new Error('Scheduled media is missing');
          const tmp = path.join(os.tmpdir(), `driftpost-sched-${crypto.randomUUID()}${path.extname(m.path) || '.jpg'}`);
          const buf = Buffer.from(await data.arrayBuffer());
          await fs.writeFile(tmp, buf);
          localFiles.push({ path: tmp, mimetype: m.mimetype || 'image/jpeg', originalname: m.name || 'media', size: buf.length });
        }
        let thumbFile = null;
        if (row.thumb_path) {
          const { data } = await supabase.storage.from(BUCKET).download(row.thumb_path);
          if (data) {
            const tmp = path.join(os.tmpdir(), `driftpost-sched-cover-${crypto.randomUUID()}.jpg`);
            const buf = Buffer.from(await data.arrayBuffer());
            await fs.writeFile(tmp, buf);
            thumbFile = { path: tmp, mimetype: 'image/jpeg', originalname: 'cover.jpg', size: buf.length };
          }
        }
        await runPublish(job, conn, { files: localFiles, thumbFile }, row.body || {}, row.user_id);
        const done = jobs.get(job.id) || job;
        await supabase.from('scheduled_posts').update({
          status: done.state === 'completed' ? 'published' : 'failed',
          result_url: done.url || null,
          error: done.state === 'completed' ? null : (done.message || 'Publish failed'),
          updated_at: new Date().toISOString(),
        }).eq('id', row.id);
        if (done.state === 'completed') {
          await removeStored([...(row.media || []).map((m) => m.path), row.thumb_path]);
        }
      } catch (e) {
        await supabase.from('scheduled_posts').update({
          status: 'failed',
          error: e.message || 'Publish failed',
          updated_at: new Date().toISOString(),
        }).eq('id', row.id);
      }
    }
  } catch {
    // Never let a transient Supabase error kill the interval.
  } finally {
    scheduleTickRunning = false;
  }
}
setInterval(runDueSchedules, 60 * 1000).unref();
setTimeout(runDueSchedules, 10 * 1000).unref();

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, _req, res, _next) => {
  console.error(err);
  if (err && err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'CORS policy blocked this request' });
  }
  if (err && (err.code === 'LIMIT_FILE_SIZE' || err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE')) {
    return res.status(400).json({ error: 'File is too large. Images max 10 MB, videos max 512 MB.' });
  }
  if (err && err.message === 'Only image and video files are accepted') {
    return res.status(400).json({ error: err.message });
  }
  res.status(500).json({ error: 'Server error' });
});
app.listen(port, '0.0.0.0', () => console.log(`Driftpost API on :${port}`));
