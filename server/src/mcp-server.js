import crypto from 'node:crypto';
import { MCP_SCOPES, MCP_TOKEN_TTL_MS, findMcpAccessToken, hashMcpSecret } from './mcp-auth.js';

const OAUTH_CODE_TTL_MS = 10 * 60 * 1000;
const oauthCodes = new Map();
const pendingGoogleAuth = new Map();
const registeredClients = new Map();

function getPublicOrigin(req) {
  const configured = String(process.env.PUBLIC_API_URL || process.env.API_PUBLIC_URL || '').trim().replace(/\/$/, '');
  if (configured) return configured;
  const proto = String(req.get('x-forwarded-proto') || req.protocol || 'https').split(',')[0].trim();
  const host = String(req.get('x-forwarded-host') || req.get('host') || '').split(',')[0].trim();
  return `${proto}://${host}`;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

function renderAuthorizePage({
  clientId,
  redirectUri,
  state,
  codeChallenge,
  codeChallengeMethod,
  scope,
  error = '',
  email = '',
}) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Connect Driftpost MCP</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 20px;
      background: #090a10; color: #f5f5f7; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .card {
      width: 100%; max-width: 420px; padding: 28px; border-radius: 20px;
      background: rgba(18, 19, 28, 0.92); border: 1px solid rgba(167, 139, 250, 0.25);
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
    }
    h1 { margin: 0 0 8px; font-size: 22px; letter-spacing: -0.02em; }
    p { margin: 0 0 18px; font-size: 13.5px; color: rgba(235, 235, 245, 0.68); line-height: 1.5; }
    label { display: block; font-size: 12px; font-weight: 600; color: rgba(235, 235, 245, 0.75); margin-bottom: 6px; }
    input[type="email"], input[type="password"] {
      width: 100%; padding: 11px 13px; margin-bottom: 14px; border-radius: 12px;
      border: 1px solid rgba(255,255,255,0.12); background: #0d0e16; color: #fff; font-size: 14px; outline: none;
    }
    input:focus { border-color: #7c6df2; }
    .err {
      padding: 10px 12px; border-radius: 10px; margin-bottom: 14px; font-size: 13px;
      background: rgba(255, 69, 58, 0.14); border: 1px solid rgba(255, 69, 58, 0.35); color: #ff6961;
    }
    button {
      width: 100%; padding: 12px 16px; border: 0; border-radius: 999px; cursor: pointer;
      background: linear-gradient(135deg, #7c6df2 0%, #6366f1 100%); color: #fff; font-size: 14px; font-weight: 600;
    }
    button:hover { filter: brightness(1.08); }
    .google-btn {
      display: flex; align-items: center; justify-content: center; gap: 10px;
      width: 100%; padding: 12px 16px; border-radius: 999px; text-decoration: none;
      background: #fff; color: #111; font-size: 14px; font-weight: 600; margin-bottom: 16px;
    }
    .google-btn:hover { background: #f2f2f7; }
    .divider {
      display: flex; align-items: center; gap: 10px; margin: 4px 0 16px;
      font-size: 12px; color: rgba(235, 235, 245, 0.45);
    }
    .divider::before, .divider::after { content: ""; flex: 1; height: 1px; background: rgba(255,255,255,0.1); }
    .scopes { font-size: 12px; color: rgba(235,235,245,0.5); margin-top: 14px; text-align: center; }
  </style>
</head>
<body>
  <form class="card" method="POST" action="/oauth/authorize">
    <h1>Connect Driftpost</h1>
    <p>Sign in with your Driftpost account to allow your AI assistant (ChatGPT, Claude, etc.) to list your connected accounts, view schedules, and publish posts.</p>
    ${error ? `<div class="err">${escapeHtml(error)}</div>` : ''}
    <a class="google-btn" href="/oauth/google/start?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}&code_challenge=${encodeURIComponent(codeChallenge)}&code_challenge_method=${encodeURIComponent(codeChallengeMethod)}">
      <svg width="18" height="18" viewBox="0 0 24 24"><path d="M21.805 10.023H12v3.955h5.617c-.242 1.298-.977 2.398-2.082 3.133v2.602h3.367c1.97-1.813 3.103-4.484 3.103-7.656 0-.68-.062-1.355-.2-2.034z" fill="#4285F4"/><path d="M12 22c2.81 0 5.168-.93 6.891-2.518l-3.367-2.602c-.934.625-2.129.996-3.524.996-2.711 0-5.008-1.832-5.828-4.293H2.695v2.688C4.41 19.676 7.93 22 12 22z" fill="#34A853"/><path d="M6.172 13.583A5.97 5.97 0 0 1 5.852 12c0-.551.098-1.086.32-1.583V7.729H2.695A9.996 9.996 0 0 0 2 12c0 1.613.387 3.141 1.07 4.488l3.102-2.905z" fill="#FBBC05"/><path d="M12 6.125c1.527 0 2.898.523 3.977 1.555l2.984-2.984C17.164 3.016 14.805 2 12 2 7.93 2 4.41 4.324 2.695 7.729l3.477 2.688C6.992 7.957 9.289 6.125 12 6.125z" fill="#EA4335"/></svg>
      Continue with Google
    </a>
    <div class="divider">or sign in with email</div>
    <input type="hidden" name="client_id" value="${escapeHtml(clientId)}" />
    <input type="hidden" name="redirect_uri" value="${escapeHtml(redirectUri)}" />
    <input type="hidden" name="state" value="${escapeHtml(state)}" />
    <input type="hidden" name="code_challenge" value="${escapeHtml(codeChallenge)}" />
    <input type="hidden" name="code_challenge_method" value="${escapeHtml(codeChallengeMethod)}" />
    <input type="hidden" name="scope" value="${escapeHtml(scope)}" />
    <label for="email">Driftpost Email</label>
    <input id="email" name="email" type="email" required autocomplete="email" value="${escapeHtml(email)}" placeholder="you@example.com" />
    <label for="password">Password</label>
    <input id="password" name="password" type="password" required autocomplete="current-password" placeholder="••••••••" />
    <button type="submit">Sign in &amp; Authorize Driftpost</button>
    <div class="scopes">Permissions: accounts, media upload, publish &amp; schedule posts</div>
  </form>
</body>
</html>`;
}

const MCP_TOOLS = [
  {
    name: 'driftpost_list_accounts',
    description:
      'List all connected social media accounts in the user\'s Driftpost workspace (Instagram, Facebook, YouTube, X) with their account IDs, platform, and display names. Always call this first before publishing so you can pick the right account_id.',
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
    name: 'driftpost_list_automations',
    description:
      'List the user\'s configured comment, DM, or Google Business review automations in Driftpost.',
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
    name: 'driftpost_list_scheduled_posts',
    description: 'List upcoming scheduled posts in the user\'s Driftpost calendar.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: 'driftpost_publish_post',
    description:
      'Publish a video, image, or text post to one or more connected Driftpost accounts using captions and titles you generate. Pass media_url (a direct HTTPS URL to a video or image) to attach media.',
    inputSchema: {
      type: 'object',
      properties: {
        account_ids: {
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          description: 'One or more connection IDs returned by driftpost_list_accounts.',
        },
        caption: {
          type: 'string',
          description: 'Post caption / description (including hashtags if appropriate).',
        },
        title: {
          type: 'string',
          description: 'Optional video title (recommended for YouTube).',
        },
        media_url: {
          type: 'string',
          description: 'Optional direct HTTPS URL to a video or image file to upload and publish.',
        },
        media_filename: {
          type: 'string',
          description: 'Optional filename for the media (e.g. "reel.mp4" or "photo.jpg").',
        },
        privacy: {
          type: 'string',
          enum: ['public', 'unlisted', 'private'],
          description: 'Optional YouTube privacy status (defaults to public).',
        },
      },
      required: ['account_ids', 'caption'],
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
    return { userId: found.userId, token };
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user?.id) return null;
  return { userId: data.user.id, token };
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
    throw new Error(json?.error || `Driftpost API returned ${res.status}`);
  }
  return json;
}

async function executeMcpTool(name, args, auth, port) {
  const safeArgs = args && typeof args === 'object' ? args : {};

  if (name === 'driftpost_list_accounts') {
    const data = await internalApi(port, '/api/connections', auth.token);
    let list = Array.isArray(data.connections) ? data.connections : Array.isArray(data) ? data : [];
    if (safeArgs.platform) {
      list = list.filter((c) => c.platform === safeArgs.platform);
    }
    return {
      accounts: list.map((c) => ({
        id: c.id,
        platform: c.platform,
        name: c.account_name || c.name || c.username || c.id,
        username: c.username || null,
      })),
    };
  }

  if (name === 'driftpost_list_automations') {
    const platform = String(safeArgs.platform || 'instagram');
    const path =
      platform === 'google-business'
        ? '/api/automations/google-business'
        : `/api/automations/${encodeURIComponent(platform)}`;
    return await internalApi(port, path, auth.token);
  }

  if (name === 'driftpost_list_scheduled_posts') {
    return await internalApi(port, '/api/schedules', auth.token);
  }

  if (name === 'driftpost_get_publish_status') {
    const jobId = String(safeArgs.job_id || '').trim();
    if (!jobId) throw new Error('job_id is required.');
    return await internalApi(port, `/api/jobs/${encodeURIComponent(jobId)}`, auth.token);
  }

  if (name === 'driftpost_publish_post') {
    const accountIds = Array.isArray(safeArgs.account_ids)
      ? safeArgs.account_ids.map((id) => String(id).trim()).filter(Boolean)
      : [];
    if (!accountIds.length) throw new Error('At least one account_id is required.');
    const caption = String(safeArgs.caption || '').trim();
    const title = String(safeArgs.title || '').trim();
    const privacy = String(safeArgs.privacy || 'public').trim();

    const connData = await internalApi(port, '/api/connections', auth.token);
    const allConns = Array.isArray(connData.connections)
      ? connData.connections
      : Array.isArray(connData)
        ? connData
        : [];
    const byId = new Map(allConns.map((c) => [c.id, c]));

    let downloadedBlob = null;
    let downloadedName = String(safeArgs.media_filename || '').trim();
    if (safeArgs.media_url) {
      const mediaUrl = String(safeArgs.media_url).trim();
      if (!/^https?:\/\//i.test(mediaUrl)) {
        throw new Error('media_url must be a valid http(s) URL.');
      }
      const mediaRes = await fetch(mediaUrl);
      if (!mediaRes.ok) {
        throw new Error(`Could not download media_url (HTTP ${mediaRes.status}).`);
      }
      const contentType = mediaRes.headers.get('content-type') || 'application/octet-stream';
      const arrayBuf = await mediaRes.arrayBuffer();
      if (arrayBuf.byteLength > 250 * 1024 * 1024) {
        throw new Error('Media file exceeds 250MB limit.');
      }
      downloadedBlob = new Blob([arrayBuf], { type: contentType });
      if (!downloadedName) {
        const ext = contentType.includes('mp4')
          ? 'mp4'
          : contentType.includes('quicktime')
            ? 'mov'
            : contentType.includes('png')
              ? 'png'
              : contentType.includes('jpeg') || contentType.includes('jpg')
                ? 'jpg'
                : 'mp4';
        downloadedName = `driftpost-media.${ext}`;
      }
    }

    const results = [];
    for (const accountId of accountIds) {
      const conn = byId.get(accountId);
      if (!conn) {
        results.push({ account_id: accountId, ok: false, error: 'Account not found' });
        continue;
      }
      const form = new FormData();
      form.append('platform', conn.platform);
      form.append('connection_id', conn.id);
      form.append('caption', caption);
      if (title) form.append('title', title);
      if (privacy) form.append('privacy', privacy);
      if (downloadedBlob) {
        form.append('media', downloadedBlob, downloadedName);
      }
      try {
        const pubRes = await internalApi(port, '/api/publish', auth.token, {
          method: 'POST',
          body: form,
        });
        results.push({
          account_id: conn.id,
          platform: conn.platform,
          account_name: conn.account_name || conn.name || conn.id,
          ok: true,
          ...pubRes,
        });
      } catch (err) {
        results.push({
          account_id: conn.id,
          platform: conn.platform,
          account_name: conn.account_name || conn.name || conn.id,
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
    registeredClients.set(clientId, client);
    res.status(201).json(client);
  });

  // 4. OAuth 2.1 Authorization UI (GET + POST)
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
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'unsafe-inline'; form-action 'self'");
    return res.send(
      renderAuthorizePage({
        clientId,
        redirectUri,
        state,
        codeChallenge,
        codeChallengeMethod,
        scope,
      })
    );
  });

  app.post('/oauth/authorize', async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const clientId = String(body.client_id || '');
    const redirectUri = String(body.redirect_uri || '');
    const state = String(body.state || '');
    const codeChallenge = String(body.code_challenge || '');
    const codeChallengeMethod = String(body.code_challenge_method || 'S256');
    const scope = String(body.scope || MCP_SCOPES.join(' '));
    const email = String(body.email || '').trim();
    const password = String(body.password || '');

    if (!redirectUri || !/^https?:\/\//i.test(redirectUri)) {
      return res.status(400).send('Invalid redirect_uri.');
    }

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error || !data?.user?.id) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.status(401).send(
          renderAuthorizePage({
            clientId,
            redirectUri,
            state,
            codeChallenge,
            codeChallengeMethod,
            scope,
            email,
            error: error?.message || 'Invalid email or password.',
          })
        );
      }

      const code = `dpcode_${crypto.randomBytes(24).toString('base64url')}`;
      oauthCodes.set(code, {
        userId: data.user.id,
        clientId,
        redirectUri,
        codeChallenge,
        codeChallengeMethod,
        expiresAt: Date.now() + OAUTH_CODE_TTL_MS,
      });

      const target = new URL(redirectUri);
      target.searchParams.set('code', code);
      if (state) target.searchParams.set('state', state);
      return res.redirect(302, target.toString());
    } catch (err) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.status(500).send(
        renderAuthorizePage({
          clientId,
          redirectUri,
          state,
          codeChallenge,
          codeChallengeMethod,
          scope,
          email,
          error: err.message || 'Sign in failed.',
        })
      );
    }
  });

  // 4b. Continue with Google (via Supabase Auth)
  app.get('/oauth/google/start', (req, res) => {
    const clientId = String(req.query.client_id || '');
    const redirectUri = String(req.query.redirect_uri || '');
    const state = String(req.query.state || '');
    const codeChallenge = String(req.query.code_challenge || '');
    const codeChallengeMethod = String(req.query.code_challenge_method || 'S256');
    if (!redirectUri || !/^https?:\/\//i.test(redirectUri)) {
      return res.status(400).send('Invalid redirect_uri.');
    }
    const supabaseUrl = String(process.env.SUPABASE_URL || '').trim().replace(/\/$/, '');
    if (!supabaseUrl) {
      return res.status(500).send('SUPABASE_URL is not configured on the server.');
    }
    const reqId = `dpg_${crypto.randomBytes(18).toString('base64url')}`;
    pendingGoogleAuth.set(reqId, {
      clientId,
      redirectUri,
      state,
      codeChallenge,
      codeChallengeMethod,
      expiresAt: Date.now() + OAUTH_CODE_TTL_MS,
    });
    const origin = getPublicOrigin(req);
    const callbackUrl = `${origin}/oauth/google/callback?req=${encodeURIComponent(reqId)}`;
    const target = `${supabaseUrl}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(callbackUrl)}`;
    return res.redirect(302, target);
  });

  app.get('/oauth/google/callback', (req, res) => {
    const reqId = String(req.query.req || '');
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; form-action 'self'"
    );
    return res.send(`<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><title>Connecting Driftpost…</title></head>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#090a10;color:#f5f5f7;font-family:sans-serif">
  <div id="msg">Completing Google sign-in…</div>
  <form id="f" method="POST" action="/oauth/google/complete" style="display:none">
    <input name="req_id" value="${escapeHtml(reqId)}" />
    <input name="access_token" id="at" value="" />
  </form>
  <script>
    (function () {
      var hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
      var token = hash.get('access_token') || '';
      if (!token) {
        document.getElementById('msg').textContent = 'Google sign-in did not return a session token. Please close this tab and try again.';
        return;
      }
      document.getElementById('at').value = token;
      document.getElementById('f').submit();
    })();
  </script>
</body>
</html>`);
  });

  app.post('/oauth/google/complete', async (req, res) => {
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const reqId = String(body.req_id || '');
    const accessToken = String(body.access_token || '');
    const pending = pendingGoogleAuth.get(reqId);
    pendingGoogleAuth.delete(reqId);
    if (!pending || pending.expiresAt <= Date.now()) {
      return res.status(400).send('Authorization session expired. Please close this tab and reconnect from ChatGPT.');
    }
    const { data, error } = await supabase.auth.getUser(accessToken);
    if (error || !data?.user?.id) {
      return res.status(401).send('Could not verify Google session. Please try again.');
    }
    const code = `dpcode_${crypto.randomBytes(24).toString('base64url')}`;
    oauthCodes.set(code, {
      userId: data.user.id,
      clientId: pending.clientId,
      redirectUri: pending.redirectUri,
      codeChallenge: pending.codeChallenge,
      codeChallengeMethod: pending.codeChallengeMethod,
      expiresAt: Date.now() + OAUTH_CODE_TTL_MS,
    });
    const target = new URL(pending.redirectUri);
    target.searchParams.set('code', code);
    if (pending.state) target.searchParams.set('state', pending.state);
    return res.redirect(302, target.toString());
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
          serverInfo: { name: 'driftpost', version: '1.0.0' },
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
        return res.json({
          jsonrpc: '2.0',
          id,
          result: {
            isError: true,
            content: [{ type: 'text', text: err.message || 'Tool execution failed.' }],
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
