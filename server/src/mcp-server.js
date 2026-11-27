import crypto from 'node:crypto';
import { MCP_SCOPES, MCP_TOKEN_TTL_MS, findMcpAccessToken, hashMcpSecret } from './mcp-auth.js';

const OAUTH_CODE_TTL_MS = 10 * 60 * 1000;
const oauthCodes = new Map();
const registeredClients = new Map();

function getPublicOrigin(req) {
  const configured = String(process.env.PUBLIC_API_URL || process.env.API_PUBLIC_URL || '').trim().replace(/\/$/, '');
  if (configured) return configured;
  const proto = String(req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim();
  const host = String(req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
  return `${proto}://${host}`;
}

function verifyPkce(codeVerifier, codeChallenge, method) {
  if (!codeChallenge) return true;
  if (!codeVerifier) return false;
  if (!method || method === 'S256') {
    const computed = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
    return computed === codeChallenge;
  }
  if (method === 'plain') return codeVerifier === codeChallenge;
  return false;
}

function formatAccount(c) {
  const rawName = String(c.account_name || c.name || c.username || c.id || '').trim();
  const explicitUsername = String(c.username || '').trim().replace(/^@+/, '');
  let derivedUsername = explicitUsername;
  if (!derivedUsername && rawName.startsWith('@')) {
    derivedUsername = rawName.replace(/^@+/, '').split(/\s+/)[0];
  } else if (!derivedUsername && c.platform === 'instagram' && /^[a-z0-9._]{2,30}$/i.test(rawName)) {
    derivedUsername = rawName;
  }
  const displayName = rawName.startsWith('@')
    ? rawName.replace(/^@+/, '').replace(/[._]+/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())
    : rawName;
  return {
    id: c.id,
    platform: c.platform,
    name: displayName || rawName,
    username: derivedUsername || null,
  };
}

function formatCompactSchedule(row, accountMap) {
  const body = row?.body && typeof row.body === 'object' ? row.body : {};
  const caption = String(
    body.ig_caption || body.fb_message || body.yt_description || body.x_text || body.caption || body.text || ''
  ).trim();
  const mediaList = Array.isArray(row?.media) ? row.media : [];
  const firstMime = String(mediaList[0]?.mimetype || row?.media_mimetype || '').toLowerCase();
  const mediaType = mediaList.length > 1
    ? 'carousel'
    : firstMime.startsWith('video/')
      ? 'video'
      : firstMime.startsWith('image/')
        ? 'image'
        : 'text';
  const acct = accountMap.get(row.connection_id);
  return {
    id: row.id,
    account_id: row.connection_id || null,
    account_name: acct?.name || body.brand_name || row.account_name || null,
    platform: row.platform || acct?.platform || null,
    caption: caption.slice(0, 500),
    title: body.yt_title ? String(body.yt_title).slice(0, 120) : undefined,
    scheduled_at: row.scheduled_at || null,
    status: row.status || 'unknown',
    media_type: mediaType,
    error: row.error ? String(row.error).slice(0, 300) : null,
  };
}

async function downloadSafeMedia(urlString, fallbackName = '') {
  const mediaUrl = String(urlString || '').trim();
  let parsedUrl;
  try {
    parsedUrl = new URL(mediaUrl);
  } catch {
    throw new Error('Media URL must be a valid HTTPS URL.');
  }
  if (parsedUrl.protocol !== 'https:') {
    throw new Error('Media URL must use https://.');
  }
  const host = parsedUrl.hostname.toLowerCase();
  if (
    host === 'localhost'
    || host.endsWith('.local')
    || host.endsWith('.internal')
    || /^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\])/.test(host)
  ) {
    throw new Error('Media URL cannot point to a private or local network address.');
  }
  const mediaRes = await fetch(mediaUrl, { signal: AbortSignal.timeout(45000) });
  if (!mediaRes.ok) {
    throw new Error(`Could not download media URL (HTTP ${mediaRes.status}).`);
  }
  const contentType = mediaRes.headers.get('content-type') || 'application/octet-stream';
  const arrayBuf = await mediaRes.arrayBuffer();
  if (arrayBuf.byteLength > 250 * 1024 * 1024) {
    throw new Error('Media file exceeds 250MB limit.');
  }
  const blob = new Blob([arrayBuf], { type: contentType });
  let filename = String(fallbackName || '').trim();
  if (!filename) {
    const ext = contentType.includes('mp4')
      ? 'mp4'
      : contentType.includes('quicktime')
        ? 'mov'
        : contentType.includes('png')
          ? 'png'
          : contentType.includes('jpeg') || contentType.includes('jpg')
            ? 'jpg'
            : contentType.includes('webp')
              ? 'webp'
              : 'mp4';
    filename = `driftpost-media.${ext}`;
  }
  return { blob, filename, contentType };
}

const MCP_TOOLS = [
  {
    name: 'driftpost_list_accounts',
    description:
      'List all connected social media accounts in the user\'s Driftpost workspace (Instagram, Facebook, YouTube, X) with their account IDs, platform, display name, and username. Always call this or driftpost_search_accounts before publishing.',
    inputSchema: {
      type: 'object',
      properties: {
        platform: {
          type: 'string',
          enum: ['instagram', 'facebook', 'youtube', 'x'],
          description: 'Optional filter by platform.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'driftpost_search_accounts',
    description:
      'Search connected Driftpost accounts by brand name, display name, or @username handle. Faster than listing all accounts when the user has dozens of brands.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Brand name or username substring to search for (e.g. "hair match", "famebros", "devi").',
        },
        platform: {
          type: 'string',
          enum: ['instagram', 'facebook', 'youtube', 'x'],
          description: 'Optional filter by platform.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'driftpost_get_brand_profile',
    description:
      'Retrieve a brand\'s saved Driftpost profile (official name, category, location, contact footer, hashtag bank, and writing direction) so you can write accurate, on-brand captions using ChatGPT intelligence.',
    inputSchema: {
      type: 'object',
      properties: {
        brand_name: {
          type: 'string',
          description: 'Brand name or handle to look up (e.g. "Hair Match Salon", "Devi & Co").',
        },
      },
      required: ['brand_name'],
      additionalProperties: false,
    },
  },
  {
    name: 'driftpost_list_scheduled_posts',
    description:
      'List upcoming scheduled posts in the user\'s Driftpost calendar (compact summary). By default returns only future posts with status "scheduled".',
    inputSchema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['scheduled', 'published', 'failed', 'cancelled', 'all'],
          description: 'Filter by post status (defaults to "scheduled" upcoming posts only).',
        },
        platform: {
          type: 'string',
          enum: ['instagram', 'facebook', 'youtube', 'x'],
          description: 'Optional platform filter.',
        },
        account_id: {
          type: 'string',
          description: 'Optional connection ID filter.',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 100,
          description: 'Max records to return (default 25).',
        },
        offset: {
          type: 'integer',
          minimum: 0,
          description: 'Pagination offset (default 0).',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'driftpost_get_post_history',
    description: 'List recently published posts in Driftpost (compact summary).',
    inputSchema: {
      type: 'object',
      properties: {
        platform: {
          type: 'string',
          enum: ['instagram', 'facebook', 'youtube', 'x'],
          description: 'Optional platform filter.',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 50,
          description: 'Max records to return (default 20).',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'driftpost_get_failed_posts',
    description: 'List failed posts in Driftpost along with their exact error messages so you can diagnose and fix issues.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 50,
          description: 'Max records to return (default 20).',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'driftpost_list_automations',
    description:
      'List the user\'s configured comment, DM, or Google Business review automations in Driftpost (compact summary).',
    inputSchema: {
      type: 'object',
      properties: {
        platform: {
          type: 'string',
          enum: ['instagram', 'facebook', 'google-business'],
          description: 'Platform to inspect automations for.',
        },
      },
      required: ['platform'],
      additionalProperties: false,
    },
  },
  {
    name: 'driftpost_publish_post',
    description:
      'Publish a video, image, carousel, or text post immediately to one or more connected Driftpost accounts using captions and titles you generate.',
    inputSchema: {
      type: 'object',
      properties: {
        account_ids: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          description: 'One or more connection IDs returned by driftpost_list_accounts or driftpost_search_accounts.',
        },
        caption: {
          type: 'string',
          description: 'Default post caption / description.',
        },
        platform_captions: {
          type: 'object',
          properties: {
            instagram: { type: 'string' },
            facebook: { type: 'string' },
            youtube: { type: 'string' },
            x: { type: 'string' },
          },
          description: 'Optional per-platform caption overrides.',
          additionalProperties: false,
        },
        title: {
          type: 'string',
          description: 'Video title (recommended for YouTube).',
        },
        media_url: {
          type: 'string',
          description: 'Optional direct HTTPS URL to a single video or image file.',
        },
        media_urls: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 10,
          description: 'Optional array of HTTPS image URLs for a carousel post.',
        },
        media_filename: {
          type: 'string',
          description: 'Optional filename for single media (e.g. "reel.mp4").',
        },
        instagram_collaborators: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 3,
          description: 'Optional up to 3 Instagram collaborator handles (without @).',
        },
        instagram_post_story: {
          type: 'boolean',
          description: 'Optional: also cross-post to Instagram Story.',
        },
        youtube_privacy: {
          type: 'string',
          enum: ['public', 'unlisted', 'private'],
          description: 'YouTube privacy status (defaults to "public").',
        },
        idempotency_key: {
          type: 'string',
          description: 'Optional unique key to prevent accidental duplicate publishing.',
        },
      },
      required: ['account_ids', 'caption'],
      additionalProperties: false,
    },
  },
  {
    name: 'driftpost_schedule_post',
    description:
      'Schedule a video, image, or text post to publish automatically at a future date/time (ISO-8601 UTC timestamp).',
    inputSchema: {
      type: 'object',
      properties: {
        account_ids: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          description: 'One or more connection IDs.',
        },
        scheduled_for: {
          type: 'string',
          description: 'Future ISO-8601 timestamp (e.g. "2026-11-28T14:30:00Z").',
        },
        caption: {
          type: 'string',
          description: 'Post caption / description.',
        },
        title: {
          type: 'string',
          description: 'Optional video title (for YouTube).',
        },
        media_url: {
          type: 'string',
          description: 'Optional direct HTTPS URL to a video or image.',
        },
        youtube_privacy: {
          type: 'string',
          enum: ['public', 'unlisted', 'private'],
          description: 'YouTube privacy status (defaults to "public").',
        },
      },
      required: ['account_ids', 'scheduled_for', 'caption'],
      additionalProperties: false,
    },
  },
  {
    name: 'driftpost_cancel_scheduled_post',
    description: 'Cancel an upcoming scheduled post by its post ID.',
    inputSchema: {
      type: 'object',
      properties: {
        post_id: {
          type: 'string',
          description: 'Scheduled post ID from driftpost_list_scheduled_posts.',
        },
      },
      required: ['post_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'driftpost_get_publish_status',
    description: 'Check the status and result of a Driftpost background publishing job.',
    inputSchema: {
      type: 'object',
      properties: {
        job_id: {
          type: 'string',
          description: 'Job ID returned by driftpost_publish_post.',
        },
      },
      required: ['job_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'driftpost_list_permissions',
    description: 'Inspect the granted scopes and available capabilities of the current Driftpost MCP connection.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
];

async function resolveMcpUser(req, supabase) {
  const header = String(req.get('authorization') || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return null;
  const token = match[1].trim();
  if (!token) return null;

  if (token.startsWith('dpm_')) {
    const found = await findMcpAccessToken(supabase, token);
    if (!found) return null;
    return { userId: found.userId, token, scopes: found.scopes || [...MCP_SCOPES] };
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user?.id) return null;
  return { userId: data.user.id, token, scopes: [...MCP_SCOPES] };
}

async function internalApi(port, path, token, options = {}) {
  const url = `http://127.0.0.1:${port}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(json?.error || `Driftpost API returned ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

async function fetchFormattedAccounts(port, token) {
  const data = await internalApi(port, '/api/connections', token);
  const raw = Array.isArray(data.connections) ? data.connections : Array.isArray(data) ? data : [];
  return raw.map(formatAccount);
}

async function executeMcpTool(name, args, auth, port) {
  const safeArgs = args && typeof args === 'object' ? args : {};

  if (name === 'driftpost_list_permissions') {
    return {
      connected: true,
      scopes: auth.scopes || [...MCP_SCOPES],
      tools: MCP_TOOLS.map((t) => t.name),
    };
  }

  if (name === 'driftpost_list_accounts') {
    let list = await fetchFormattedAccounts(port, auth.token);
    if (safeArgs.platform) {
      list = list.filter((c) => c.platform === safeArgs.platform);
    }
    return { total: list.length, accounts: list };
  }

  if (name === 'driftpost_search_accounts') {
    const q = String(safeArgs.query || '').trim().toLowerCase();
    if (!q) throw new Error('query is required.');
    let list = await fetchFormattedAccounts(port, auth.token);
    if (safeArgs.platform) {
      list = list.filter((c) => c.platform === safeArgs.platform);
    }
    const matches = list.filter((c) => {
      const hay = `${c.name || ''} ${c.username || ''} ${c.platform || ''}`.toLowerCase();
      return hay.includes(q);
    });
    return { query: safeArgs.query, total: matches.length, accounts: matches };
  }

  if (name === 'driftpost_get_brand_profile') {
    const brandName = String(safeArgs.brand_name || '').trim();
    if (!brandName) throw new Error('brand_name is required.');
    const mem = await import('./brand-memory/index.js');
    const hit = mem.resolveBrand(brandName, 15);
    if (!hit?.brand) {
      return { found: false, message: `No saved brand profile matched "${brandName}".` };
    }
    const b = hit.brand;
    const deep = mem.getDeepForCompact?.(b) || mem.getDeepBrand?.(b.id) || null;
    const footer = mem.deepFooter?.(deep) || b.footer || [];
    return {
      found: true,
      brand: {
        id: b.id,
        name: b.name,
        category: b.cat || deep?.business?.category || null,
        location: b.loc || deep?.business?.city || null,
        instagram: b.ig || deep?.social_media?.instagram_handle || null,
        footer,
        keywords: Array.isArray(b.kw) ? b.kw.slice(0, 15) : [],
        tone: deep?.writing_direction?.tone || null,
      },
    };
  }

  if (name === 'driftpost_list_automations') {
    const platform = String(safeArgs.platform || 'instagram');
    const path =
      platform === 'google-business'
        ? '/api/automations/google-business'
        : `/api/automations/${encodeURIComponent(platform)}`;
    const data = await internalApi(port, path, auth.token);
    const items = platform === 'google-business'
      ? (data.locations || []).map((loc) => ({
          id: loc.id,
          name: loc.location_name,
          enabled: Boolean(loc.enabled),
          mode: loc.rules?.mode || 'default',
          minimum_rating: loc.rules?.minimum_rating || 1,
        }))
      : (data.accounts || []).map((acct) => ({
          id: acct.id,
          name: acct.name,
          enabled: Boolean(acct.enabled),
          public_reply_enabled: Boolean(acct.rules?.public_reply_enabled),
          comment_dm_enabled: Boolean(acct.rules?.comment_enabled),
          comment_keyword: acct.rules?.comment_keyword || '',
          excluded_words: acct.rules?.excluded_words || '',
        }));
    return {
      platform,
      total: items.length,
      enabled_count: items.filter((i) => i.enabled).length,
      items,
    };
  }

  if (
    name === 'driftpost_list_scheduled_posts'
    || name === 'driftpost_get_post_history'
    || name === 'driftpost_get_failed_posts'
  ) {
    const [schedData, accounts] = await Promise.all([
      internalApi(port, '/api/schedules', auth.token),
      fetchFormattedAccounts(port, auth.token).catch(() => []),
    ]);
    const accountMap = new Map(accounts.map((a) => [a.id, a]));
    const rawList = Array.isArray(schedData.schedules)
      ? schedData.schedules
      : Array.isArray(schedData)
        ? schedData
        : [];

    const requestedStatus = name === 'driftpost_get_post_history'
      ? 'published'
      : name === 'driftpost_get_failed_posts'
        ? 'failed'
        : String(safeArgs.status || 'scheduled');

    const nowMs = Date.now();
    let filtered = rawList.filter((row) => {
      if (requestedStatus !== 'all' && row.status !== requestedStatus) return false;
      if (name === 'driftpost_list_scheduled_posts' && requestedStatus === 'scheduled') {
        const ts = Date.parse(row.scheduled_at || '');
        if (Number.isFinite(ts) && ts < nowMs - 5 * 60 * 1000) return false;
      }
      if (safeArgs.platform && row.platform !== safeArgs.platform) return false;
      if (safeArgs.account_id && row.connection_id !== safeArgs.account_id) return false;
      return true;
    });

    const total = filtered.length;
    const offset = Math.max(0, Number(safeArgs.offset) || 0);
    const defaultLimit = name === 'driftpost_list_scheduled_posts' ? 25 : 20;
    const limit = Math.max(1, Math.min(100, Number(safeArgs.limit) || defaultLimit));
    filtered = filtered.slice(offset, offset + limit);

    return {
      status_filter: requestedStatus,
      total,
      returned: filtered.length,
      next_offset: offset + filtered.length < total ? offset + filtered.length : null,
      posts: filtered.map((row) => formatCompactSchedule(row, accountMap)),
    };
  }

  if (name === 'driftpost_cancel_scheduled_post') {
    const postId = String(safeArgs.post_id || '').trim();
    if (!postId) throw new Error('post_id is required.');
    await internalApi(port, `/api/schedules/${encodeURIComponent(postId)}`, auth.token, {
      method: 'DELETE',
    });
    return { ok: true, cancelled_post_id: postId };
  }

  if (name === 'driftpost_get_publish_status') {
    const jobId = String(safeArgs.job_id || '').trim();
    if (!jobId) throw new Error('job_id is required.');
    return await internalApi(port, `/api/jobs/${encodeURIComponent(jobId)}`, auth.token);
  }

  if (name === 'driftpost_publish_post' || name === 'driftpost_schedule_post') {
    const isSchedule = name === 'driftpost_schedule_post';
    const accountIds = Array.isArray(safeArgs.account_ids)
      ? safeArgs.account_ids.map((id) => String(id).trim()).filter(Boolean)
      : [];
    if (!accountIds.length) throw new Error('At least one account_id is required.');
    const defaultCaption = String(safeArgs.caption || '').trim();
    const platformCaptions = safeArgs.platform_captions && typeof safeArgs.platform_captions === 'object'
      ? safeArgs.platform_captions
      : {};
    const title = String(safeArgs.title || '').trim();
    const privacy = String(safeArgs.youtube_privacy || safeArgs.privacy || 'public').trim();
    const scheduledFor = isSchedule ? String(safeArgs.scheduled_for || '').trim() : '';
    if (isSchedule && (!scheduledFor || !Number.isFinite(Date.parse(scheduledFor)))) {
      throw new Error('scheduled_for must be a valid future ISO-8601 timestamp.');
    }

    const accounts = await fetchFormattedAccounts(port, auth.token);
    const byId = new Map(accounts.map((c) => [c.id, c]));

    const mediaUrls = Array.isArray(safeArgs.media_urls) && safeArgs.media_urls.length
      ? safeArgs.media_urls.slice(0, 10)
      : safeArgs.media_url
        ? [safeArgs.media_url]
        : [];
    const downloadedMedia = [];
    for (let i = 0; i < mediaUrls.length; i++) {
      downloadedMedia.push(
        await downloadSafeMedia(mediaUrls[i], i === 0 ? safeArgs.media_filename : '')
      );
    }

    const extraHeaders = {};
    if (safeArgs.idempotency_key) {
      extraHeaders['Idempotency-Key'] = String(safeArgs.idempotency_key).trim().slice(0, 128);
    }

    const results = [];
    for (const accountId of accountIds) {
      const conn = byId.get(accountId);
      if (!conn) {
        results.push({ account_id: accountId, ok: false, error: 'Account not found' });
        continue;
      }
      const captionForPlatform = String(platformCaptions[conn.platform] || defaultCaption).trim();
      const form = new FormData();
      form.append('platform', conn.platform);
      form.append('connection_id', conn.id);
      form.append('caption', captionForPlatform);
      form.append('text', captionForPlatform);
      if (conn.platform === 'instagram') {
        form.append('ig_caption', captionForPlatform);
        if (Array.isArray(safeArgs.instagram_collaborators) && safeArgs.instagram_collaborators.length) {
          const handles = safeArgs.instagram_collaborators
            .map((h) => String(h || '').trim().replace(/^@+/, ''))
            .filter(Boolean)
            .slice(0, 3);
          if (handles.length) {
            form.append('ig_collabs_enabled', '1');
            form.append('ig_collabs', handles.join(','));
          }
        }
        if (safeArgs.instagram_post_story === true) {
          form.append('ig_post_story', '1');
        }
      } else if (conn.platform === 'facebook') {
        form.append('fb_message', captionForPlatform);
      } else if (conn.platform === 'youtube') {
        if (title) form.append('yt_title', title.slice(0, 100));
        form.append('yt_description', captionForPlatform);
        form.append('yt_privacy', privacy);
      } else if (conn.platform === 'x') {
        form.append('x_text', captionForPlatform.slice(0, 280));
      }
      if (title) form.append('title', title);
      if (privacy) form.append('privacy', privacy);
      if (isSchedule) form.append('scheduled_at', new Date(scheduledFor).toISOString());
      for (const item of downloadedMedia) {
        form.append('media', item.blob, item.filename);
      }

      try {
        const endpoint = isSchedule ? '/api/schedule' : '/api/publish';
        const pubRes = await internalApi(port, endpoint, auth.token, {
          method: 'POST',
          headers: extraHeaders,
          body: form,
        });
        results.push({
          account_id: conn.id,
          platform: conn.platform,
          account_name: conn.name,
          ok: true,
          ...pubRes,
        });
      } catch (err) {
        results.push({
          account_id: conn.id,
          platform: conn.platform,
          account_name: conn.name,
          ok: false,
          error: err.message,
        });
      }
    }

    return { results };
  }

  throw new Error(`Unknown tool: ${name}`);
}

export function registerMcpRoutes(app, { supabase, port }) {
  // 1. OAuth 2.1 Protected Resource Metadata (RFC 9728 — required by ChatGPT Connectors)
  const protectedResourceHandler = (req, res) => {
    const origin = getPublicOrigin(req);
    res.json({
      resource: `${origin}/mcp`,
      authorization_servers: [origin],
      bearer_methods_supported: ['header'],
      scopes_supported: [...MCP_SCOPES],
    });
  };
  app.get('/.well-known/oauth-protected-resource', protectedResourceHandler);
  app.get('/.well-known/oauth-protected-resource/mcp', protectedResourceHandler);

  // 2. OAuth 2.1 Authorization Server Metadata (RFC 8414)
  app.get('/.well-known/oauth-authorization-server', (req, res) => {
    const origin = getPublicOrigin(req);
    res.json({
      issuer: origin,
      authorization_endpoint: `${origin}/oauth/authorize`,
      token_endpoint: `${origin}/oauth/token`,
      registration_endpoint: `${origin}/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_post'],
      scopes_supported: [...MCP_SCOPES],
    });
  });

  // 3. Dynamic Client Registration (RFC 7591 — used by ChatGPT & MCP clients)
  app.post('/oauth/register', (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const clientId = `dp_client_${crypto.randomBytes(16).toString('base64url')}`;
    const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris : [];
    const client = {
      client_id: clientId,
      client_name: String(body.client_name || 'AI Assistant').slice(0, 120),
      redirect_uris: redirectUris,
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
    if (registeredClients.size >= 500) {
      const firstKey = registeredClients.keys().next().value;
      if (firstKey) registeredClients.delete(firstKey);
    }
    registeredClients.set(clientId, client);
    res.status(201).json(client);
  });

  // 4. OAuth 2.1 Authorization — redirects to Driftpost frontend so Google OAuth
  // runs on the official Supabase Site URL (https://driftpostpage.vercel.app) with account selection.
  app.get('/oauth/authorize', (req, res) => {
    const clientId = String(req.query.client_id || '');
    const redirectUri = String(req.query.redirect_uri || '');
    const state = String(req.query.state || '');
    const codeChallenge = String(req.query.code_challenge || '');
    const codeChallengeMethod = String(req.query.code_challenge_method || 'S256');
    const scope = String(req.query.scope || MCP_SCOPES.join(' '));
    if (!redirectUri || !/^https?:\/\//i.test(redirectUri)) {
      return res.status(400).send('Missing or invalid redirect_uri.');
    }
    const frontend = String(process.env.FRONTEND_URL || 'https://driftpostpage.vercel.app')
      .split(',')[0]
      .trim()
      .replace(/\/$/, '') || 'https://driftpostpage.vercel.app';
    const target = new URL(frontend);
    target.searchParams.set('mcp_oauth', '1');
    if (clientId) target.searchParams.set('client_id', clientId);
    target.searchParams.set('redirect_uri', redirectUri);
    if (state) target.searchParams.set('state', state);
    if (codeChallenge) target.searchParams.set('code_challenge', codeChallenge);
    if (codeChallengeMethod) target.searchParams.set('code_challenge_method', codeChallengeMethod);
    if (scope) target.searchParams.set('scope', scope);
    return res.redirect(302, target.toString());
  });

  // 4a. Frontend approval endpoint: exchanges the user's active Supabase session on
  // driftpostpage.vercel.app for an OAuth 2.1 authorization code and redirects back to ChatGPT.
  app.post('/api/mcp/oauth/approve', async (req, res) => {
    const auth = await resolveMcpUser(req, supabase);
    if (!auth) {
      return res.status(401).json({ error: 'Please sign in with Google first.' });
    }
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const clientId = String(body.client_id || '');
    const redirectUri = String(body.redirect_uri || '');
    const state = String(body.state || '');
    const codeChallenge = String(body.code_challenge || '');
    const codeChallengeMethod = String(body.code_challenge_method || 'S256');

    if (!redirectUri || !/^https?:\/\//i.test(redirectUri)) {
      return res.status(400).json({ error: 'Invalid redirect_uri.' });
    }

    const now = Date.now();
    for (const [k, v] of oauthCodes.entries()) {
      if (v.expiresAt <= now) oauthCodes.delete(k);
    }
    const code = `dpcode_${crypto.randomBytes(24).toString('base64url')}`;
    oauthCodes.set(code, {
      userId: auth.userId,
      clientId,
      redirectUri,
      codeChallenge,
      codeChallengeMethod,
      expiresAt: Date.now() + OAUTH_CODE_TTL_MS,
    });

    const target = new URL(redirectUri);
    target.searchParams.set('code', code);
    if (state) target.searchParams.set('state', state);
    return res.json({ ok: true, redirect_to: target.toString() });
  });

  // 5. OAuth 2.1 Token Endpoint
  app.post('/oauth/token', async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const grantType = String(body.grant_type || '');
    const code = String(body.code || '');
    const redirectUri = String(body.redirect_uri || '');
    const codeVerifier = String(body.code_verifier || '');

    if (grantType !== 'authorization_code') {
      return res.status(400).json({ error: 'unsupported_grant_type' });
    }
    const entry = oauthCodes.get(code);
    oauthCodes.delete(code);
    if (!entry || entry.expiresAt <= Date.now()) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'Authorization code expired or invalid.' });
    }
    if (entry.redirectUri && redirectUri && entry.redirectUri !== redirectUri) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'redirect_uri mismatch.' });
    }
    if (!verifyPkce(codeVerifier, entry.codeChallenge, entry.codeChallengeMethod)) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE verification failed.' });
    }

    const accessToken = `dpm_${crypto.randomBytes(32).toString('base64url')}`;
    const expiresAt = new Date(Date.now() + MCP_TOKEN_TTL_MS).toISOString();
    const { error } = await supabase.from('mcp_access_tokens').insert({
      user_id: entry.userId,
      token_hash: hashMcpSecret(accessToken),
      scopes: [...MCP_SCOPES],
      expires_at: expiresAt,
    });
    if (error) {
      return res.status(500).json({ error: 'server_error', error_description: error.message });
    }

    return res.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: Math.floor(MCP_TOKEN_TTL_MS / 1000),
      scope: MCP_SCOPES.join(' '),
    });
  });

  // 6. Streamable HTTP MCP Endpoint (/mcp)
  app.post('/mcp', async (req, res) => {
    const origin = getPublicOrigin(req);
    const auth = await resolveMcpUser(req, supabase);
    if (!auth) {
      res.setHeader(
        'WWW-Authenticate',
        `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`
      );
      return res.status(401).json({
        jsonrpc: '2.0',
        error: { code: -32001, message: 'Unauthorized. Complete OAuth or provide a Bearer token.' },
        id: req.body?.id ?? null,
      });
    }

    const msg = req.body && typeof req.body === 'object' ? req.body : {};
    const { id = null, method = '', params = {} } = msg;

    if (method === 'notifications/initialized') {
      return res.status(202).end();
    }

    if (method === 'ping') {
      return res.json({ jsonrpc: '2.0', id, result: {} });
    }

    if (method === 'initialize') {
      return res.json({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2025-03-26',
          capabilities: { tools: {} },
          serverInfo: { name: 'driftpost', version: '2.0.0' },
        },
      });
    }

    if (method === 'tools/list') {
      return res.json({
        jsonrpc: '2.0',
        id,
        result: { tools: MCP_TOOLS },
      });
    }

    if (method === 'tools/call') {
      const toolName = String(params?.name || '');
      const toolArgs = params?.arguments || {};
      try {
        const result = await executeMcpTool(toolName, toolArgs, auth, port);
        return res.json({
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          },
        });
      } catch (err) {
        const isPerm = err?.status === 403 || /not allowed|permission|scope/i.test(String(err?.message || ''));
        return res.json({
          jsonrpc: '2.0',
          id,
          result: {
            isError: true,
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    error_code: isPerm ? 'PERMISSION_DENIED' : 'TOOL_ERROR',
                    message: err.message || 'Tool execution failed.',
                    ...(isPerm
                      ? { hint: 'Disconnect and reconnect the Driftpost connector to refresh granted scopes.' }
                      : {}),
                  },
                  null,
                  2
                ),
              },
            ],
          },
        });
      }
    }

    return res.json({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` },
    });
  });

  app.get('/mcp', (_req, res) => {
    res.status(405).json({ error: 'Use POST /mcp for Streamable HTTP MCP requests.' });
  });

  app.delete('/mcp', (_req, res) => {
    res.status(200).json({ ok: true });
  });
}
