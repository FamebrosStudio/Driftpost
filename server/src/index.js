import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import { transcribeVideo } from './video-analysis.js';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createClient } from '@supabase/supabase-js';
import { decryptJson, encryptJson, signState, verifyState } from './crypto.js';
import { exchangeGoogleCode, getYouTubeChannel, youtubeAuthorizationUrl } from './google.js';
import { learnedVoice, markLatestUsed, markUsed, recordGeneration } from './captionMemory.js';
import { consentState, forgetUser, hasPersonalisationConsent, recordConsent, POLICY_VERSION, PURPOSES } from './consent.js';
import { setVideoThumbnail, uploadVideoResumable, validAccessToken } from './youtube-upload.js';
import { deleteFacebookPost, discoverInstagramAccount, exchangeMetaCode, getMetaPages, longLivedToken, metaAuthorizationUrl, metaBusinessLoginUrl, publishFacebook, publishInstagram, subscribeInstagramWebhooks } from './meta.js';
import { createPkcePair, exchangeXCode, getXUser, xAuthorizationUrl } from './x.js';
import { createXPost, deleteXPost, uploadXMedia, validXAccessToken } from './x-publish.js';
import { generateCaptions } from './ai.js';
import { uploadMediaFile, downloadMediaFile } from './media-io.js';
import { scheduleIdentity } from './schedule-fields.js';
import { deleteResultsStatus } from './delete-results.js';
import { runAutomationAction } from './automation-events.js';
import { eraseUserMedia } from './storage-cleanup.js';

const required = ['FRONTEND_URL', 'SUPABASE_URL', 'SUPABASE_SECRET_KEY', 'TOKEN_ENCRYPTION_KEY', 'STATE_SIGNING_SECRET'];
const missing = required.filter((n) => !process.env[n]);
if (missing.length) throw new Error(`Missing env: ${missing.join(', ')}`);

const app = express();
const port = Number(process.env.PORT || 10000);
const BUCKET = process.env.MEDIA_BUCKET || 'driftpost-media';
const MAX_UPLOAD_BYTES = 400 * 1024 * 1024;
const AI_ALLOWED_EMAILS = new Set([
  'famebros.studio@gmail.com',
  'kabirsayed.k@gmail.com',
]);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const jobs = new Map();
const scheduleWorkerHealth = {
  running: false,
  lastTickAt: null,
  lastSuccessAt: null,
  lastError: null,
  lastClaimedCount: 0,
};
const allowedOrigins = (process.env.FRONTEND_URL || '').split(',').map((o) => o.trim()).filter(Boolean);
// Hardcoded fallback so the API stays reachable from the deployed frontend
// even if FRONTEND_URL is missing on the server env.
const KNOWN_ORIGINS = ['https://driftpostpage.vercel.app'];
const corsOptions = {
  origin: (origin, callback) => {
    // Allow server-to-server / curl / mobile apps with no Origin header,
    // plus any explicitly configured frontend URL and the known deployed
    // frontend origin (handles the case where FRONTEND_URL env var is
    // empty on the server, which silently breaks all CORS).
    if (!origin || allowedOrigins.includes(origin) || KNOWN_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Driftpost-AI-Grant'],
};

function parseInstagramCollaborators(raw) {
  const entries = String(raw || '').split(/[\s,;]+/).map((name) => name.trim().replace(/^@+/, '')).filter(Boolean);
  const seen = new Set();
  const usernames = [];
  for (const name of entries) {
    if (!/^[A-Za-z0-9._]{1,30}$/.test(name) || name.startsWith('.') || name.endsWith('.') || name.includes('..')) {
      return { usernames: [], error: `“${name}” is not a valid Instagram username. Use letters, numbers, periods or underscores.` };
    }
    const normalized = name.toLowerCase();
    if (!seen.has(normalized)) { seen.add(normalized); usernames.push(name); }
  }
  if (usernames.length > 3) return { usernames: [], error: 'Instagram allows up to 3 collaborators.' };
  return { usernames, error: '' };
}

function instagramCollaboratorError(platform, body = {}) {
  const targetsInstagram = platform === 'instagram'
    || (platform === 'facebook' && String(body.fb_synd_ig || '') === '1');
  return targetsInstagram ? parseInstagramCollaborators(body.ig_collabs).error : '';
}

const upload = multer({
  dest: path.join(os.tmpdir(), 'driftpost-uploads'),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 60, fields: 60, fieldSize: 200 * 1024, fieldNameSize: 100 },
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

// Global abuse guard (generous: normal use never hits it).
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  skip: (req) => req.path === '/health',
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});
app.use(globalLimiter);

// Accept multipart files without base64 expansion. Keep the legacy JSON path
// briefly compatible with already-open frontend tabs during deployments.
function parseStorageUpload(req, res, next) {
  if (req.is('application/json')) {
    return express.json({ limit: '50mb' })(req, res, next);
  }
  return upload.single('file')(req, res, next);
}

app.post('/api/storage/upload', requireUser, parseStorageUpload, async (req, res) => {
  let tempPath = null;
  try {
    let files;
    if (req.file) {
      tempPath = req.file.path;
      files = [{
        name: req.file.originalname,
        mimetype: req.file.mimetype,
        path: req.file.path,
      }];
    } else {
      const raw = req.body?.files;
      if (!Array.isArray(raw) || !raw.length) {
        return res.status(400).json({ error: 'No files to upload' });
      }
      files = raw.map(({ name, mimetype, base64 }) => ({
        name,
        mimetype,
        bytes: base64 ? Buffer.from(String(base64), 'base64') : null,
      }));
    }
    if (!files.length) {
      return res.status(400).json({ error: 'No files to upload' });
    }
    const results = [];
    for (const { name, mimetype, bytes, path: filePath } of files) {
      if (!name || (!bytes && !filePath)) { results.push({ name, error: 'missing name or file data' }); continue; }
      const ext = path.extname(name).replace(/[^a-z0-9.]/gi, '').slice(1, 8)
        || (String(mimetype || '').startsWith('video/') ? 'mp4' : 'jpg');
      const key = `${req.user.id}/${crypto.randomUUID()}.${ext}`;
      const storage = supabase.storage.from(BUCKET);
      const { error: upErr } = filePath
        ? await uploadMediaFile(storage, key, { path: filePath, mimetype }, { upsert: true })
        : await storage.upload(key, bytes, { contentType: mimetype || 'application/octet-stream', upsert: true });
      if (upErr) { results.push({ name, error: upErr.message }); continue; }
      const { data } = supabase.storage.from(BUCKET).getPublicUrl(key);
      results.push({ name, publicUrl: data.publicUrl });
    }
    res.json({ results });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Storage upload failed' });
  } finally {
    if (tempPath) await fs.unlink(tempPath).catch(() => {});
  }
});
// Verified public webhook for Instagram comment and inbound-message events.
app.get('/api/meta/webhook', (req, res) => {
  if (process.env.META_WEBHOOK_VERIFY_TOKEN && req.query['hub.mode'] === 'subscribe' && req.query['hub.verify_token'] === process.env.META_WEBHOOK_VERIFY_TOKEN) return res.status(200).type('text/plain').send(req.query['hub.challenge'] || '');
  res.sendStatus(403);
});
app.post('/api/meta/webhook', express.raw({ type: 'application/json', limit: '1mb' }), async (req, res) => {
  const secret = process.env.META_APP_SECRET;
  const signature = String(req.get('x-hub-signature-256') || '');
  if (!secret || !Buffer.isBuffer(req.body) || !/^sha256=[a-f0-9]{64}$/i.test(signature)) return res.sendStatus(401);
  const expected = Buffer.from(`sha256=${crypto.createHmac('sha256', secret).update(req.body).digest('hex')}`);
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !crypto.timingSafeEqual(expected, received)) return res.sendStatus(401);
  let payload;
  try { payload = JSON.parse(req.body.toString('utf8')); } catch { return res.sendStatus(400); }
  try {
    for (const entry of payload.entry || []) {
      const igId = String(entry.id || '');
      const { data: connections, error: connectionsError } = await supabase.from('platform_connections')
        .select('*').eq('platform', 'instagram').eq('platform_account_id', igId);
      if (connectionsError) throw connectionsError;
      for (const connection of connections || []) {
        const { data: automation, error: automationError } = await supabase.from('instagram_automations')
          .select('rules, enabled').eq('connection_id', connection.id).eq('user_id', connection.user_id).maybeSingle();
        if (automationError) throw automationError;
        if (!automation?.enabled) continue;
        const token = decryptJson(connection.encrypted_tokens)?.access_token;
        if (!token) continue;
        const rules = automation.rules || {};
        for (const change of entry.changes || []) {
          if (change.field !== 'comments') continue;
          const comment = change.value || {};
          const commentId = String(comment.id || '');
          const commentText = String(comment.text || '');
          if (!commentId || String(comment.from?.id || '') === igId) continue;
          const keyword = String(rules.comment_keyword || '').trim().toLowerCase();
          if (!rules.comment_enabled || (keyword && !commentText.toLowerCase().includes(keyword))) continue;
          for (const [field, edge] of [['public_reply', 'replies'], ['private_reply', 'private_replies']]) {
            const message = String(rules[field] || '').trim();
            if (!message) continue;
            await runAutomationAction(supabase, {
              event_id: `comment:${connection.id}:${commentId}:${field}`,
              user_id: connection.user_id,
              connection_id: connection.id,
              event_type: 'comment',
            }, async () => {
              const response = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(commentId)}/${edge}`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: message.slice(0, 1000), access_token: token }),
                signal: AbortSignal.timeout(12000),
              });
              if (!response.ok) throw new Error(`${field} failed: ${(await response.json().catch(() => ({}))).error?.message || response.status}`);
            });
          }
        }
        for (const messaging of entry.messaging || []) {
          const event = messaging.message;
          const senderId = String(messaging.sender?.id || '');
          const messageId = String(event?.mid || '');
          const message = String(event?.text || '').trim();
          if (!messageId || !senderId || !message || event?.is_echo || event?.is_deleted) continue;
          const keyword = String(rules.dm_keyword || '').trim().toLowerCase();
          const replyText = keyword && message.toLowerCase().includes(keyword) ? rules.dm_reply : rules.default_reply;
          if (!replyText) continue;
          await runAutomationAction(supabase, {
            event_id: `message:${connection.id}:${messageId}`,
            user_id: connection.user_id,
            connection_id: connection.id,
            event_type: 'message',
          }, async () => {
            const response = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(igId)}/messages`, {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ recipient: { id: senderId }, message: { text: String(replyText).slice(0, 1000) }, access_token: token }),
              signal: AbortSignal.timeout(12000),
            });
            if (!response.ok) throw new Error(`DM reply failed: ${(await response.json().catch(() => ({}))).error?.message || response.status}`);
          });
        }
      }
    }
    return res.sendStatus(200);
  } catch (error) {
    console.error('[instagram automation] webhook processing failed:', error?.message || error);
    // A non-2xx response asks Meta to retry. Successful individual actions
    // remain deduplicated; only the failed action's claim is released.
    return res.sendStatus(500);
  }
});

// AI vision inputs are browser-resized preview copies only; this is a small
// per-image analysis payload limit, not a posting/media-storage file limit.
const aiImageUpload = multer({
  dest: path.join(os.tmpdir(), 'driftpost-ai-images'),
  limits: { fileSize: MAX_UPLOAD_BYTES, files: 5, fields: 20, fieldSize: 16 * 1024 },
  fileFilter: (_req, file, cb) => cb(null,
    ['image/jpeg', 'image/png'].includes(file.mimetype) || /^video\//.test(file.mimetype)),
});

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

async function requireUser(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'Sign in required' });
  if (token.length > 4096) return res.status(401).json({ error: 'Sign in required' });
  try {
    let data;
    let error;
    for (let attempt = 0; attempt < 3; attempt++) {
      ({ data, error } = await supabase.auth.getUser(token));
      if (!error) break;
      const status = Number(error.status);
      const transient = status >= 500 || status === 0 || /fetch failed|network error/i.test(error.message || '');
      if (!transient || attempt === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
    if (error || !data.user) {
      // Log the REAL reason in Render logs: 'invalid token' (re-login fixes)
      // vs Auth-server outage (waiting fixes). Never sent to the client.
      console.error('[auth] getUser failed:', error?.message || 'no user', '| status:', error?.status ?? '', '| code:', error?.code ?? '');
      const status = Number(error?.status);
      if (status >= 500 || status === 0 || /fetch failed|network error/i.test(error?.message || '')) {
        return res.status(503).json({ error: 'Login service unreachable — try again in a minute.' });
      }
      return res.status(401).json({ error: 'Session expired' });
    }
    req.user = data.user;
    next();
  } catch (e) {
    console.error('[auth] getUser threw:', e?.message || e);
    return res.status(503).json({ error: 'Login service unreachable — try again in a minute.' });
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
    if (arr.length >= max) {
      const retryAfter = Math.max(1, Math.ceil((arr[0] + windowMs - now) / 1000));
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({ error: 'Too many requests. Slow down and retry.' });
    }
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
// Group scheduling makes one authenticated request per account. Keep a
// dedicated bound high enough for a 20–25-account batch without weakening the
// immediate-publish limit.
const scheduleRequestLimit = limit({ windowMs: 60 * 1000, max: 30, ns: 'schedule', key: userKey });
// A Post All fan-out may legitimately submit dozens of independent account
// jobs in one minute. Keep a firm per-IP/user bound without treating one
// reviewed batch like an abusive request burst.
const publishRequestBurstLimit = limit({ windowMs: 60 * 1000, max: 100, ns: 'publish-burst', key: (req) => `ip:${req.ip}` });
const publishQueueLimit = limit({ windowMs: 15 * 60 * 1000, max: 100, ns: 'publish-queue', key: userKey });
const aiLimit = limit({ windowMs: 60 * 60 * 1000, max: 30, ns: 'ai', key: userKey });
const oauthLimit = limit({ windowMs: 60 * 1000, max: 20, ns: 'oauth', key: userKey });
const connectionsLimit = limit({ windowMs: 60 * 1000, max: 60, ns: 'conn', key: userKey });
const musicLimit = limit({ windowMs: 60 * 1000, max: 30, ns: 'music', key: userKey });
const musicPreviewResourceLimit = limit({ windowMs: 60 * 1000, max: 1200, ns: 'music-preview', key: (req) => `ip:${req.ip}` });
// The collaborator picker asks Meta on every settled keystroke, so it needs
// more headroom than the other read endpoints — while still being bounded.
const igLookupLimit = limit({ windowMs: 60 * 1000, max: 120, ns: 'iglookup', key: userKey });
const jobsLimit = limit({ windowMs: 60 * 1000, max: 180, ns: 'jobs', key: userKey });
const callbackLimit = limit({ windowMs: 60 * 1000, max: 30, ns: 'cb', key: (req) => `ip:${req.ip}` });
const aiUnlockLimit = limit({ windowMs: 15 * 60 * 1000, max: 5, ns: 'ai-unlock', key: userKey });

function isAiAllowedUser(user) {
  const email = String(user?.email || '').trim().toLowerCase();
  return !!user?.email_confirmed_at && AI_ALLOWED_EMAILS.has(email);
}

function aiGrantKey() {
  const passphrase = process.env.AI_UNLOCK_PASSPHRASE;
  if (!passphrase) return null;
  return crypto.createHmac('sha256', process.env.STATE_SIGNING_SECRET)
    .update('driftpost:ai-device-grant:v1\0')
    .update(passphrase)
    .digest();
}

function issueAiDeviceGrant(user) {
  const key = aiGrantKey();
  if (!key) return null;
  const payload = Buffer.from(JSON.stringify({
    v: 1,
    sub: user.id,
    exp: Date.now() + 10 * 365 * 24 * 60 * 60 * 1000,
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', key).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function hasValidAiDeviceGrant(req) {
  const key = aiGrantKey();
  const grant = String(req.get('X-Driftpost-AI-Grant') || '');
  if (!key || !grant || grant.length > 2048) return false;
  try {
    const [payload, signature, extra] = grant.split('.');
    if (!payload || !signature || extra) return false;
    const expected = crypto.createHmac('sha256', key).update(payload).digest();
    const received = Buffer.from(signature, 'base64url');
    if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) return false;
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return claims.v === 1 && claims.sub === req.user?.id && Number(claims.exp) > Date.now();
  } catch {
    return false;
  }
}

function requireAiAccess(req, res, next) {
  if (!isAiAllowedUser(req.user)) return res.status(403).json({ error: 'AI access is unavailable for this account.' });
  if (!hasValidAiDeviceGrant(req)) return res.status(403).json({ error: 'AI access must be unlocked on this browser.' });
  next();
}

function activeJobCount(userId) {
  let n = 0;
  for (const j of jobs.values()) {
    if (j.userId === userId && !['completed', 'failed'].includes(j.state)) n++;
  }
  return n;
}

// Bound simultaneous platform work across the whole Render instance. The
// accepted jobs stay pollable in `queued` state while their disk-backed media
// waits, avoiding both per-click serialization and an unbounded RAM spike.
const MAX_ACTIVE_PUBLISHES = 2;
const MAX_PENDING_PUBLISHES = 100;
const MAX_USER_PENDING_PUBLISHES = 50;
let activePublishes = 0;
const publishQueue = [];
function pumpPublishQueue() {
  while (activePublishes < MAX_ACTIVE_PUBLISHES && publishQueue.length) {
    const task = publishQueue.shift();
    activePublishes++;
    if (task.job) {
      task.job.startedAt = Date.now();
      task.job.message = 'Publishing…';
    }
    Promise.resolve().then(task.run).then(task.resolve, task.reject).finally(() => {
      activePublishes--;
      pumpPublishQueue();
    });
  }
}
function queuePublish(run, job = null) {
  return new Promise((resolve, reject) => {
    publishQueue.push({ run, resolve, reject, job });
    pumpPublishQueue();
  });
}

// Watchdog: a provider call that never returns must not lock a queue slot
// forever. Allow long queues, but expire jobs stuck in a provider call.
setInterval(() => {
  const now = Date.now();
  for (const j of jobs.values()) {
    const queuedTooLong = j.state === 'queued' && now - (j.createdAt || now) > 4 * 60 * 60 * 1000;
    const runningTooLong = j.startedAt && !['completed', 'failed'].includes(j.state) && now - j.startedAt > 20 * 60 * 1000;
    if (queuedTooLong || runningTooLong) {
      j.state = 'failed';
      j.message = 'Publish timed out — check the platform, it may still have posted.';
      j.completedAt = now;
    }
  }
}, 60 * 1000).unref();

app.get('/', (_req, res) => res.json({ ok: true, service: 'driftpost-api', platforms: ['youtube', 'instagram', 'facebook', 'x'] }));
app.get('/health', (_req, res) => res.set('Cache-Control', 'no-store').json({
  ok: true,
  revision: (process.env.RAILWAY_GIT_COMMIT_SHA || process.env.RENDER_GIT_COMMIT)?.slice(0, 12) || null,
  uptimeSeconds: Math.floor(process.uptime()),
  scheduler: {
    enabled: true,
    running: scheduleWorkerHealth.running,
    intervalSeconds: 15,
    lastTickAt: scheduleWorkerHealth.lastTickAt,
    lastSuccessAt: scheduleWorkerHealth.lastSuccessAt,
    lastClaimedCount: scheduleWorkerHealth.lastClaimedCount,
    lastError: scheduleWorkerHealth.lastError,
  },
}));

// Epidemic Sound catalog access stays on the server so the provider key is
// never sent to the browser. Configure EPIDEMIC_SOUND_API_KEY in the API host.
const musicPreviewSessions = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [id, stream] of musicPreviewSessions) if (stream.expiresAt <= now) musicPreviewSessions.delete(id);
}, 60_000).unref();

app.get('/api/music/search', requireUser, musicLimit, async (req, res) => {
  const apiKey = String(process.env.EPIDEMIC_SOUND_API_KEY || '').trim();
  if (!apiKey) return res.status(503).json({ error: 'Epidemic Sound is not configured. Add EPIDEMIC_SOUND_API_KEY to the server environment.' });
  const term = String(req.query.term || '').trim().slice(0, 160);
  if (!term) return res.status(400).json({ error: 'Enter a search term.' });
  const limit = Math.max(1, Math.min(60, Number.parseInt(req.query.limit, 10) || 20));
  const offset = Math.max(0, Math.min(10000, Number.parseInt(req.query.offset, 10) || 0));
  const upstream = new URL('https://partner-content-api.epidemicsound.com/v0/tracks/search');
  upstream.searchParams.set('term', term);
  upstream.searchParams.set('limit', String(limit));
  upstream.searchParams.set('offset', String(offset));
  try {
    const response = await fetch(upstream, {
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'x-partner-user-id': crypto.createHash('sha256').update(String(req.user.id)).digest('hex'),
      },
      signal: AbortSignal.timeout(12000),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const status = response.status === 401 ? 502 : response.status === 403 ? 403 : response.status === 429 ? 429 : 502;
      const message = response.status === 401
        ? 'Epidemic Sound rejected the API key. Check the server secret.'
        : response.status === 403
          ? 'This Epidemic Sound API key does not have catalog search access.'
          : response.status === 429
            ? 'Epidemic Sound rate limit reached. Try again shortly.'
            : 'Epidemic Sound catalog search failed. Try again shortly.';
      return res.status(status).json({ error: message });
    }
    res.set('Cache-Control', 'private, max-age=30').json({
      tracks: Array.isArray(payload.tracks) ? payload.tracks : [],
      pagination: payload.pagination || null,
      links: payload.links || null,
      aggregations: payload.aggregations || null,
    });
  } catch (error) {
    const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    return res.status(502).json({ error: timedOut ? 'Epidemic Sound took too long to respond.' : 'Could not reach Epidemic Sound. Try again shortly.' });
  }
});

// Issue short-lived signed upload grants so large media can travel directly
// from the browser to Supabase Storage instead of consuming Railway egress.
// The service key stays on the API; the client receives permission for only
// the individual object paths listed in this request.
app.post('/api/storage/sign-uploads', requireUser, async (req, res) => {
  const files = req.body?.files;
  if (!Array.isArray(files) || files.length < 1 || files.length > 20) {
    return res.status(400).json({ error: 'Choose between 1 and 20 media files.' });
  }
  const results = [];
  for (const item of files) {
    const name = String(item?.name || '').slice(0, 240);
    const mimetype = String(item?.mimetype || '').toLowerCase();
    const size = Number(item?.size);
    if (!name || !/^(image|video)\//.test(mimetype) || !Number.isFinite(size) || size < 1 || size > MAX_UPLOAD_BYTES) {
      return res.status(400).json({ error: 'A media file has an invalid name, type, or size (maximum 400 MB).' });
    }
    const ext = path.extname(name).replace(/[^a-z0-9.]/gi, '').slice(1, 8)
      || (mimetype.startsWith('video/') ? 'mp4' : 'jpg');
    const key = `${req.user.id}/${crypto.randomUUID()}.${ext}`;
    const storage = supabase.storage.from(BUCKET);
    const { data, error } = await storage.createSignedUploadUrl(key, { upsert: false });
    if (error || !data?.token) {
      return res.status(502).json({ error: 'Could not prepare a direct media upload. Please retry.' });
    }
    const { data: publicData } = storage.getPublicUrl(key);
    results.push({ name, path: key, token: data.token, publicUrl: publicData.publicUrl, mimetype, size });
  }
  res.json({ results });
});

// Epidemic previews are HLS manifests. Prefer their simpler /stream endpoint;
// fall back to /hls for partner configurations that still require a short-lived
// CDN cookie. Proxy every playlist/segment so neither API keys nor CDN cookies
// are exposed to the browser.
app.get('/api/music/tracks/:trackId/preview', requireUser, musicLimit, async (req, res) => {
  const apiKey = String(process.env.EPIDEMIC_SOUND_API_KEY || '').trim();
  const trackId = String(req.params.trackId || '');
  if (!apiKey) return res.status(503).json({ error: 'Epidemic Sound is not configured on the server.' });
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(trackId)) return res.status(400).json({ error: 'Invalid music track.' });
  try {
    const upstreamHeaders = { Accept: 'application/json', Authorization: `Bearer ${apiKey}` };
    const fetchPreview = async (kind) => {
      const response = await fetch(`https://partner-content-api.epidemicsound.com/v0/tracks/${encodeURIComponent(trackId)}/${kind}`, {
        headers: upstreamHeaders,
        signal: AbortSignal.timeout(25000),
      });
      return { response, data: await response.json().catch(() => ({})), kind };
    };
    // HLS is the documented preview route and carries the CDN cookie needed
    // for its manifest/segments. Try it first; /stream is a compatible
    // fallback for partner keys that expose the cookie-free manifest only.
    let preview = null;
    for (const kind of ['hls', 'stream']) {
      const attempt = await fetchPreview(kind);
      preview = attempt;
      const usable = attempt.response.ok && !!attempt.data.url
        && (kind !== 'hls' || (!!attempt.data.cookie?.name && !!attempt.data.cookie?.value));
      if (usable) break;
    }
    const { response, data } = preview;
    if (!response.ok || !data.url || (preview.kind === 'hls' && (!data.cookie?.name || !data.cookie?.value))) {
      const status = response.status === 404 ? 404 : response.status === 429 ? 429 : response.status === 403 ? 403 : response.status === 401 ? 502 : 502;
      const error = response.status === 401
        ? 'Epidemic Sound rejected the server API key. Check EPIDEMIC_SOUND_API_KEY.'
        : response.status === 403
          ? 'Epidemic Sound denied preview access to this track.'
          : response.status === 404
            ? 'This track is no longer available in the preview catalog.'
            : response.status === 429
              ? 'Epidemic Sound rate limit reached. Try again shortly.'
              : 'Epidemic Sound could not prepare a preview stream. Try again shortly.';
      return res.status(status).json({ error });
    }
    const streamUrl = new URL(data.url);
    const cookieName = String(data.cookie?.name || '');
    const cookieValue = String(data.cookie?.value || '');
    const cookieDomain = String(data.cookie?.domain || streamUrl.hostname).replace(/^\./, '').toLowerCase();
    const allowedHost = (host) => host === 'epidemicsite.com' || host.endsWith('.epidemicsite.com');
    if (streamUrl.protocol !== 'https:' || !allowedHost(streamUrl.hostname.toLowerCase()) || !(streamUrl.hostname === cookieDomain || streamUrl.hostname.endsWith(`.${cookieDomain}`)) || !allowedHost(cookieDomain) || (cookieName && !/^[A-Za-z0-9_-]{1,100}$/.test(cookieName)) || /[\r\n]/.test(cookieValue)) {
      return res.status(502).json({ error: 'Epidemic Sound returned an invalid preview URL.' });
    }
    const expiresAt = Math.min(Date.parse(data.cookie?.expires || data.expires) || Date.now() + 5 * 60_000, Date.now() + 15 * 60_000);
    if (expiresAt <= Date.now()) return res.status(502).json({ error: 'This track preview expired. Press Preview to try again.' });
    const id = crypto.randomBytes(24).toString('base64url');
    musicPreviewSessions.set(id, {
      host: streamUrl.hostname.toLowerCase(),
      baseUrl: streamUrl.href,
      cookieName: cookieName || null,
      cookieValue: cookieValue || null,
      cookieDomain,
      expiresAt,
    });
    res.set('Cache-Control', 'no-store').json({
      url: `/api/music/preview/${id}/resource?url=${encodeURIComponent(streamUrl.href)}`,
      expiresAt: new Date(expiresAt).toISOString(),
    });
  } catch (error) {
    return res.status(502).json({ error: error?.name === 'TimeoutError' ? 'Epidemic Sound preview took too long to prepare.' : 'Could not reach Epidemic Sound preview.' });
  }
});

app.get('/api/music/preview/:streamId/resource', musicPreviewResourceLimit, async (req, res) => {
  const stream = musicPreviewSessions.get(String(req.params.streamId || ''));
  if (!stream || stream.expiresAt <= Date.now()) {
    musicPreviewSessions.delete(String(req.params.streamId || ''));
    return res.status(410).json({ error: 'This preview expired. Press Preview to start it again.' });
  }
  let target;
  const requestedUrl = String(req.query.url || '');
  if (requestedUrl.length > 2048) return res.status(400).end();
  try { target = new URL(requestedUrl); } catch { return res.status(400).end(); }
  const host = target.hostname.toLowerCase();
  const allowedHost = (value) => value === 'epidemicsite.com' || value.endsWith('.epidemicsite.com');
  if (target.protocol !== 'https:' || !(host === stream.host || host.endsWith(`.${stream.cookieDomain}`)) || !allowedHost(host)) return res.status(400).end();
  try {
    const upstream = await fetch(target, {
      headers: stream.cookieName ? { Cookie: `${stream.cookieName}=${stream.cookieValue}` } : {},
      signal: AbortSignal.timeout(20000),
    });
    if (!upstream.ok || !upstream.body) return res.status(upstream.status || 502).end();
    const contentType = String(upstream.headers.get('content-type') || '');
    if (/mpegurl/i.test(contentType) || target.pathname.endsWith('.m3u8')) {
      const manifest = await upstream.text();
      const route = `/api/music/preview/${req.params.streamId}/resource?url=`;
      const rewrite = (reference) => {
        try {
          const absolute = new URL(reference, target);
          const name = absolute.hostname.toLowerCase();
          if (absolute.protocol !== 'https:' || !(name === stream.host || name.endsWith(`.${stream.cookieDomain}`)) || !allowedHost(name)) return reference;
          return `${route}${encodeURIComponent(absolute.href)}`;
        } catch { return reference; }
      };
      const rewritten = manifest
        .replace(/URI="([^"]+)"/g, (_match, uri) => `URI="${rewrite(uri)}"`)
        .split(/\r?\n/).map((line) => line && !line.startsWith('#') ? rewrite(line) : line).join('\n');
      return res.status(200).type('application/vnd.apple.mpegurl').set('Cache-Control', 'no-store').send(rewritten);
    }
    res.status(200).set({
      'Content-Type': contentType || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (error) {
    return res.status(502).json({ error: error?.name === 'TimeoutError' ? 'Music preview segment timed out.' : 'Could not load music preview.' });
  }
});

app.get('/api/music/tracks/:trackId/audio', requireUser, musicLimit, async (req, res) => {
  const apiKey = String(process.env.EPIDEMIC_SOUND_API_KEY || '').trim();
  const trackId = String(req.params.trackId || '');
  if (!apiKey) return res.status(503).json({ error: 'Epidemic Sound is not configured on the server.' });
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(trackId)) return res.status(400).json({ error: 'Invalid music track.' });
  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${apiKey}`,
    'x-partner-user-id': crypto.createHash('sha256').update(String(req.user.id)).digest('hex'),
  };
  try {
    const grantResponse = await fetch(`https://partner-content-api.epidemicsound.com/v0/tracks/${encodeURIComponent(trackId)}/download?format=mp3&quality=normal`, {
      headers, signal: AbortSignal.timeout(12000),
    });
    const grant = await grantResponse.json().catch(() => ({}));
    if (!grantResponse.ok || !grant.url) {
      const status = grantResponse.status === 403 ? 403 : grantResponse.status === 404 ? 404 : grantResponse.status === 429 ? 429 : grantResponse.status === 401 ? 502 : 502;
      const message = grantResponse.status === 403
        ? 'This track is preview only or your Epidemic Sound plan does not include downloads.'
        : grantResponse.status === 404 ? 'This music track is no longer available.'
          : grantResponse.status === 429 ? 'Epidemic Sound rate limit reached. Try again shortly.'
            : 'Epidemic Sound could not authorize this track download.';
      return res.status(status).json({ error: message });
    }
    const audioUrl = new URL(grant.url);
    if (audioUrl.protocol !== 'https:' || !audioUrl.hostname.endsWith('.epidemicsound.com')) {
      return res.status(502).json({ error: 'Epidemic Sound returned an invalid audio link.' });
    }
    const audio = await fetch(audioUrl, { signal: AbortSignal.timeout(60000) });
    if (!audio.ok || !audio.body) return res.status(502).json({ error: 'Could not retrieve this music track.' });
    res.status(200).set({
      'Content-Type': 'audio/mpeg',
      'Content-Disposition': 'inline; filename="licensed-music.mp3"',
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    Readable.fromWeb(audio.body).pipe(res);
  } catch (error) {
    return res.status(502).json({ error: error?.name === 'TimeoutError' ? 'Epidemic Sound took too long to deliver the track.' : 'Could not retrieve music from Epidemic Sound.' });
  }
});

app.post('/api/ai/unlock', requireUser, aiUnlockLimit, (req, res) => {
  if (!isAiAllowedUser(req.user)) return res.status(403).json({ error: 'AI access is unavailable for this account.' });
  const expected = String(process.env.AI_UNLOCK_PASSPHRASE || '');
  if (!expected) return res.status(503).json({ error: 'AI access is not configured yet.' });
  const candidate = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!candidate || candidate.length > 256) return res.status(403).json({ error: 'Access could not be verified.' });
  const key = process.env.STATE_SIGNING_SECRET;
  const digest = (value) => crypto.createHmac('sha256', key)
    .update('driftpost:ai-passphrase-check:v1\0')
    .update(value)
    .digest();
  if (!crypto.timingSafeEqual(digest(candidate), digest(expected))) {
    return res.status(403).json({ error: 'Access could not be verified.' });
  }
  const grant = issueAiDeviceGrant(req.user);
  if (!grant) return res.status(503).json({ error: 'AI access is not configured yet.' });
  res.json({ grant });
});

app.get('/api/ai/access', requireUser, requireAiAccess, (_req, res) => res.json({ unlocked: true }));

app.get('/api/connections', requireUser, connectionsLimit, burstLimit, async (req, res) => {
  try {
    const { data, error } = await supabase.from('platform_connections')
      .select('id, platform, platform_account_id, account_name, avatar_url, created_at, encrypted_tokens')
      .eq('user_id', req.user.id);
    if (error) return res.status(500).json({ error: 'Unable to load accounts' });
    // Instagram is connected through a Facebook Page in Meta OAuth. Use that
    // actual relationship for brand grouping instead of guessing from names
    // (which often differ, e.g. an IG handle vs the Page's display name).
    // Never send encrypted token material to the browser.
    const connections = (data || []).map(({ encrypted_tokens, ...connection }) => {
      if (connection.platform !== 'instagram') return connection;
      try {
        const pageId = decryptJson(encrypted_tokens)?.page_id;
        return pageId ? { ...connection, linked_page_id: String(pageId) } : connection;
      } catch { return connection; }
    });
    res.json({ connections });
  } catch {
    res.status(500).json({ error: 'Unable to load accounts' });
  }
});

app.get('/api/instagram/collaborators', requireUser, connectionsLimit, igLookupLimit, async (req, res) => {
  // Accepts one handle or a whole list, so the composer can show the resolved
  // account ID for every collaborator it is about to tag.
  const handles = [...new Set(String(req.query.q || '')
    .split(/[\s,;]+/)
    .map((name) => name.trim().replace(/^@+/, ''))
    .filter(Boolean))].slice(0, 5);
  if (!handles.length) return res.json({ accounts: [], results: [] });
  const { data, error } = await supabase.from('platform_connections')
    .select('id, platform_account_id, encrypted_tokens')
    .eq('user_id', req.user.id)
    .eq('platform', 'instagram');
  if (error) return res.status(500).json({ error: 'Could not load your Instagram accounts' });
  const list = data || [];
  if (!list.length) return res.json({ accounts: [], results: handles.map((username) => ({ username, account: null, reason: 'no-connection' })), reason: 'no-connection' });
  // Business Discovery has to run on a connected account. Try the one the
  // post will publish from first, then the rest as a fallback.
  const wanted = String(req.query.connection_id || '');
  const ordered = [wanted, ...list.map((c) => c.id)]
    .filter(Boolean)
    .map((id) => list.find((c) => c.id === id))
    .filter(Boolean);
  const tokens = [];
  for (const connection of ordered) {
    let pageToken = '';
    try { pageToken = decryptJson(connection.encrypted_tokens)?.access_token || ''; } catch { continue; }
    if (pageToken) tokens.push({ connection, pageToken });
  }
  const results = [];
  let usedConnection = '';
  let lastReason = 'not-found';
  for (const username of handles) {
    let account = null;
    let reason = 'not-found';
    for (const { connection, pageToken } of tokens) {
      const found = await discoverInstagramAccount({ igUserId: connection.platform_account_id, pageToken, username });
      if (found.ok) { account = found.account; usedConnection = usedConnection || connection.id; break; }
      reason = found.reason;
      // A token that cannot read other accounts will not do better on the next
      // account — stop instead of burning one Graph call per connection.
      if (reason === 'permission') break;
    }
    if (!account) lastReason = reason;
    results.push({ username, account, reason: account ? 'ok' : reason });
  }
  // A miss is a normal answer (unknown, personal or age-gated handle), not an
  // error: the composer keeps the typed username either way.
  const accounts = results.filter((r) => r.account).map((r) => r.account);
  res.json({
    accounts,
    results,
    ...(usedConnection ? { connection_id: usedConnection } : {}),
    ...(accounts.length ? {} : { reason: lastReason }),
  });
});

app.get('/api/automations/instagram', requireUser, connectionsLimit, burstLimit, async (req, res) => {
  const { data: connections, error: connectionError } = await supabase.from('platform_connections').select('id, account_name').eq('user_id', req.user.id).eq('platform', 'instagram');
  if (connectionError) return res.status(500).json({ error: 'Could not load Instagram accounts' });
  const { data: saved, error } = await supabase.from('instagram_automations').select('connection_id, enabled, rules').eq('user_id', req.user.id);
  if (error) return res.status(500).json({ error: 'Automation storage is not ready. Apply the latest Supabase migrations.' });
  const byId = new Map((saved || []).map((row) => [row.connection_id, row]));
  res.json({ accounts: (connections || []).map((account) => ({ id: account.id, name: account.account_name, enabled: !!byId.get(account.id)?.enabled, rules: byId.get(account.id)?.rules || {} })), webhook_ready: !!(process.env.META_WEBHOOK_VERIFY_TOKEN && process.env.META_APP_SECRET) });
});

app.put('/api/automations/instagram/:connectionId', requireUser, strictBurstLimit, async (req, res) => {
  const { data: connection } = await supabase.from('platform_connections')
    .select('id, platform_account_id, encrypted_tokens')
    .eq('id', req.params.connectionId).eq('user_id', req.user.id).eq('platform', 'instagram').maybeSingle();
  if (!connection) return res.status(404).json({ error: 'Instagram account not found' });
  const input = req.body || {};
  const rules = {
    comment_enabled: input.comment_enabled === true,
    comment_keyword: String(input.comment_keyword || '').trim().slice(0, 80),
    public_reply: String(input.public_reply || '').trim().slice(0, 1000),
    private_reply: String(input.private_reply || '').trim().slice(0, 1000),
    dm_keyword: String(input.dm_keyword || '').trim().slice(0, 80),
    dm_reply: String(input.dm_reply || '').trim().slice(0, 1000),
    default_reply: String(input.default_reply || '').trim().slice(0, 1000),
  };
  const enabled = input.enabled === true;
  if (enabled && !rules.comment_enabled && !rules.dm_keyword && !rules.default_reply) return res.status(400).json({ error: 'Add a comment or incoming-message rule before enabling automation.' });
  if (rules.comment_enabled && !rules.public_reply && !rules.private_reply) return res.status(400).json({ error: 'Add a public reply or private message for comment automation.' });
  if (rules.dm_keyword && !rules.dm_reply) return res.status(400).json({ error: 'Add a reply for the incoming-message keyword.' });
  if (enabled) {
    if (!process.env.META_WEBHOOK_VERIFY_TOKEN || !process.env.META_APP_SECRET) {
      return res.status(503).json({ error: 'Meta webhook setup is incomplete. Configure META_WEBHOOK_VERIFY_TOKEN and META_APP_SECRET on the API first.' });
    }
    try {
      const tokens = decryptJson(connection.encrypted_tokens);
      await subscribeInstagramWebhooks({ igUserId: connection.platform_account_id, accessToken: tokens.access_token });
    } catch (error) {
      return res.status(502).json({ error: `Could not subscribe this Instagram account to Meta webhooks: ${error.message || 'check account permissions and reconnect it'}` });
    }
  }
  const { error } = await supabase.from('instagram_automations').upsert({ connection_id: connection.id, user_id: req.user.id, enabled, rules, updated_at: new Date().toISOString() }, { onConflict: 'connection_id' });
  if (error) return res.status(500).json({ error: 'Could not save Instagram automation. Apply the latest Supabase migrations.' });
  res.json({ ok: true, enabled, rules });
});

// Read account-level metrics from the official platform APIs using the
// already-connected account token. A platform may reject metrics if the
// account type or granted scopes do not allow them; keep that error local to
// the account instead of failing the complete dashboard response.
app.get('/api/analytics/accounts', requireUser, connectionsLimit, burstLimit, async (req, res) => {
  try {
    const { data: connections, error } = await supabase.from('platform_connections')
      .select('id, platform, platform_account_id, account_name, encrypted_tokens')
      .eq('user_id', req.user.id);
    if (error) return res.status(500).json({ error: 'Could not load connected accounts' });
    const results = await Promise.all((connections || []).map(async (connection) => {
      try {
        const tokens = decryptJson(connection.encrypted_tokens);
        const accessToken = tokens.access_token;
        let metrics = {};
        if (connection.platform === 'youtube') {
          const params = new URLSearchParams({ part: 'statistics', id: connection.platform_account_id });
          const response = await fetch(`https://www.googleapis.com/youtube/v3/channels?${params}`, {
            headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15000),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(payload.error?.message || 'YouTube could not return channel analytics');
          const stats = payload.items?.[0]?.statistics || {};
          metrics = {
            subscribers: stats.hiddenSubscriberCount ? null : (stats.subscriberCount == null ? null : Number(stats.subscriberCount)),
            views: Number(stats.viewCount || 0), posts: Number(stats.videoCount || 0),
          };
        } else if (connection.platform === 'instagram') {
          const params = new URLSearchParams({ fields: 'username,followers_count,follows_count,media_count', access_token: accessToken });
          const response = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(connection.platform_account_id)}?${params}`, { signal: AbortSignal.timeout(15000) });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(payload.error?.message || 'Instagram could not return account analytics');
          metrics = { followers: Number(payload.followers_count || 0), following: Number(payload.follows_count || 0), posts: Number(payload.media_count || 0) };
        } else if (connection.platform === 'facebook') {
          const params = new URLSearchParams({ fields: 'followers_count,fan_count', access_token: accessToken });
          const response = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(connection.platform_account_id)}?${params}`, { signal: AbortSignal.timeout(15000) });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(payload.error?.message || 'Facebook could not return Page analytics');
          metrics = { followers: Number(payload.followers_count ?? payload.fan_count ?? 0) };
        } else if (connection.platform === 'x') {
          const params = new URLSearchParams({ 'user.fields': 'public_metrics' });
          const response = await fetch(`https://api.x.com/2/users/${encodeURIComponent(connection.platform_account_id)}?${params}`, {
            headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(15000),
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(payload.detail || payload.errors?.[0]?.message || 'X could not return account analytics');
          const stats = payload.data?.public_metrics || {};
          metrics = { followers: Number(stats.followers_count || 0), following: Number(stats.following_count || 0), posts: Number(stats.tweet_count || 0) };
        }
        return { id: connection.id, platform: connection.platform, name: connection.account_name, metrics };
      } catch (e) {
        return { id: connection.id, platform: connection.platform, name: connection.account_name, metrics: null, error: e.message || 'Metrics unavailable' };
      }
    }));
    res.json({ accounts: results, updated_at: new Date().toISOString() });
  } catch {
    res.status(500).json({ error: 'Could not load account analytics' });
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

// Full account erasure: remove owned storage objects and records before deleting
// the login. Storage objects are public for platform publishing, so leaving
// them behind after account deletion would leave the user's media accessible.
app.delete('/api/account', requireUser, limit({ windowMs: 60 * 1000, max: 5, key: userKey }), async (req, res) => {
  try {
    const uid = req.user.id;
    await eraseUserMedia(supabase.storage.from(BUCKET), uid);
    await forgetUser(supabase, uid);
    const c = await supabase.from('platform_connections').delete().eq('user_id', uid);
    if (c.error) throw c.error;
    const h = await supabase.from('post_history').delete().eq('user_id', uid);
    if (h.error) throw h.error;
    // Generated captions and the consent trail are personal data too; both are
    // checked before we erase the login so a database error cannot be hidden.
    for (const [id, j] of jobs) if (j.userId === uid) jobs.delete(id);
    const { error: uErr } = await supabase.auth.admin.deleteUser(uid);
    if (uErr) throw uErr;
    res.json({ deleted: true });
  } catch {
    res.status(500).json({ error: 'Deletion failed. Email famebros.studio@gmail.com and we will finish it within 7 days.' });
  }
});

// --- AI captions (Grok + local brand memory, server-side key) ---
function friendlySpeechWarning(error) {
  const detail = String(error?.message || error || '').toLowerCase();
  if (/badformat|failed to decode audio|unsupported.*audio|audio.*format/.test(detail)) {
    return 'Speech analysis could not read this video’s audio format. Your captions were still generated from the prompt and video frames. For spoken words to be included, export the video with AAC audio in an MP4 file.';
  }
  if (/timeout|timed out|aborterror/.test(detail)) {
    return 'Speech analysis took too long, but your captions were still generated. Retry later if you want the spoken audio included.';
  }
  return 'Speech analysis was unavailable, but your captions were still generated from the prompt and video frames. Try again later if you want the spoken audio included.';
}

app.post('/api/ai/captions', requireUser, requireAiAccess, aiLimit, (req, res, next) => {
  if (req.is('multipart/form-data')) return aiImageUpload.fields([
    { name: 'images', maxCount: 4 }, { name: 'video', maxCount: 1 },
  ])(req, res, next);
  next();
}, async (req, res) => {
  const uploads = [...(req.files?.images || []), ...(req.files?.video || [])];
  try {
    const imageFiles = req.files?.images || [];
    const videoFile = req.files?.video?.[0] || null;
    if (imageFiles.some((file) => file.size > 2 * 1024 * 1024)) {
      return res.status(413).json({ error: 'Each image for caption analysis must be 2 MB or smaller.' });
    }
    let transcript = '';
    let transcriptLanguage = null;
    let videoAnalysisWarning = '';
    if (videoFile) {
      try {
        const speech = await transcribeVideo(videoFile.path, videoFile.originalname, videoFile.mimetype);
        transcript = speech.text;
        transcriptLanguage = speech.language;
      } catch (error) {
        videoAnalysisWarning = friendlySpeechWarning(error);
        console.warn('[ai] video transcription failed:', String(error?.message || error).slice(0, 500));
      }
    }
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
      transcript,
      images: await Promise.all(imageFiles.map(async (file) => ({
        name: file.originalname,
        mimetype: file.mimetype,
        base64: (await fs.readFile(file.path)).toString('base64'),
      }))),
    });
    // Persist before returning so an immediate approve/publish action cannot
    // race the insert and lose its feedback. This is still opt-in and best-effort.
    let captionMemoryStatus = 'disabled';
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
      const optedIn = await hasPersonalisationConsent(supabase, req.user.id);
      if (optedIn) captionMemoryStatus = 'unavailable';
      const saved = await recordGeneration(supabase, {
        userId: req.user.id,
        brandLabel,
        brand: brandRecord,
        brief: req.body?.summary,
        settings: { tone: req.body?.tone, emoji: req.body?.emoji, length: req.body?.length },
      }, entries);
      if (optedIn) captionMemoryStatus = saved.length === entries.length && entries.length > 0 ? 'saved' : 'unavailable';
    } catch {
      // Memory is best-effort; generation can continue if storage is unavailable.
    }
    res.json({ ...out, captionMemoryStatus, transcriptLanguage, videoAnalysisWarning });
  } catch (e) {
    const msg = String(e.message || 'AI failed');
    const isBrandMismatch = /^This prompt names .+, but the selected account is .+\./i.test(msg);
    const isBriefValidation = /^Write a short summary first/i.test(msg);
    const validation = /^caption quality check:\s*(instagram|facebook|youtube|x) (has no useful caption body|mentions another brand)/i.exec(msg);
    const code = /credits/i.test(msg) ? 402
      : /configured/i.test(msg) ? 503
        : isBrandMismatch ? 409
          : isBriefValidation ? 400
            : validation ? 422
            : /transcription|video audio/i.test(msg) ? 502 : 500;
    // Keep server/provider failures diagnosable without logging prompts, media,
    // captions, or account tokens. The reference is safe to show the user.
    const errorId = code >= 500 ? crypto.randomUUID().slice(0, 8) : null;
    if (errorId) {
      const category = validation ? `caption_validation_${validation[1].toLowerCase()}_${/mentions another brand/i.test(validation[2]) ? 'brand' : 'empty'}`
        : /xai|provider|model/i.test(msg) ? 'provider'
        : /json|unreadable|empty answer/i.test(msg) ? 'response_format'
          : /caption quality check/i.test(msg) ? 'caption_validation' : 'internal';
      console.error(`[ai] caption generation failed ref=${errorId} status=${code} category=${category}`);
    }
    res.status(code).json({ error: msg, ...(errorId ? { errorId } : {}) });
  } finally {
    await Promise.all(uploads.map((file) => fs.unlink(file.path).catch(() => {})));
  }
});

app.delete('/api/posts', requireUser, strictBurstLimit, async (req, res) => {
  const requested = Array.isArray(req.body?.posts) ? req.body.posts.slice(0, 10) : [];
  if (!requested.length) return res.status(400).json({ error: 'No published posts selected' });
  const results = [];
  for (const item of requested) {
    const platform = String(item?.platform || '');
    const postId = String(item?.postId || '');
    const connectionId = String(item?.connectionId || '');
    if (!['facebook', 'youtube', 'x'].includes(platform)) {
      results.push({ platform, postId, ok: false, error: platform === 'instagram'
        ? 'Instagram does not allow deleting published media through its official API. Delete it in Instagram.'
        : 'This platform cannot be deleted from Driftpost.' });
      continue;
    }
    if (!postId || postId.length > 160 || !/^[A-Za-z0-9_.:-]+$/.test(postId) || !connectionId) {
      results.push({ platform, postId, ok: false, error: 'This history entry is missing its platform post ID or account link.' });
      continue;
    }
    try {
      const { data: connection, error } = await supabase.from('platform_connections')
        .select('*').eq('id', connectionId).eq('user_id', req.user.id).eq('platform', platform).maybeSingle();
      if (error || !connection) throw new Error('Reconnect the account used for this post before deleting it.');
      if (platform === 'facebook') {
        const tokens = decryptJson(connection.encrypted_tokens);
        await deleteFacebookPost({ postId, pageToken: tokens.access_token });
      } else if (platform === 'youtube') {
        const accessToken = await validAccessToken(supabase, connection);
        const response = await fetch(`https://www.googleapis.com/youtube/v3/videos?id=${encodeURIComponent(postId)}`, {
          method: 'DELETE', headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (response.status === 204) {
          results.push({ platform, postId, ok: true });
          continue;
        }
        const body = await response.json().catch(() => ({}));
        if (response.status === 403) throw new Error('YouTube refused deletion. Reconnect YouTube to grant the new delete permission, then try again.');
        throw new Error(body.error?.message || 'YouTube could not delete this video.');
      } else {
        const accessToken = await validXAccessToken(supabase, connection);
        await deleteXPost(accessToken, postId);
      }
      results.push({ platform, postId, ok: true });
    } catch (error) {
      results.push({ platform, postId, ok: false, error: error.message || 'Delete failed' });
    }
  }
  const failed = results.filter((result) => !result.ok);
  // Content-free audit trail for provider failures; never log captions, IDs,
  // or account tokens.
  console.info('[post-delete] finished', results.map(({ platform: name, ok }) => `${name}:${ok ? 'deleted' : 'failed'}`).join(','));
  // Provider-level delete denials are valid per-item outcomes, not a server
  // outage. Always use 207 when any target failed so the client receives the
  // detailed results instead of treating 502 as a transient Railway error.
  res.status(deleteResultsStatus(results))
    .json({ results, deleted: results.length - failed.length });
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
app.post('/api/ai/feedback', requireUser, requireAiAccess, burstLimit, async (req, res) => {
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
        caption: req.body?.caption,
        brand: (await import('./brand-memory/index.js')).resolveBrand(String(req.body?.brand || ''), 20)?.brand || null,
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
app.post('/api/ai/learn', requireUser, requireAiAccess, burstLimit, async (req, res) => {
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
      const { error: pageSaveError } = await supabase.from('platform_connections').upsert({
        user_id: state.userId, platform: 'facebook', platform_account_id: page.id,
        account_name: page.name, avatar_url: null,
        encrypted_tokens: encryptJson({ access_token: page.access_token }),
        token_expires_at: null, updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id,platform,platform_account_id' });
      if (pageSaveError) {
        console.error('[meta] Could not save Facebook Page connection:', page.name, pageSaveError.message);
        throw new Error(`Meta found ${page.name || 'a Facebook Page'} but Driftpost could not save it. Try connecting again.`);
      }
      const ig = page.instagram_business_account;
      if (ig?.id) {
        igCount++;
        const { error: igSaveError } = await supabase.from('platform_connections').upsert({
          user_id: state.userId, platform: 'instagram', platform_account_id: ig.id,
          account_name: ig.username ? `@${ig.username}` : page.name, avatar_url: null,
          encrypted_tokens: encryptJson({ access_token: page.access_token, page_id: page.id }),
          token_expires_at: null, updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,platform,platform_account_id' });
        if (igSaveError) {
          console.error('[meta] Could not save Instagram connection:', ig.username || ig.id, igSaveError.message);
          throw new Error(`Meta found ${ig.username ? `@${ig.username}` : 'an Instagram account'} on ${page.name || 'a Page'}, but Driftpost could not save it. Try connecting again.`);
        }
      }
    }
    const igNames = pages.slice(0, 200).map((page) => page.instagram_business_account?.username)
      .filter(Boolean).map((username) => `@${username}`);
    const shownIgNames = igNames.slice(0, 6);
    const igLabel = shownIgNames.length
      ? ` (${shownIgNames.join(', ')}${igNames.length > shownIgNames.length ? `, +${igNames.length - shownIgNames.length} more` : ''})`
      : '';
    const pageNames = pages.slice(0, 6).map((page) => page.name).filter(Boolean);
    const pageLabel = pageNames.length
      ? `; Pages: ${pageNames.join(', ')}${pages.length > pageNames.length ? ', …' : ''}`
      : '';
    back.searchParams.set('connected', 'meta');
    back.searchParams.set('connected_details', `${pages.length} Page${pages.length === 1 ? '' : 's'}, ${igCount} Instagram account${igCount === 1 ? '' : 's'} found${pageLabel}${igLabel}`);
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
// Accepts up to 20 `media` files (Facebook carousel); platform caps are validated below.
const publishUpload = upload.fields([
  { name: 'media', maxCount: 20 },
  { name: 'instagram_media', maxCount: 20 },
  { name: 'facebook_media', maxCount: 20 },
  { name: 'thumbnail', maxCount: 1 },
  { name: 'cover_instagram', maxCount: 1 },
  { name: 'cover_facebook', maxCount: 1 },
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
app.post('/api/publish', requireUser, publishRequestBurstLimit, publishQueueLimit, publishUpload, async (req, res) => {
  const platform = String(req.body.platform || '').slice(0, 32);
  const connectionId = String(req.body.connection_id || '').slice(0, 128);
  const files = [...(req.files?.media || []), ...(req.file ? [req.file] : [])];
  const instagramFiles = req.files?.instagram_media || [];
  const facebookFiles = req.files?.facebook_media || [];
  const thumbFile = req.files?.thumbnail?.[0] || null;
  const coverFiles = { instagram: req.files?.cover_instagram?.[0] || null, facebook: req.files?.cover_facebook?.[0] || null };
  const cleanup = async () => {
    for (const f of [...files, ...instagramFiles, ...facebookFiles, ...(thumbFile ? [thumbFile] : []), ...Object.values(coverFiles).filter(Boolean)]) await fs.unlink(f.path).catch(() => {});
  };
  if (!['youtube', 'facebook', 'instagram', 'x'].includes(platform)) {
    await cleanup();
    return res.status(400).json({ error: 'Pick YouTube, Instagram, Facebook or X' });
  }
  // Hosted media references are accepted only for Meta publishing and only
  // for random object keys inside the authenticated user's storage folder.
  // Derive public URLs on the server; never let clients make Meta fetch an
  // arbitrary URL on their behalf.
  if (req.body.hasPreuploadedMedia === '1') {
    if (!['instagram', 'facebook'].includes(platform) || files.length) {
      await cleanup();
      return res.status(400).json({ error: 'Stored media can only be used directly for Instagram or Facebook posts.' });
    }
    let count = 0;
    for (let index = 0; index < 20; index++) {
      const objectPath = String(req.body[`mediaPath${index}`] || '');
      if (!objectPath) break;
      const [owner, filename, ...extra] = objectPath.split('/');
      const mimetype = String(req.body[`mediaType${index}`] || '').toLowerCase();
      const name = String(req.body[`mediaName${index}`] || `media_${index}`).slice(0, 240);
      if (owner !== req.user.id || extra.length || !/^[0-9a-f-]{36}\.[a-z0-9]{1,8}$/i.test(filename || '')
        || !/^(image|video)\/[a-z0-9.+-]+$/.test(mimetype)) {
        await cleanup();
        return res.status(400).json({ error: 'Stored media reference is invalid. Re-upload the media and try again.' });
      }
      const { data } = supabase.storage.from(BUCKET).getPublicUrl(objectPath);
      req.body[`mediaUrl${index}`] = data.publicUrl;
      req.body[`mediaName${index}`] = name;
      req.body[`mediaType${index}`] = mimetype;
      count++;
    }
    if (!count) {
      await cleanup();
      return res.status(400).json({ error: 'No uploaded media was found. Re-upload the media and try again.' });
    }
    if (platform === 'instagram' && count > 10) {
      await cleanup();
      return res.status(400).json({ error: 'Instagram publishing supports up to 10 carousel slides.' });
    }
    if (platform === 'facebook' && count > 20) {
      await cleanup();
      return res.status(400).json({ error: 'Facebook allows up to 20 photos per carousel.' });
    }
    if (count > 1 && req.body.mediaType0?.startsWith('video/')) {
      await cleanup();
      return res.status(400).json({ error: 'Carousel takes photos only (2-10). Post videos one at a time.' });
    }
  }
  const collaboratorError = instagramCollaboratorError(platform, req.body);
  if (collaboratorError) {
    await cleanup();
    return res.status(400).json({ error: collaboratorError });
  }
  for (const cover of Object.values(coverFiles).filter(Boolean)) {
    if (cover.mimetype !== 'image/jpeg' || cover.size > 5 * 1024 * 1024 || !(await magicIsImage(cover.path))) {
      await cleanup();
      return res.status(400).json({ error: 'Covers must be valid JPEG images no larger than 5 MB.' });
    }
  }
  if (platform === 'instagram' && files.length > 10) {
    await cleanup();
    return res.status(400).json({ error: 'Instagram publishing supports up to 10 carousel slides.' });
  }
  if (platform === 'facebook' && files.length > 20) {
    await cleanup();
    return res.status(400).json({ error: 'Facebook allows up to 20 photos per carousel.' });
  }
  if (platform === 'x' && files.length > 4) {
    await cleanup();
    return res.status(400).json({ error: 'X allows up to 4 media attachments.' });
  }
  if (platform === 'youtube' && files.length > 1) {
    await cleanup();
    return res.status(400).json({ error: 'YouTube accepts one video per post.' });
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
    const cap = isVid ? MAX_UPLOAD_BYTES : platform === 'instagram' ? 8 * 1024 * 1024 : 10 * 1024 * 1024;
    if (f.size > cap) {
      await cleanup();
      return res.status(400).json({ error: isVid ? 'Video is larger than 400 MB' : platform === 'instagram' ? 'Instagram photos must be 8 MB or smaller' : 'Image is larger than 10 MB' });
    }
    if (platform === 'instagram' && isImg && mt !== 'image/jpeg') {
      await cleanup();
      return res.status(400).json({ error: 'Instagram photos must be JPEG. Reopen Stage 3 to prepare this photo.' });
    }
  }
  const igVariantError = validateMedia('instagram', instagramFiles);
  if (igVariantError || instagramFiles.some((f) => f.mimetype !== 'image/jpeg' || f.size > 8 * 1024 * 1024)) {
    await cleanup();
    return res.status(400).json({ error: igVariantError || 'Instagram photos must be JPEG and no larger than 8 MB. Reopen Stage 3 to prepare them.' });
  }
  for (const f of instagramFiles) {
    if (!(await magicIsImage(f.path))) {
      await cleanup();
      return res.status(400).json({ error: 'An Instagram photo could not be verified as an image. Reopen Stage 3 and try again.' });
    }
  }
  const fbVariantError = validateMedia('facebook', facebookFiles);
  if (fbVariantError || facebookFiles.some((f) => f.mimetype !== 'image/jpeg' || f.size > 10 * 1024 * 1024)) {
    await cleanup();
    return res.status(400).json({ error: fbVariantError || 'Facebook photos must be valid JPEGs no larger than 10 MB.' });
  }
  for (const f of facebookFiles) {
    if (!(await magicIsImage(f.path))) {
      await cleanup();
      return res.status(400).json({ error: 'A Facebook photo could not be verified as an image.' });
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
  if (activeJobCount(req.user.id) >= MAX_USER_PENDING_PUBLISHES) {
    await cleanup();
    return res.status(429).json({ error: 'You have 50 posts queued or publishing. Wait for some to finish before starting another batch.' });
  }
  if (activePublishes + publishQueue.length >= MAX_PENDING_PUBLISHES) {
    await cleanup();
    return res.status(503).json({ error: 'The publish queue is full right now. Wait a few minutes and retry.' });
  }
  const { data: conn, error } = await supabase.from('platform_connections')
    .select('*').eq('id', connectionId).eq('user_id', req.user.id).eq('platform', platform).maybeSingle();
  if (error || !conn) {
    await cleanup();
    return res.status(409).json({ error: `Connect a ${platform} account first` });
  }
  const id = crypto.randomUUID();
  const job = { id, userId: req.user.id, platform, connectionId: conn.id, publishedPosts: [], state: 'queued', progress: 0, message: 'Queued', createdAt: Date.now() };
  jobs.set(id, job);
  res.status(202).json({ job });
  void queuePublish(() => runPublish(job, conn, { files, instagramFiles, facebookFiles, thumbFile, coverFiles }, req.body, req.user.id), job).catch((error) => {
    console.error('[publish] unexpected job failure', job.id, error);
    if (job.state !== 'completed') {
      job.state = 'failed'; job.message = error.message || 'Publishing failed'; job.completedAt = Date.now();
    }
  });
});

// Campaign publishing keeps one reviewed caption while allowing every
// destination account to carry its own media. Each target becomes its own
// ordinary publish job, run sequentially to avoid multiplying upload memory.
const campaignUpload = upload.any();
function readCampaignTargets(raw) {
  let targets;
  try { targets = JSON.parse(String(raw || '')); } catch { return null; }
  if (!Array.isArray(targets) || targets.length < 1 || targets.length > 25) return null;
  const ids = new Set();
  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    if (!target || !['youtube', 'facebook', 'instagram', 'x'].includes(target.platform)
      || typeof target.connection_id !== 'string' || !target.connection_id
      || target.media_field !== `media_${i}` || ids.has(target.connection_id)) return null;
    ids.add(target.connection_id);
  }
  return targets;
}
function campaignBody(caption, title, name, campaignId) {
  return {
    text: caption,
    title,
    yt_title: title,
    yt_description: caption,
    fb_message: caption,
    ig_caption: caption,
    x_text: caption,
    skip_crosspost: '1',
    campaign_id: campaignId,
    campaign_name: name,
    campaign_size: '',
  };
}
function cleanupCampaignFiles(files) {
  return Promise.all((files || []).map((f) => fs.unlink(f.path).catch(() => {})));
}
async function validateCampaignInputs(req, res) {
  const files = Array.isArray(req.files) ? req.files : [];
  const reject = async (status, error) => { await cleanupCampaignFiles(files); res.status(status).json({ error }); return null; };
  const targets = readCampaignTargets(req.body.targets);
  const caption = String(req.body.caption || '').trim();
  const title = String(req.body.title || '').trim().slice(0, 100);
  const campaignName = String(req.body.campaign_name || '').trim().slice(0, 120);
  const publishNow = req.body.mode === 'now';
  const when = req.body.scheduled_at ? Date.parse(req.body.scheduled_at) : null;
  if (!targets) return reject(400, 'Choose between 1 and 25 unique connected accounts.');
  if (!caption) return reject(400, 'Write the shared caption before continuing.');
  if (targets.some((t) => t.platform === 'youtube') && !title) return reject(400, 'Add a YouTube title for this campaign.');
  if (targets.some((t) => t.platform === 'x') && Array.from(caption).length > 280) return reject(400, 'X captions must be 280 characters or fewer.');
  if (targets.some((t) => t.platform === 'instagram') && caption.length > 2200) return reject(400, 'Instagram captions must be 2,200 characters or fewer.');
  if (!publishNow && !req.body.scheduled_at) return reject(400, 'Choose Post now or set a scheduled date and time.');
  const requestStartedAt = Number(req.scheduleRequestStartedAt) || Date.now();
  if (!publishNow && (!Number.isFinite(when) || when < requestStartedAt + 60_000 || when > Date.now() + 365 * 24 * 3600_000)) {
    return reject(400, 'Choose a time between 1 minute and 1 year from now.');
  }
  const byField = new Map();
  for (const file of files) {
    if (!/^media_(?:[0-9]|1[0-9]|2[0-4])$/.test(file.fieldname)) return reject(400, 'Campaign media did not match its selected account.');
    const group = byField.get(file.fieldname) || [];
    group.push(file); byField.set(file.fieldname, group);
  }
  for (let i = 0; i < targets.length; i++) {
    const list = byField.get(`media_${i}`) || [];
    const error = validateMedia(targets[i].platform, list);
    if (error) return reject(400, `${targets[i].platform}: ${error}`);
    if (targets[i].platform === 'instagram' && (!list.length || list.some((f) => f.mimetype.startsWith('image/') && f.mimetype !== 'image/jpeg'))) {
      return reject(400, 'Instagram needs a video or JPEG media.');
    }
    if (targets[i].platform === 'youtube' && (list.length !== 1 || !list[0].mimetype.startsWith('video/'))) {
      return reject(400, 'YouTube campaigns need one video for each selected channel.');
    }
    for (const file of list) {
      if (file.mimetype.startsWith('image/') && !(await magicIsImage(file.path))) return reject(400, 'A campaign image could not be verified.');
    }
  }
  const ids = targets.map((t) => t.connection_id);
  const { data: connections, error } = await supabase.from('platform_connections').select('*')
    .eq('user_id', req.user.id).in('id', ids);
  if (error) return reject(500, 'Could not verify the selected accounts.');
  const byId = new Map((connections || []).map((c) => [c.id, c]));
  if (targets.some((t) => byId.get(t.connection_id)?.platform !== t.platform)) return reject(409, 'A selected account is no longer connected. Refresh the account list and try again.');
  return { targets, caption, title, campaignName, when, publishNow, byField, files, byId };
}

function markScheduleRequestStart(req, _res, next) {
  req.scheduleRequestStartedAt = Date.now();
  next();
}

app.post('/api/schedules/campaign', requireUser, strictBurstLimit, scheduleRequestLimit, markScheduleRequestStart, campaignUpload, async (req, res) => {
  const campaign = await validateCampaignInputs(req, res);
  if (!campaign) return;
  const { targets, caption, title, campaignName, when, publishNow, files, byField, byId } = campaign;
  const { count: liveCount, error: countError } = await supabase.from('scheduled_posts')
    .select('id', { count: 'exact', head: true }).eq('user_id', req.user.id).in('status', ['scheduled', 'publishing']);
  if (countError) { await cleanupCampaignFiles(files); return res.status(500).json({ error: 'Could not check your schedule capacity.' }); }
  if ((liveCount || 0) + targets.length > 50) { await cleanupCampaignFiles(files); return res.status(429).json({ error: `This campaign needs ${targets.length} slots; your account has ${Math.max(0, 50 - (liveCount || 0))} available.` }); }
  const campaignId = crypto.randomUUID();
  const uploadedPaths = [];
  const rows = [];
  try {
    for (let index = 0; index < targets.length; index++) {
      const target = targets[index];
      const media = [];
      for (const file of byField.get(target.media_field) || []) {
        const ext = (path.extname(file.originalname || '') || (file.mimetype.startsWith('video/') ? '.mp4' : '.jpg')).replace(/[^a-z0-9.]/gi, '').slice(0, 8);
        const key = `scheduled/${req.user.id}/${campaignId}/${index}-${crypto.randomUUID()}${ext}`;
        const { error: uploadError } = await uploadMediaFile(supabase.storage.from(BUCKET), key, file, { contentType: file.mimetype, upsert: false });
        if (uploadError) throw new Error(`Could not store ${file.originalname || 'campaign media'}: ${uploadError.message || uploadError}`);
        uploadedPaths.push(key);
        media.push({ path: key, mimetype: file.mimetype, name: file.originalname || path.basename(key) });
      }
      const body = campaignBody(caption, title, campaignName, campaignId);
      body.campaign_size = String(targets.length);
      rows.push({ user_id: req.user.id, platform: target.platform, connection_id: byId.get(target.connection_id).id,
        scheduled_at: new Date(publishNow ? Date.now() : when).toISOString(), status: 'scheduled', body, media, thumb_path: null });
    }
    const { data, error } = await supabase.from('scheduled_posts').insert(rows).select();
    if (error || !data || data.length !== rows.length) throw new Error('Could not save every campaign post.');
    await cleanupCampaignFiles(files);
    if (publishNow) setImmediate(() => { void runDueSchedules(); });
    return res.status(201).json({ campaign_id: campaignId, mode: publishNow ? 'now' : 'scheduled', schedules: data });
  } catch (error) {
    await removeStored(uploadedPaths);
    await cleanupCampaignFiles(files);
    return res.status(500).json({ error: error.message || 'Could not schedule campaign.' });
  }
});

app.get('/api/schedules/campaign/:id', requireUser, jobsLimit, async (req, res) => {
  const { data, error } = await supabase.from('scheduled_posts')
    .select('id,platform,connection_id,scheduled_at,status,error,result_url,body')
    .eq('user_id', req.user.id).contains('body', { campaign_id: req.params.id }).limit(25);
  if (error) return res.status(500).json({ error: 'Could not load campaign progress.' });
  res.json({ schedules: data || [] });
});

function splitTags(raw) {
  return String(raw || '').split(/[,\s#]+/).map((t) => t.trim()).filter(Boolean).slice(0, 30);
}

async function runPublish(job, conn, payload, body, userId) {
  console.log('[publish] started', job.id, job.platform, 'rssMiB', Math.round(process.memoryUsage().rss / 1024 / 1024));
  const thumbFile = payload?.thumbFile || null;
  const files = payload?.files || (payload?.path ? [payload] : []);
  const instagramFiles = payload?.instagramFiles || [];
  const facebookFiles = payload?.facebookFiles || [];
  const coverFiles = payload?.coverFiles || {};
  const file = files[0] || null;
  const allFiles = files;
  const temporaryStoragePaths = [];
  const downloadedMediaPaths = [];
  const cleanupFiles = async () => {
    for (const f of [...allFiles, ...instagramFiles, ...facebookFiles, ...(payload?.thumbFile ? [payload.thumbFile] : []), ...Object.values(coverFiles).filter(Boolean)]) {
      if (f?.path) await fs.unlink(f.path).catch(() => {});
    }
    for (const downloadedPath of downloadedMediaPaths) await fs.unlink(downloadedPath).catch(() => {});
  };
  try {
      // onStage lets the long Meta video-processing wait update the
      // job message live so the UI never looks frozen.
      const onStage = (msg) => { job.message = msg; };
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
      job.postId = String(video.id);
      job.publishedPosts.push({ platform: job.platform, connectionId: conn.id, postId: String(video.id) });
      if (thumbFile) {
        try {
          await setVideoThumbnail({ accessToken: token, videoId: video.id, file: thumbFile });
        } catch (e) {
          // The video is already published. A thumbnail failure must not mark
          // the video job failed, which could prompt a duplicate upload retry.
          job.warning = `Video published, but YouTube did not apply the cover: ${e.message}`;
        }
      }
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
      job.postId = String(post.id);
      job.publishedPosts.push({ platform: job.platform, connectionId: conn.id, postId: String(post.id) });
    } else {
      const { decryptJson: dec } = await import('./crypto.js');
      const meta = await import('./meta.js');
      const tokens = dec(conn.encrypted_tokens);
      const pageToken = tokens.access_token;
      const pageId = tokens.page_id || conn.platform_account_id;
      const igCollabs = parseInstagramCollaborators(body.ig_collabs).usernames;
      const otherConn = async (platform, id, linkedPageId = null) => {
        const matchesPage = (candidate) => {
          if (!candidate || !linkedPageId) return !!candidate;
          if (platform === 'facebook') return String(candidate.platform_account_id) === String(linkedPageId);
          try { return String(dec(candidate.encrypted_tokens).page_id || '') === String(linkedPageId); }
          catch { return false; }
        };
        if (id) {
          const { data } = await supabase.from('platform_connections')
            .select('*').eq('id', id).eq('user_id', userId).eq('platform', platform).maybeSingle();
          if (matchesPage(data)) return data;
        }
        if (!linkedPageId) return null;
        const { data } = await supabase.from('platform_connections')
          .select('*').eq('user_id', userId).eq('platform', platform);
        return (data || []).find(matchesPage) || null;
      };
       // Pre-upload technique: the client uploaded media to
       // Supabase while reviewing captions. Skip the re-upload
       // here; download to disk only when Facebook needs a file,
       // and hand the public URL straight to Instagram.
       // (Must be declared before isCarousel below — referencing it
       // earlier crashed every Facebook/Instagram publish.)
       const preUploaded = (() => {
         if (body.hasPreuploadedMedia !== '1') return null;
         const out = [];
         let i = 0;
         while (true) { const u = body['mediaUrl' + i]; if (!u) break; out.push({ url: u, name: body['mediaName' + i] || ('media_' + i), mimetype: body['mediaType' + i] || '' }); i++; }
         return out.length ? out : null;
       })();
       const isCarousel = (allFiles.length >= 2 && allFiles.every((f) => String(f.mimetype || '').startsWith('image/'))) || (preUploaded && preUploaded.length >= 2 && preUploaded.every((e) => String(e.mimetype || '').startsWith('image/')));
       let media = null;
       let mediaList = [];
       let publicUrl = null;
       let publicUrls = [];
       if (preUploaded) { for (const e of preUploaded) { publicUrls.push(e.url); mediaList.push({ originalname: e.name, mimetype: e.mimetype || '', url: e.url }); } publicUrl = publicUrls[0] || null; }
       const uploadOnePublic = async (f) => {
        const rawExt = path.extname(f.originalname || '');
        const safeExt = rawExt.replace(/[^a-z0-9.]/gi, '').slice(0, 8)
          || (String(f.mimetype || '').startsWith('video/') ? '.mp4' : '.jpg');
        const key = `${crypto.randomUUID()}${safeExt}`;
        const { error: upErr } = await uploadMediaFile(supabase.storage.from(BUCKET), key, f, { upsert: true });
         if (upErr) throw new Error('Media upload failed (' + BUCKET + '): ' + (upErr.message || upErr) + '. Make sure the "' + BUCKET + '" bucket exists and is public.');
        temporaryStoragePaths.push(key);
        const { data } = supabase.storage.from(BUCKET).getPublicUrl(key);
        return { url: data.publicUrl, file: f };
      };
      const instagramPublicUrls = [];
      if (preUploaded && job.platform === 'facebook' && instagramFiles.length) {
        // A Facebook-originated image mirror has a different aspect-ratio
        // rendition for Instagram; use that variant rather than the FB URL.
        for (const f of instagramFiles) {
          const up = await uploadOnePublic(f);
          instagramPublicUrls.push(up.url);
        }
      } else if (preUploaded) {
        instagramPublicUrls.push(...preUploaded.map((item) => item.url));
      } else {
        for (const f of instagramFiles) {
          const up = await uploadOnePublic(f);
          instagramPublicUrls.push(up.url);
        }
      }
      const instagramCoverUrl = coverFiles.instagram ? (await uploadOnePublic(coverFiles.instagram)).url : null;
      const facebookMediaList = [];
      for (const f of facebookFiles) {
        facebookMediaList.push({ ...f, originalname: f.originalname, mimetype: f.mimetype });
      }
      if (allFiles.length && !preUploaded) {
        // Upload every file once so carousel + mirrors share the same URLs.
        // Single-photo/video keeps the old `media`/`publicUrl` behaviour.
        for (const f of allFiles) {
          const up = await uploadOnePublic(f);
          publicUrls.push(up.url);
          mediaList.push({ ...f, originalname: f.originalname, mimetype: f.mimetype });
        }
         publicUrl = publicUrls[0] || null;
         media = mediaList[0] || null;
       }
       // Both Meta APIs can fetch media from a public URL. Keep media as a
       // URL reference for Facebook too; do not download it to Railway first.
       const needsFacebookFile = job.platform === 'facebook'
         || (allowCrossPost && String(body.ig_share_fb || '') === '1');
       if (preUploaded && !media && mediaList.length && needsFacebookFile) {
         media = mediaList[0];
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
            cover: coverFiles.facebook,
          });
        }
        job.url = out.url;
        job.postId = out.id ? String(out.id) : null;
        if (job.postId) job.publishedPosts.push({ platform: job.platform, connectionId: conn.id, postId: job.postId });
        // Optional mirror to Instagram (needs media; text-only cannot mirror).
        // Skipped automatically on "Post to all" (skip_crosspost=1) to avoid doubles.
        if (allowCrossPost && String(body.fb_synd_ig || '') === '1') {
          const igConn = await otherConn('instagram', body.ig_connection_id, conn.platform_account_id);
          if (!igConn) {
            job.warning = 'Facebook published, but no Instagram account was chosen for the mirror.';
          } else if (!publicUrl) {
            job.warning = 'Facebook published. Instagram mirror skipped: attach a photo or video to mirror.';
          } else {
            try {
              const igTokens = dec(igConn.encrypted_tokens);
              const igUrls = instagramPublicUrls.length ? instagramPublicUrls : publicUrls;
              // The composer and Instagram publishing API both use usernames.
              const igCollaboratorUsernames = igCollabs.length
                ? (await meta.resolveInstagramCollaboratorUsernames({ igUserId: igConn.platform_account_id, pageToken: igTokens.access_token, handles: igCollabs })).usernames
                : [];
              if (isCarousel) {
                const mirror = await meta.publishInstagramCarousel({
                  igUserId: igConn.platform_account_id, pageToken: igTokens.access_token,
                  caption: String(body.fb_message ?? fallbackText),
                  collabs: igCollaboratorUsernames,
                  mediaUrls: igUrls,
                });
                if (mirror.id) job.publishedPosts.push({ platform: 'instagram', connectionId: igConn.id, postId: String(mirror.id) });
              } else {
                const mirror = await meta.publishInstagram({
                  igUserId: igConn.platform_account_id, pageToken: igTokens.access_token,
                  caption: String(body.fb_message ?? fallbackText),
                  collabs: igCollaboratorUsernames,
                  mediaUrl: igUrls[0] || publicUrl, isVideo: !!(file?.mimetype || mediaList[0]?.mimetype || '').startsWith('video/'),
                  coverUrl: instagramCoverUrl,
                  onStage,
                });
                if (mirror.id) job.publishedPosts.push({ platform: 'instagram', connectionId: igConn.id, postId: String(mirror.id) });
              }
              job.warning = igCollabs.length
                ? `Also mirrored to Instagram with ${igCollabs.length === 1 ? 'a collaborator invite' : 'collaborator invites'}. Each person must accept in Instagram.`
                : 'Also mirrored to Instagram.';
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
        const collabs = igCollabs.length
          ? (await meta.resolveInstagramCollaboratorUsernames({ igUserId: igId, pageToken, handles: igCollabs })).usernames
          : [];
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
               mediaUrl: publicUrl, isVideo: !!(file?.mimetype || mediaList[0]?.mimetype || '').startsWith('video/'),
             coverUrl: instagramCoverUrl,
             onStage,
           });
        }
        job.url = out.url;
        job.postId = out.id ? String(out.id) : null;
        if (job.postId) job.publishedPosts.push({ platform: job.platform, connectionId: conn.id, postId: job.postId });
        if (collabs.length) job.warning = `Instagram post published with ${collabs.length === 1 ? 'a collaborator invite' : 'collaborator invites'}. Each person must accept in Instagram.`;
        // Optional auto story: same media re-published as a 24h IG story.
        // Runs after the feed post so one tap covers feed + story.
        if (String(body.ig_post_story || '') === '1' && publicUrl) {
          try {
            await meta.publishInstagramStory({
              igUserId: igId, pageToken,
              mediaUrl: publicUrl, isVideo: !!(file?.mimetype || mediaList[0]?.mimetype || '').startsWith('video/'),
              onStage,
            });
            job.warning = [job.warning, 'Also posted as a story.'].filter(Boolean).join(' ');
          } catch (e) {
            job.warning = [job.warning, `Feed published, but story failed: ${e.message}`].filter(Boolean).join(' ');
          }
        }
        // Optional mirror to the linked Facebook Page.
        // Skipped automatically on "Post to all" to avoid double-posting.
        if (allowCrossPost && String(body.ig_share_fb || '') === '1') {
          const fbConn = await otherConn('facebook', body.fb_connection_id, tokens.page_id || conn.platform_account_id);
          if (!fbConn) {
            job.warning = 'Instagram published, but no Facebook Page was chosen for sharing.';
          } else {
            try {
              const fbTokens = dec(fbConn.encrypted_tokens);
              const fbMedia = facebookMediaList[0] || media;
              const fbMediaSet = facebookMediaList.length ? facebookMediaList : mediaList;
              if (isCarousel) {
                const mirror = await meta.publishFacebookCarousel({
                  pageId: fbConn.platform_account_id, pageToken: fbTokens.access_token,
                  text: caption, mediaList: fbMediaSet,
                });
                if (mirror.id) job.publishedPosts.push({ platform: 'facebook', connectionId: fbConn.id, postId: String(mirror.id) });
              } else {
                const mirror = await publishFacebook({
                  pageId: fbConn.platform_account_id, pageToken: fbTokens.access_token,
                  text: caption, media: fbMedia, cover: coverFiles.facebook,
                });
                if (mirror.id) job.publishedPosts.push({ platform: 'facebook', connectionId: fbConn.id, postId: String(mirror.id) });
              }
              job.warning = 'Also shared to the Facebook Page.';
            } catch (e) {
              job.warning = `Instagram published, but Facebook sharing failed: ${e.message}`;
            }
          }
        }
      }
    }
    job.state = 'completed'; job.progress = 100; job.message = job.warning || 'Published'; job.completedAt = Date.now();
    await supabase.from('post_history').insert({ user_id: userId, platform: job.platform, status: 'published', url: job.url || null, caption: String(body.text || '').slice(0, 500) }).then(() => {});
  } catch (e) {
    job.state = 'failed'; job.message = e.message; job.completedAt = Date.now();
  } finally {
    await cleanupFiles();
    await removeStored(temporaryStoragePaths);
    console.log('[publish] finished', job.id, job.state, 'rssMiB', Math.round(process.memoryUsage().rss / 1024 / 1024));
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
  if (platform === 'instagram' && files.length > 10) return 'Instagram publishing supports up to 10 carousel slides.';
  if (platform === 'facebook' && files.length > 20) return 'Facebook allows up to 20 photos per carousel.';
  if (platform === 'x' && files.length > 4) return 'X allows up to 4 media attachments.';
  if (platform === 'youtube' && files.length > 1) return 'YouTube accepts one video per post.';
  for (const f of files) {
    const mt = String(f.mimetype || '');
    if (!mt.startsWith('image/') && !mt.startsWith('video/')) return 'Only image and video files are accepted';
    if (mt.startsWith('image/') && platform === 'instagram' && f.size > 8 * 1024 * 1024) return 'Instagram photos must be 8 MB or smaller';
    if (mt.startsWith('image/') && platform === 'instagram' && mt !== 'image/jpeg') return 'Instagram photos must be JPEG. Reopen Stage 3 to prepare this photo.';
    if (mt.startsWith('image/') && platform !== 'instagram' && f.size > 10 * 1024 * 1024) return 'Image is larger than 10 MB';
    if (mt.startsWith('video/') && f.size > MAX_UPLOAD_BYTES) return 'Video is larger than 400 MB';
  }
  const imgCount = files.filter((f) => String(f.mimetype || '').startsWith('image/')).length;
  const vidCount = files.filter((f) => String(f.mimetype || '').startsWith('video/')).length;
  if (files.length > 1 && vidCount > 0 && (platform === 'instagram' || platform === 'facebook')) {
    return `Carousel takes photos only (2-${platform === 'instagram' ? 10 : 20}). Post videos one at a time.`;
  }
  if (platform === 'x' && files.length > 4) return 'X allows up to 4 photos per post';
  return null;
}

async function removeStored(paths) {
  for (const p of [].concat(paths || []).filter(Boolean)) {
    await supabase.storage.from(BUCKET).remove([p]).catch(() => {});
  }
}

function scheduleMediaPaths(row) {
  return [
    ...(row.media || []).map((m) => m.path),
    ...(row.body?.driftpost_instagram_media || []).map((m) => m.path),
    ...(row.body?.driftpost_facebook_media || []).map((m) => m.path),
    ...Object.values(row.body?.driftpost_covers || {}).map((m) => m.path),
    row.thumb_path,
  ].filter(Boolean);
}

async function removeUnreferencedScheduleMedia(userId, rowId, paths) {
  const { data } = await supabase.from('scheduled_posts')
    .select('id, media, body, thumb_path').eq('user_id', userId)
    .in('status', ['scheduled', 'publishing']).neq('id', rowId);
  const referenced = new Set((data || []).flatMap(scheduleMediaPaths));
  await removeStored([].concat(paths || []).filter((p) => !referenced.has(p)));
}

app.get('/api/schedules', requireUser, jobsLimit, async (req, res) => {
  const historyMode = req.query.history === '1';
  let query = supabase.from('scheduled_posts')
    .select('*').eq('user_id', req.user.id)
    .order(historyMode ? 'updated_at' : 'scheduled_at', { ascending: !historyMode }).limit(100);
  const from = typeof req.query.from === 'string' ? Date.parse(req.query.from) : NaN;
  const to = typeof req.query.to === 'string' ? Date.parse(req.query.to) : NaN;
  if (req.query.from && !Number.isFinite(from)) return res.status(400).json({ error: 'Invalid schedule start date' });
  if (req.query.to && !Number.isFinite(to)) return res.status(400).json({ error: 'Invalid schedule end date' });
  if (Number.isFinite(from)) query = query.gte('scheduled_at', new Date(from).toISOString());
  if (Number.isFinite(to)) query = query.lt('scheduled_at', new Date(to).toISOString());
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: 'Could not load scheduled posts' });
  res.json({ schedules: data || [] });
});

// Shareable review links use the schedule UUID as a bearer token. Return only
// the content needed to make an approval decision; never expose the owner or
// their platform credentials to the reviewer.
app.get('/api/approvals/:id', strictBurstLimit, async (req, res) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.params.id)) return res.status(404).json({ error: 'Review link not found' });
  const { data: row, error } = await supabase.from('scheduled_posts').select('id, platform, scheduled_at, status, body, media')
    .eq('id', req.params.id).maybeSingle();
  if (error || !row || row.body?.approval_status !== 'pending' || row.status !== 'scheduled') return res.status(404).json({ error: 'This review link is unavailable or already handled.' });
  const text = row.body?.ig_caption || row.body?.fb_message || row.body?.yt_description || row.body?.x_text || row.body?.text || '';
  const sourceMedia = row.platform === 'instagram' ? (row.body?.driftpost_instagram_media || row.media) : row.platform === 'facebook' ? (row.body?.driftpost_facebook_media || row.media) : row.media;
  const media = [];
  for (const item of sourceMedia || []) {
    const { data: signed, error: signError } = await supabase.storage.from(BUCKET).createSignedUrl(item.path, 1800);
    if (!signError && signed?.signedUrl) media.push({ url: signed.signedUrl, name: item.name || 'Post media', mimetype: item.mimetype || '' });
  }
  res.json({ review: { id: row.id, platform: row.platform, scheduled_at: row.scheduled_at, text, media } });
});

app.post('/api/approvals/:id', strictBurstLimit, async (req, res) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(req.params.id)) return res.status(404).json({ error: 'Review link not found' });
  const decision = req.body?.decision;
  const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim().slice(0, 500) : '';
  if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ error: 'Choose approve or request changes.' });
  const { data: row } = await supabase.from('scheduled_posts').select('*').eq('id', req.params.id).maybeSingle();
  if (!row || row.status !== 'scheduled' || row.body?.approval_status !== 'pending') return res.status(409).json({ error: 'This post has already been reviewed or is no longer available.' });
  if (decision === 'approved' && Date.parse(row.scheduled_at) < Date.now() + 60_000) return res.status(409).json({ error: 'The scheduled time has passed. Ask the owner to create a new review link.' });
  const body = { ...(row.body || {}), approval_status: decision, reviewed_at: new Date().toISOString(), approval_comment: comment };
  const update = supabase.from('scheduled_posts').update({ body, ...(decision === 'rejected' ? { status: 'cancelled' } : {}), updated_at: new Date().toISOString() })
    .eq('id', row.id).eq('status', 'scheduled').select('id');
  const { data: changed, error } = await update;
  if (error) return res.status(500).json({ error: 'Could not save this review.' });
  if (!changed?.length) return res.status(409).json({ error: 'The post changed while you were reviewing it. Refresh and try again.' });
  if (decision === 'rejected') await removeUnreferencedScheduleMedia(row.user_id, row.id, scheduleMediaPaths(row));
  res.json({ ok: true, decision });
});

// Record request start before Multer receives large media; otherwise a valid
// near-future schedule could become a false 400 after upload completes.
app.post('/api/schedule', requireUser, strictBurstLimit, scheduleRequestLimit, markScheduleRequestStart, publishUpload, async (req, res) => {
  const files = [...(req.files?.media || []), ...(req.file ? [req.file] : [])];
  const instagramFiles = req.files?.instagram_media || [];
  const facebookFiles = req.files?.facebook_media || [];
  const thumbFile = req.files?.thumbnail?.[0] || null;
  const coverFiles = { instagram: req.files?.cover_instagram?.[0] || null, facebook: req.files?.cover_facebook?.[0] || null };
  const cleanupTmp = async () => {
    for (const f of [...files, ...instagramFiles, ...facebookFiles, ...(thumbFile ? [thumbFile] : []), ...Object.values(coverFiles).filter(Boolean)]) await fs.unlink(f.path).catch(() => {});
  };
  try {
    Object.assign(req.body, scheduleIdentity(req.body));
  } catch (error) {
    await cleanupTmp();
    return res.status(400).json({ error: error.message });
  }
  const platform = req.body.platform;
  const connectionId = req.body.connection_id;
  if (!['youtube', 'facebook', 'instagram', 'x'].includes(platform)) {
    await cleanupTmp();
    return res.status(400).json({ error: 'Pick YouTube, Instagram, Facebook or X' });
  }
  const directStored = [];
  if (req.body.hasPreuploadedMedia === '1') {
    if (!['instagram', 'facebook'].includes(platform) || files.length) {
      await cleanupTmp();
      return res.status(400).json({ error: 'Stored media can only be scheduled directly for Instagram or Facebook.' });
    }
    for (let index = 0; index < 10; index++) {
      const objectPath = String(req.body[`mediaPath${index}`] || '');
      if (!objectPath) break;
      const [owner, filename, ...extra] = objectPath.split('/');
      const mimetype = String(req.body[`mediaType${index}`] || '').toLowerCase();
      const size = Number(req.body[`mediaSize${index}`]);
      const name = String(req.body[`mediaName${index}`] || filename || `media_${index}`).slice(0, 240);
      if (owner !== req.user.id || extra.length || !/^[0-9a-f-]{36}\.[a-z0-9]{1,8}$/i.test(filename || '')
        || !mimetype.startsWith('video/') || !Number.isFinite(size) || size < 1 || size > MAX_UPLOAD_BYTES) {
        await cleanupTmp();
        return res.status(400).json({ error: 'Direct-scheduled video reference is invalid. Re-upload the video and try again.' });
      }
      directStored.push({ path: objectPath, mimetype, name, size });
    }
    if (!directStored.length || directStored.length > 1) {
      await cleanupTmp();
      return res.status(400).json({ error: 'Schedule one video at a time.' });
    }
  }
  const collaboratorError = instagramCollaboratorError(platform, req.body);
  if (collaboratorError) {
    await cleanupTmp();
    return res.status(400).json({ error: collaboratorError });
  }
  const when = Date.parse(req.body.scheduled_at || '');
  if (!Number.isFinite(when)) {
    await cleanupTmp();
    return res.status(400).json({ error: 'Pick a valid date and time' });
  }
  const requestStartedAt = Number(req.scheduleRequestStartedAt) || Date.now();
  if (when < requestStartedAt + 60 * 1000) {
    await cleanupTmp();
    return res.status(400).json({ error: 'Schedule at least 1 minute from now' });
  }
  if (when > Date.now() + 365 * 24 * 3600 * 1000) {
    await cleanupTmp();
    return res.status(400).json({ error: 'Schedule within the next year' });
  }
  const repeatEveryDays = Number(req.body.repeat_every_days || 0);
  const repeatRemaining = Number(req.body.repeat_remaining || 0);
  const validRepeat = (repeatEveryDays === 0 && repeatRemaining === 0)
    || ([7, 14, 30].includes(repeatEveryDays) && Number.isInteger(repeatRemaining) && repeatRemaining >= 1 && repeatRemaining <= 12);
  if (!validRepeat || !Number.isInteger(repeatEveryDays) || !Number.isInteger(repeatRemaining)) {
    await cleanupTmp();
    return res.status(400).json({ error: 'Choose a supported repeat interval and between 1 and 12 additional posts.' });
  }
  if (repeatEveryDays && when + repeatEveryDays * repeatRemaining * 24 * 3600 * 1000 > Date.now() + 365 * 24 * 3600 * 1000) {
    await cleanupTmp();
    return res.status(400).json({ error: 'The final repeat must be within the next year.' });
  }
  const mediaErr = validateMedia(platform, files.length ? files : directStored);
  const igVariantError = validateMedia('instagram', instagramFiles);
  const fbVariantError = validateMedia('facebook', facebookFiles);
  if (mediaErr || igVariantError || fbVariantError) {
    await cleanupTmp();
    return res.status(400).json({ error: mediaErr || igVariantError || fbVariantError });
  }
  for (const f of instagramFiles) {
    if (f.mimetype !== 'image/jpeg' || f.size > 8 * 1024 * 1024 || !(await magicIsImage(f.path))) {
      await cleanupTmp();
      return res.status(400).json({ error: 'Instagram media must be a valid JPEG no larger than 8 MB.' });
    }
  }
  for (const f of facebookFiles) {
    if (f.mimetype !== 'image/jpeg' || f.size > 10 * 1024 * 1024 || !(await magicIsImage(f.path))) {
      await cleanupTmp();
      return res.status(400).json({ error: 'Facebook mirror media must be a valid JPEG no larger than 10 MB.' });
    }
  }
  for (const cover of Object.values(coverFiles).filter(Boolean)) {
    if (cover.mimetype !== 'image/jpeg' || cover.size > 5 * 1024 * 1024 || !(await magicIsImage(cover.path))) {
      await cleanupTmp();
      return res.status(400).json({ error: 'Covers must be valid JPEG images no larger than 5 MB.' });
    }
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
  const storedInstagram = [];
  const storedFacebook = [];
  const storedCovers = {};
  let thumbPath = null;
  try {
    if (directStored.length) stored.push(...directStored);
    else for (const f of files) {
      const ext = (path.extname(f.originalname || '') || (String(f.mimetype).startsWith('video/') ? '.mp4' : '.jpg'))
        .replace(/[^a-z0-9.]/gi, '').slice(0, 8);
      const key = `${prefix}/${crypto.randomUUID()}${ext}`;
      const { error: upErr } = await uploadMediaFile(supabase.storage.from(BUCKET), key, f, { upsert: false });
       if (upErr) throw new Error('Media upload failed (' + BUCKET + '): ' + (upErr.message || upErr) + '. Make sure the "' + BUCKET + '" bucket exists and is public.');
      stored.push({ path: key, mimetype: f.mimetype, name: f.originalname || key.split('/').pop() });
    }
    for (const f of instagramFiles) {
      const key = `${prefix}/instagram-${crypto.randomUUID()}.jpg`;
      const { error: upErr } = await uploadMediaFile(supabase.storage.from(BUCKET), key, f, { contentType: 'image/jpeg', upsert: false });
      if (upErr) throw new Error('Instagram media upload failed (' + BUCKET + '): ' + (upErr.message || upErr));
      storedInstagram.push({ path: key, mimetype: 'image/jpeg', name: f.originalname || key.split('/').pop() });
    }
    for (const f of facebookFiles) {
      const key = `${prefix}/facebook-${crypto.randomUUID()}.jpg`;
      const { error: upErr } = await uploadMediaFile(supabase.storage.from(BUCKET), key, f, { contentType: 'image/jpeg', upsert: false });
      if (upErr) throw new Error('Facebook media upload failed (' + BUCKET + '): ' + (upErr.message || upErr));
      storedFacebook.push({ path: key, mimetype: 'image/jpeg', name: f.originalname || key.split('/').pop() });
    }
    for (const [platformName, f] of Object.entries(coverFiles)) {
      if (!f) continue;
      const key = `${prefix}/${platformName}-cover-${crypto.randomUUID()}.jpg`;
      const { error: upErr } = await uploadMediaFile(supabase.storage.from(BUCKET), key, f, { contentType: 'image/jpeg', upsert: false });
      if (upErr) throw new Error(`${platformName} cover upload failed (${BUCKET}): ${upErr.message || upErr}`);
      storedCovers[platformName] = { path: key, mimetype: 'image/jpeg', name: f.originalname || 'cover.jpg' };
    }
    if (thumbFile) {
      const key = `${prefix}/cover.jpg`;
      const { error: upErr } = await uploadMediaFile(supabase.storage.from(BUCKET), key, thumbFile, { upsert: false });
      if (upErr) throw new Error('Cover upload failed. Create public bucket "' + BUCKET + '" in Supabase Storage.');
      thumbPath = key;
    }
    const { data, error } = await supabase.from('scheduled_posts').insert({
      user_id: req.user.id,
      platform,
      connection_id: connectionId,
      scheduled_at: new Date(when).toISOString(),
      status: 'scheduled',
      body: { ...(req.body || {}), repeat_every_days: repeatEveryDays, repeat_remaining: repeatRemaining, yt_thumbnail_mimetype: thumbFile?.mimetype || '', driftpost_instagram_media: storedInstagram, driftpost_facebook_media: storedFacebook, driftpost_covers: storedCovers },
      media: stored,
      thumb_path: thumbPath,
    }).select().single();
    if (error) throw new Error('Could not save the schedule');
    console.info('[schedule] queued', platform, data.id, data.scheduled_at);
    await cleanupTmp();
    res.status(201).json({ schedule: data });
  } catch (e) {
    await removeStored([...stored.map((s) => s.path), ...storedInstagram.map((s) => s.path), ...storedFacebook.map((s) => s.path), ...Object.values(storedCovers).map((s) => s.path), thumbPath]);
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
  await removeUnreferencedScheduleMedia(row.user_id, row.id, scheduleMediaPaths(row));
  res.json({ ok: true });
});

app.patch('/api/schedules/:id', requireUser, jobsLimit, async (req, res) => {
  const when = Date.parse(req.body?.scheduled_at || '');
  if (!Number.isFinite(when) || when < Date.now() + 60_000 || when > Date.now() + 365 * 24 * 3600_000) {
    return res.status(400).json({ error: 'Choose a new time at least 1 minute from now and within the next year.' });
  }
  const { data: row, error } = await supabase.from('scheduled_posts').select('id,status,body')
    .eq('id', req.params.id).eq('user_id', req.user.id).maybeSingle();
  if (error || !row) return res.status(404).json({ error: 'Scheduled post not found.' });
  if (row.status !== 'scheduled') return res.status(409).json({ error: 'Only scheduled posts can be moved.' });
  const { data: moved, error: updateError } = await supabase.from('scheduled_posts')
    .update({ scheduled_at: new Date(when).toISOString(), updated_at: new Date().toISOString() })
    .eq('id', row.id).eq('user_id', req.user.id).eq('status', 'scheduled').select().maybeSingle();
  if (updateError) return res.status(500).json({ error: 'Could not move this scheduled post.' });
  if (!moved) return res.status(409).json({ error: 'This post started publishing before it could be moved.' });
  res.json({ schedule: moved });
});

// Worker: pull due rows, rebuild the upload from Storage, run the real
// publisher. One bad row never blocks the rest.
let scheduleTickRunning = false;
async function runDueSchedules() {
  if (scheduleTickRunning) return;
  scheduleTickRunning = true;
  scheduleWorkerHealth.running = true;
  scheduleWorkerHealth.lastTickAt = new Date().toISOString();
  scheduleWorkerHealth.lastClaimedCount = 0;
  try {
    // A process can be restarted after claiming a row. Recover old claims so
    // schedules do not remain stuck forever; the 30 minute window is longer
    // than the slowest supported media-processing path.
    const staleBefore = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data: staleRows, error: recoverError } = await supabase.from('scheduled_posts')
      .update({ status: 'failed', error: 'The publishing worker stopped during this post. Please schedule it again.', updated_at: new Date().toISOString() })
      .eq('status', 'publishing').lt('updated_at', staleBefore).select('id, user_id, media, body, thumb_path');
    if (recoverError) throw recoverError;
    for (const row of staleRows || []) {
      await removeUnreferencedScheduleMedia(row.user_id, row.id, scheduleMediaPaths(row));
    }

    // Page through overdue approvals as needed. They intentionally remain in
    // `scheduled`, so a fixed first page could otherwise hide ready posts.
    const ready = [];
    const scanPageSize = 1000;
    for (let offset = 0; ready.length < SCHED_BATCH; offset += scanPageSize) {
      const { data: duePage, error: dueError } = await supabase.from('scheduled_posts')
        .select('*').eq('status', 'scheduled').lte('scheduled_at', new Date().toISOString())
        .order('scheduled_at', { ascending: true }).range(offset, offset + scanPageSize - 1);
      if (dueError) throw dueError;
      const rows = duePage || [];
      ready.push(...rows.filter((row) => row.body?.approval_status !== 'pending').slice(0, SCHED_BATCH - ready.length));
      if (rows.length < scanPageSize) break;
    }
    for (const row of ready) {
      // Approval links pause the existing scheduled row until the reviewer
      // approves it. It remains visible/cancellable from the owner's calendar.
      if (row.body?.approval_status === 'pending') continue;
      // Claim the row so a second instance/loop cannot double-post.
      const { data: claimed, error: claimError } = await supabase.from('scheduled_posts')
        .update({ status: 'publishing', updated_at: new Date().toISOString() })
        .eq('id', row.id).eq('status', 'scheduled').select();
      if (claimError) throw claimError;
      if (!claimed || !claimed.length) continue;
      scheduleWorkerHealth.lastClaimedCount += 1;
      console.info('[scheduler] claimed', row.platform, row.id);
      const { data: conn } = await supabase.from('platform_connections')
        .select('*').eq('id', row.connection_id).eq('user_id', row.user_id).maybeSingle();
      const job = {
        id: crypto.randomUUID(),
        userId: row.user_id,
        platform: row.platform,
        connectionId: row.connection_id,
        publishedPosts: [],
        state: 'queued',
        progress: 0,
        message: 'Scheduled publish',
        createdAt: Date.now(),
      };
      jobs.set(job.id, job);
      const downloadedPaths = [];
      // Keep long platform uploads alive; stale recovery only applies when
      // this process has stopped refreshing the publishing row.
      let heartbeatRunning = false;
      const leaseHeartbeat = setInterval(async () => {
        if (heartbeatRunning) return;
        heartbeatRunning = true;
        try {
          const { error } = await supabase.from('scheduled_posts')
            .update({ updated_at: new Date().toISOString() })
            .eq('id', row.id).eq('status', 'publishing');
          if (error) console.error('[scheduler] Could not refresh publish lease:', error.message);
        } catch (error) {
          console.error('[scheduler] Could not refresh publish lease:', error?.message || error);
        } finally {
          heartbeatRunning = false;
        }
      }, 60 * 1000);
      leaseHeartbeat.unref();
      try {
        if (!conn) throw new Error('The connected account is gone — reconnect it.');
        const downloadScheduledFile = async (media, prefix, required = true) => {
          const { data: signed, error: signError } = await supabase.storage.from(BUCKET).createSignedUrl(media.path, 900);
          if (signError || !signed?.signedUrl) {
            if (!required) return null;
            throw new Error('Scheduled media is missing from storage');
          }
          const tmp = path.join(os.tmpdir(), `${prefix}-${crypto.randomUUID()}${path.extname(media.path) || '.jpg'}`);
          downloadedPaths.push(tmp);
          try {
            await downloadMediaFile(signed.signedUrl, tmp);
            const stat = await fs.stat(tmp);
            return { path: tmp, mimetype: media.mimetype || 'image/jpeg', originalname: media.name || 'media', size: stat.size };
          } catch (error) {
            await fs.unlink(tmp).catch(() => {});
            if (!required) return null;
            throw error;
          }
        };
        const hostedMetaVideo = ['instagram', 'facebook'].includes(row.platform)
          && (row.media || []).length === 1
          && String(row.media[0].mimetype || '').startsWith('video/');
        const localFiles = [];
        if (!hostedMetaVideo) {
          for (const media of row.media || []) localFiles.push(await downloadScheduledFile(media, 'driftpost-sched'));
        }
        const localInstagramFiles = [];
        if (!hostedMetaVideo) {
          for (const media of row.body?.driftpost_instagram_media || []) localInstagramFiles.push(await downloadScheduledFile(media, 'driftpost-sched-ig'));
        }
        const localFacebookFiles = [];
        for (const media of row.body?.driftpost_facebook_media || []) localFacebookFiles.push(await downloadScheduledFile(media, 'driftpost-sched-fb'));
        let thumbFile = null;
        if (row.thumb_path) {
          thumbFile = await downloadScheduledFile({ path: row.thumb_path, mimetype: row.body?.yt_thumbnail_mimetype || 'image/jpeg', name: 'cover.jpg' }, 'driftpost-sched-cover', false);
        }
        const localCovers = {};
        for (const [platformName, cover] of Object.entries(row.body?.driftpost_covers || {})) {
          if (!cover?.path) continue;
          localCovers[platformName] = await downloadScheduledFile({ ...cover, mimetype: 'image/jpeg', name: cover.name || 'cover.jpg' }, `driftpost-sched-${platformName}-cover`);
        }
        const publishBody = { ...(row.body || {}) };
        if (hostedMetaVideo) {
          const item = row.media[0];
          const { data } = supabase.storage.from(BUCKET).getPublicUrl(item.path);
          publishBody.hasPreuploadedMedia = '1';
          publishBody.mediaUrl0 = data.publicUrl;
          publishBody.mediaPath0 = item.path;
          publishBody.mediaName0 = item.name || 'scheduled-video';
          publishBody.mediaType0 = item.mimetype || 'video/mp4';
        }
        await queuePublish(() => runPublish(job, conn, { files: localFiles, instagramFiles: localInstagramFiles, facebookFiles: localFacebookFiles, thumbFile, coverFiles: localCovers }, publishBody, row.user_id), job);
        const done = jobs.get(job.id) || job;
        const published = done.state === 'completed';
        await supabase.from('scheduled_posts').update({
          status: published ? 'published' : 'failed',
          result_url: done.url || null,
          error: published ? null : (done.message || 'Publish failed'),
          updated_at: new Date().toISOString(),
        }).eq('id', row.id);
        console.info('[scheduler] finished', row.platform, row.id, published ? 'published' : 'failed');
        let mediaRetained = false;
        const everyDays = Number(row.body?.repeat_every_days || 0);
        let remaining = Number(row.body?.repeat_remaining || 0);
        if (published && [7, 14, 30].includes(everyDays) && remaining > 0) {
          const interval = everyDays * 24 * 3600 * 1000;
          let nextAt = Date.parse(row.scheduled_at) + interval;
          remaining -= 1;
          // If the worker was offline across one or more repeat slots, skip
          // those missed occurrences instead of publishing a burst on restart.
          while (remaining > 0 && nextAt < Date.now() + 60_000) {
            nextAt += interval;
            remaining -= 1;
          }
          if (remaining > 0 && nextAt <= Date.now() + 365 * 24 * 3600 * 1000) {
            const { error: repeatError } = await supabase.from('scheduled_posts').insert({
              user_id: row.user_id,
              platform: row.platform,
              connection_id: row.connection_id,
              scheduled_at: new Date(nextAt).toISOString(),
              status: 'scheduled',
              body: { ...(row.body || {}), repeat_every_days: everyDays, repeat_remaining: remaining },
              media: row.media || [],
              thumb_path: row.thumb_path || null,
            });
            if (repeatError) console.error('[scheduler] Could not queue repeat:', repeatError.message);
            else mediaRetained = true;
          }
        }
        if (!mediaRetained) await removeUnreferencedScheduleMedia(row.user_id, row.id, scheduleMediaPaths(row));
      } catch (e) {
        await Promise.all(downloadedPaths.map((file) => fs.unlink(file).catch(() => {})));
        await supabase.from('scheduled_posts').update({
          status: 'failed',
          error: e.message || 'Publish failed',
          updated_at: new Date().toISOString(),
        }).eq('id', row.id);
        console.error('[scheduler] post failed', row.platform, row.id, String(e?.message || e).slice(0, 300));
        await removeUnreferencedScheduleMedia(row.user_id, row.id, scheduleMediaPaths(row));
      } finally {
        clearInterval(leaseHeartbeat);
      }
    }
    scheduleWorkerHealth.lastSuccessAt = new Date().toISOString();
    scheduleWorkerHealth.lastError = null;
  } catch (e) {
    scheduleWorkerHealth.lastError = String(e?.message || e).slice(0, 500);
    // Keep the interval alive while making the failure visible in API logs.
    console.error('[scheduler] Tick failed:', e?.message || e);
  } finally {
    scheduleTickRunning = false;
    scheduleWorkerHealth.running = false;
  }
}
setInterval(runDueSchedules, 15 * 1000).unref();
setTimeout(runDueSchedules, 3 * 1000).unref();

app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

app.use((err, _req, res, _next) => {
  console.error(err);
  if (err && err.message === 'Not allowed by CORS') {
    return res.status(403).json({ error: 'CORS policy blocked this request' });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Upload is too large. Reload the app and try again.' });
  }
  if (err && (err.code === 'LIMIT_FILE_SIZE' || err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE')) {
    return res.status(400).json({ error: 'File is too large. Images max 10 MB, videos max 400 MB.' });
  }
  if (err && err.message === 'Only image and video files are accepted') {
    return res.status(400).json({ error: err.message });
  }
  res.status(500).json({ error: 'Server error' });
});
app.listen(port, '0.0.0.0', () => console.log(`Driftpost API on :${port}`));
