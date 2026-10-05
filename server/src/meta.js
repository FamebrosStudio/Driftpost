import { mediaBlob } from './media-io.js';
// Meta (Facebook + Instagram) via Graph API. No X/Twitter anywhere in Driftpost.
const GRAPH = 'https://graph.facebook.com/v21.0';
// Facebook connect uses regular Login with Page scopes (no review needed in dev).
const FB_SCOPES = [...new Set(`${process.env.META_FB_SCOPES || 'pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish,business_management'},instagram_manage_comments,instagram_manage_messages,instagram_manage_insights`.split(',').map((s) => s.trim()).filter(Boolean))].join(',');
// Instagram connect uses Facebook Login for Business (config_id). Regular Login
// rejects instagram_business_* scopes with "Invalid Scopes".
const SCOPES = FB_SCOPES;

export function metaAuthorizationUrl(state) {
  const p = new URLSearchParams({
    client_id: process.env.META_APP_ID,
    redirect_uri: process.env.META_REDIRECT_URI,
    response_type: 'code',
    scope: SCOPES,
    state,
  });
  return `https://www.facebook.com/v21.0/dialog/oauth?${p}`;
}

export function metaBusinessLoginUrl(state) {
  const p = new URLSearchParams({
    client_id: process.env.META_APP_ID,
    redirect_uri: process.env.META_REDIRECT_URI,
    config_id: process.env.META_CONFIG_ID,
    response_type: 'code',
    state,
  });
  return `https://www.facebook.com/v21.0/dialog/oauth?${p}`;
}

async function graphError(res, fallback, parsedBody) {
  const b = parsedBody || await res.json().catch(() => ({}));
  return new Error(b.error?.message || fallback);
}

export async function exchangeMetaCode(code) {
  const p = new URLSearchParams({
    client_id: process.env.META_APP_ID,
    client_secret: process.env.META_APP_SECRET,
    redirect_uri: process.env.META_REDIRECT_URI,
    code,
  });
  const res = await fetch(`${GRAPH}/oauth/access_token?${p}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Meta token exchange failed');
  return data; // { access_token, expires_in }
}

export async function longLivedToken(shortToken) {
  const p = new URLSearchParams({
    grant_type: 'fb_exchange_token',
    client_id: process.env.META_APP_ID,
    client_secret: process.env.META_APP_SECRET,
    fb_exchange_token: shortToken,
  });
  const res = await fetch(`${GRAPH}/oauth/access_token?${p}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Unable to extend Meta token');
  return data;
}

export async function getMetaPages(userToken) {
  // 1) Personal assets.
  // 2) Business portfolio assets: /me/accounts can omit pages in a business
  //    portfolio. Walk both owned_pages and client_pages so agency-managed
  //    client pages are discoverable as well as pages owned by the portfolio.
  const auth = { headers: { Authorization: `Bearer ${userToken}` } };
  const all = [];
  let url = `${GRAPH}/me/accounts?fields=id,name,tasks,access_token,instagram_business_account{id,username}&limit=100`;
  for (let i = 0; i < 5 && url; i++) {
    const res = await fetch(url, { ...auth, signal: AbortSignal.timeout(30000) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Unable to list Facebook Pages');
    all.push(...(data.data || []));
    url = data.paging?.next || null;
  }
  try {
    const bRes = await fetch(`${GRAPH}/me/businesses?fields=id,name&limit=50`, { ...auth, signal: AbortSignal.timeout(30000) });
    const bData = await bRes.json();
    if (!bRes.ok) throw new Error('no-business-access');
    for (const biz of (bData.data || []).slice(0, 20)) {
      for (const edge of ['owned_pages', 'client_pages']) {
        try {
          const pRes = await fetch(`${GRAPH}/${biz.id}/${edge}?fields=id,name&limit=100`, { ...auth, signal: AbortSignal.timeout(30000) });
          const pData = await pRes.json();
          if (!pRes.ok) continue;
          for (const p of (pData.data || [])) {
            if (all.some((x) => x.id === p.id)) continue;
            try {
              const dRes = await fetch(`${GRAPH}/${p.id}?fields=access_token,instagram_business_account{id,username}`, { ...auth, signal: AbortSignal.timeout(30000) });
              const d = await dRes.json();
              if (dRes.ok && d.access_token) {
                all.push({ id: p.id, name: p.name, access_token: d.access_token, instagram_business_account: d.instagram_business_account || null });
              }
            } catch { /* skip one page, keep the rest */ }
          }
        } catch { /* edge may be unavailable; keep other business assets */ }
      }
    }
  } catch { /* businesses unavailable without business_management: keep personal pages */ }
  // De-duplicate by page id.
  const seen = new Set();
  return all.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
}

export async function publishFacebook({ pageId, pageToken, text, link, linkMeta, targeting, cta, unpublished, media, cover }) {
  // `url` lets Meta fetch large media from Storage/CDN itself, avoiding a
  // second 100-400 MB transfer through the API server. Keep multipart support
  // for legacy uploads and small cover images.
  if (media?.mimetype?.startsWith('video/')) {
    const form = new FormData();
    form.append('description', text || '');
    if (media.url) form.append('file_url', media.url);
    else form.append('source', await mediaBlob(media), media.originalname);
    if (cover?.path) form.append('thumb', await mediaBlob(cover), cover.originalname || 'cover.jpg');
    const res = await fetch(`${GRAPH}/${pageId}/videos?access_token=${encodeURIComponent(pageToken)}`, { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok) throw await graphError(res, 'Facebook video failed', data);
    return { id: data.id, url: `https://www.facebook.com/${pageId}/videos/${data.id}` };
  }
  if (media?.mimetype?.startsWith('image/')) {
    const form = new FormData();
    form.append('caption', text || '');
    if (media.url) form.append('url', media.url);
    else form.append('source', await mediaBlob(media), media.originalname);
    const res = await fetch(`${GRAPH}/${pageId}/photos?access_token=${encodeURIComponent(pageToken)}`, { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok) throw await graphError(res, 'Facebook photo failed', data);
    return { id: data.id, url: `https://www.facebook.com/photo.php?fbid=${data.id}` };
  }
  const feedBody = { message: text, access_token: pageToken };
  if (link) {
    feedBody.link = link;
    if (linkMeta?.name) feedBody.name = linkMeta.name;
    if (linkMeta?.caption) feedBody.caption = linkMeta.caption;
    if (linkMeta?.description) feedBody.description = linkMeta.description;
    if (linkMeta?.picture) feedBody.picture = linkMeta.picture;
    if (cta?.type) {
      feedBody.call_to_action = { type: cta.type, value: { link } };
    }
  }
  if (targeting?.age_min) feedBody.feed_targeting = { age_min: targeting.age_min };
  if (unpublished) feedBody.published = false;
  const res = await fetch(`${GRAPH}/${pageId}/feed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(feedBody),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Facebook post failed');
  return { id: data.id, url: `https://www.facebook.com/${String(data.id).replace('_', '/posts/')}` };
}

export async function deleteFacebookPost({ postId, pageToken }) {
  const response = await fetch(`${GRAPH}/${encodeURIComponent(postId)}?access_token=${encodeURIComponent(pageToken)}`, { method: 'DELETE' });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.success !== true) {
    throw new Error(data.error?.message || 'Facebook could not delete this post. Check that the Page connection has permission and the post is still available.');
  }
  return true;
}

async function instagramPostUrl(mediaId, pageToken) {
  try {
    const response = await fetch(`${GRAPH}/${encodeURIComponent(mediaId)}?fields=permalink&access_token=${encodeURIComponent(pageToken)}`, { signal: AbortSignal.timeout(10000) });
    const data = await response.json();
    return response.ok && data.permalink ? data.permalink : 'https://www.instagram.com/';
  } catch {
    return 'https://www.instagram.com/';
  }
}

async function waitForInstagramContainer({ id, pageToken, onStage, label = 'video' }) {
  const started = Date.now();
  const deadline = 10 * 60 * 1000;
  let delay = 2000;
  while (Date.now() - started < deadline) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    const response = await fetch(`${GRAPH}/${id}?fields=status_code&access_token=${encodeURIComponent(pageToken)}`, {
      signal: AbortSignal.timeout(15000),
    });
    const status = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(status.error?.message || `Could not check Instagram ${label} processing`);
    if (status.status_code === 'FINISHED') return;
    if (status.status_code === 'ERROR') throw new Error(`Instagram could not process this ${label}`);
    if (status.status_code === 'EXPIRED') throw new Error(`Instagram ${label} processing expired; try posting again`);
    const seconds = Math.round((Date.now() - started) / 1000);
    if (onStage) onStage(`Instagram: processing ${label}… ${seconds}s`);
    // Check quickly at first to avoid an unnecessary eight-second pause for
    // short clips, then back off to reduce Graph API polling for long renders.
    delay = Math.min(8000, delay + 1500);
  }
  throw new Error(`Instagram is still processing this ${label} after 10 minutes. Check the Instagram account before retrying.`);
}

export async function publishInstagram({ igUserId, pageToken, caption, alt, collabs, locationId, mediaUrl, isVideo, coverUrl, onStage }) {
  if (!mediaUrl) throw new Error('Instagram needs a photo or video. Attach media first.');
  const createParams = {
    caption: caption || '',
    access_token: pageToken,
    ...(alt ? { accessibility_caption: String(alt).slice(0, 500) } : {}),
    ...(Array.isArray(collabs) && collabs.length ? { collaborators: collabs } : {}),
    ...(locationId ? { location_id: String(locationId) } : {}),
    ...(isVideo ? { media_type: 'REELS', video_url: mediaUrl, ...(coverUrl ? { cover_url: coverUrl } : {}) } : { image_url: mediaUrl }),
  };
  const cRes = await fetch(`${GRAPH}/${igUserId}/media`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(createParams), signal: AbortSignal.timeout(30000),
  });
  const container = await cRes.json();
  if (!cRes.ok) throw new Error(container.error?.message || 'Instagram container failed');
  // Instagram can accept container creation before the media is actually
  // ready to publish. Publishing immediately can fail with "Media ID is not
  // available" for photos as well as Reels, so wait for every container.
  await waitForInstagramContainer({ id: container.id, pageToken, onStage, label: isVideo ? 'video' : 'photo' });
  const pRes = await fetch(`${GRAPH}/${igUserId}/media_publish`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30000),
    body: JSON.stringify({ creation_id: container.id, access_token: pageToken }),
  });
  const published = await pRes.json();
  if (!pRes.ok) throw new Error(published.error?.message || 'Instagram publish failed');
  return { id: published.id, url: await instagramPostUrl(published.id, pageToken) };
}

// --- Instagram Story: single photo/video as a 24h story ---
// Meta flow mirrors reels: create a STORIES container, wait for processing
// when video, then media_publish. Stories need no caption hashtags.
export async function publishInstagramStory({ igUserId, pageToken, mediaUrl, isVideo, onStage }) {
  if (!mediaUrl) throw new Error('Attach a photo or video to post a story.');
  const cRes = await fetch(`${GRAPH}/${igUserId}/media`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(30000),
    body: JSON.stringify({
      media_type: 'STORIES',
      ...(isVideo ? { video_url: mediaUrl } : { image_url: mediaUrl }),
      access_token: pageToken,
    }),
  });
  const container = await cRes.json();
  if (!cRes.ok) throw new Error(container.error?.message || 'Instagram story container failed');
  await waitForInstagramContainer({ id: container.id, pageToken, onStage, label: isVideo ? 'story video' : 'story photo' });
  const pRes = await fetch(`${GRAPH}/${igUserId}/media_publish`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(30000),
    body: JSON.stringify({ creation_id: container.id, access_token: pageToken }),
  });
  const published = await pRes.json();
  if (!pRes.ok) throw new Error(published.error?.message || 'Instagram story publish failed');
  return { id: published.id, url: await instagramPostUrl(published.id, pageToken) };
}

// --- Carousel: 2-10 photos (images only) as one Instagram carousel post ---
// Meta flow: create one child container per image (is_carousel_item=true),
// then a parent CAROUSEL container with children=[ids], then media_publish.
export async function publishInstagramCarousel({ igUserId, pageToken, caption, collabs, locationId, mediaUrls }) {
  const urls = (mediaUrls || []).filter(Boolean);
  if (urls.length < 2) throw new Error('Carousel needs at least 2 photos');
  if (urls.length > 10) throw new Error('Carousel allows up to 10 photos');
  const childIds = [];
  for (const url of urls) {
    const cRes = await fetch(`${GRAPH}/${igUserId}/media`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image_url: url, is_carousel_item: true, access_token: pageToken }),
    });
    const c = await cRes.json();
    if (!cRes.ok) throw new Error(c.error?.message || 'Instagram carousel item failed');
    await waitForInstagramContainer({ id: c.id, pageToken, label: 'carousel photo' });
    childIds.push(c.id);
  }
  const pRes = await fetch(`${GRAPH}/${igUserId}/media`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      media_type: 'CAROUSEL',
      children: childIds.join(','),
      caption: caption || '',
      access_token: pageToken,
      ...(Array.isArray(collabs) && collabs.length ? { collaborators: collabs } : {}),
      ...(locationId ? { location_id: String(locationId) } : {}),
    }),
  });
  const parent = await pRes.json();
  if (!pRes.ok) throw new Error(parent.error?.message || 'Instagram carousel container failed');
  await waitForInstagramContainer({ id: parent.id, pageToken, label: 'carousel' });
  const pub = await fetch(`${GRAPH}/${igUserId}/media_publish`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: parent.id, access_token: pageToken }),
  });
  const published = await pub.json();
  if (!pub.ok) throw new Error(published.error?.message || 'Instagram carousel publish failed');
  return { id: published.id, url: await instagramPostUrl(published.id, pageToken) };
}

// --- Instagram account lookup (collaborators) ---
// Business Discovery is the only Meta API that resolves an Instagram account
// the user has NOT connected: GET /<connected ig id>?fields=
// business_discovery.username(<handle>){...} returns that account's public
// profile and its Instagram user ID, which is what the publishing API's
// `collaborators` parameter needs. Meta matches an EXACT handle — there is no
// prefix search — so the caller resolves whatever the user actually typed.
// Personal accounts, age-gated accounts and tokens without the extra
// permission are reported as a reason, never thrown: typing a handle by hand
// must keep working.
const IG_DISCOVERY_FIELDS = 'id,username,name,biography,followers_count,media_count,profile_picture_url';
const IG_HANDLE = /^[A-Za-z0-9._]{1,30}$/;
const IG_PERMISSION_HINT = /permission|scope|oauth|not authorized|access token|#10\b/i;
const discoveryCache = new Map();
const DISCOVERY_TTL_MS = 30 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [key, hit] of discoveryCache) {
    if (now - hit.at >= DISCOVERY_TTL_MS) discoveryCache.delete(key);
  }
}, 10 * 60 * 1000).unref();

export async function discoverInstagramAccount({ igUserId, pageToken, username }) {
  const handle = String(username || '').trim().replace(/^@+/, '');
  if (!handle || !IG_HANDLE.test(handle) || handle.startsWith('.') || handle.endsWith('.') || handle.includes('..')) {
    return { ok: false, reason: 'invalid' };
  }
  const cacheKey = `${igUserId}:${handle.toLowerCase()}`;
  const cached = discoveryCache.get(cacheKey);
  if (cached && Date.now() - cached.at < DISCOVERY_TTL_MS) return cached.value;
  const fields = `business_discovery.username(${handle}){${IG_DISCOVERY_FIELDS}}`;
  const url = `${GRAPH}/${encodeURIComponent(igUserId)}?fields=${encodeURIComponent(fields)}&access_token=${encodeURIComponent(pageToken)}`;
  let value;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = String(body?.error?.message || '');
      value = { ok: false, reason: IG_PERMISSION_HINT.test(message) ? 'permission' : 'unavailable', message };
    } else if (body?.business_discovery?.id) {
      const found = body.business_discovery;
      value = {
        ok: true,
        account: {
          platform_account_id: String(found.id),
          username: found.username || handle,
          name: found.name || '',
          biography: found.biography || '',
          followers_count: Number(found.followers_count || 0),
          media_count: Number(found.media_count || 0),
          profile_picture_url: found.profile_picture_url || '',
        },
      };
    } else {
      value = { ok: false, reason: 'not-found' };
    }
  } catch (e) {
    value = { ok: false, reason: 'unavailable', message: e?.message || '' };
  }
  // Cache only successful resolutions. Permission failures can become valid
  // immediately after a user updates Meta's Login for Business config and
  // reconnects; caching those failures makes the UI lie for the full TTL.
  if (value.ok) discoveryCache.set(cacheKey, { at: Date.now(), value });
  return value;
}

// The Instagram publishing API expects collaborator usernames, not the
// numeric IDs returned by Business Discovery. Resolve only to canonicalize a
// handle when possible; retain the user-entered username if discovery is not
// available so Meta can validate it during publishing.
export async function resolveInstagramCollaboratorUsernames({ igUserId, pageToken, handles }) {
  const list = [...new Set((handles || []).map((h) => String(h || '').trim().replace(/^@+/, '')).filter(Boolean))];
  const usernames = [];
  let needsPermission = false;
  for (const handle of list) {
    if (/^\d+$/.test(handle)) { usernames.push(handle); continue; }
    const found = await discoverInstagramAccount({ igUserId, pageToken, username: handle });
    if (found.ok) {
      usernames.push(String(found.account.username || handle).replace(/^@+/, ''));
      continue;
    }
    if (found.reason === 'permission') needsPermission = true;
    usernames.push(handle);
  }
  return { usernames, needsPermission };
}

// --- Facebook multi-photo: upload each as unpublished, then one feed post ---
// Prevents N separate timeline posts when a carousel is intended.
export async function publishFacebookCarousel({ pageId, pageToken, text, mediaList }) {
  const items = (mediaList || []).filter((m) => (m?.url || m?.path || m?.bytes) && String(m.mimetype || '').startsWith('image/'));
  if (items.length < 2) throw new Error('Carousel needs at least 2 photos');
  if (items.length > 10) throw new Error('Facebook carousel allows up to 10 photos');
  const attached = [];
  for (const m of items.slice(0, 10)) {
    const form = new FormData();
    form.append('published', 'false');
    if (m.url) form.append('url', m.url);
    else form.append('source', await mediaBlob(m), m.originalname || 'photo.jpg');
    const res = await fetch(`${GRAPH}/${pageId}/photos?access_token=${encodeURIComponent(pageToken)}`, { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Facebook photo upload failed');
    attached.push({ media_fbid: data.id });
  }
  const res = await fetch(`${GRAPH}/${pageId}/feed`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: text || '', attached_media: attached, access_token: pageToken }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Facebook carousel post failed');
  return { id: data.id, url: `https://www.facebook.com/${String(data.id).replace('_', '/posts/')}` };
}
