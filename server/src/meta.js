// Meta (Facebook + Instagram) via Graph API. No X/Twitter anywhere in Driftpost.
const GRAPH = 'https://graph.facebook.com/v21.0';
// Facebook connect uses regular Login with Page scopes (no review needed in dev).
const FB_SCOPES = process.env.META_FB_SCOPES || 'pages_show_list,pages_read_engagement,pages_manage_posts,business_management';
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

async function graphError(res, fallback) {
  const b = await res.json().catch(() => ({}));
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
  // 2) Portfolio-owned assets: /me/accounts never lists pages owned by a
  //    business portfolio (e.g. skfurnituremarket), even when the user owns
  //    that portfolio — so walk /me/businesses -> owned_pages as fallback.
  const auth = { headers: { Authorization: `Bearer ${userToken}` } };
  const all = [];
  let url = `${GRAPH}/me/accounts?fields=id,name,tasks,access_token,instagram_business_account{id,username}&limit=100`;
  for (let i = 0; i < 5 && url; i++) {
    const res = await fetch(url, auth);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || 'Unable to list Facebook Pages');
    all.push(...(data.data || []));
    url = data.paging?.next || null;
  }
  try {
    const bRes = await fetch(`${GRAPH}/me/businesses?fields=id,name&limit=50`, auth);
    const bData = await bRes.json();
    if (!bRes.ok) throw new Error('no-business-access');
    for (const biz of (bData.data || []).slice(0, 20)) {
      try {
        const pRes = await fetch(`${GRAPH}/${biz.id}/owned_pages?fields=id,name&limit=100`, auth);
        const pData = await pRes.json();
        if (!pRes.ok) continue;
        for (const p of (pData.data || [])) {
          if (all.some((x) => x.id === p.id)) continue;
          try {
            const dRes = await fetch(`${GRAPH}/${p.id}?fields=access_token,instagram_business_account{id,username}`, auth);
            const d = await dRes.json();
            if (dRes.ok && d.access_token) {
              all.push({ id: p.id, name: p.name, access_token: d.access_token, instagram_business_account: d.instagram_business_account || null });
            }
          } catch { /* skip one page, keep the rest */ }
        }
      } catch { /* skip one business, keep the rest */ }
    }
  } catch { /* businesses unavailable without business_management: keep personal pages */ }
  // De-duplicate by page id.
  const seen = new Set();
  return all.filter((p) => (seen.has(p.id) ? false : (seen.add(p.id), true)));
}

export async function publishFacebook({ pageId, pageToken, text, link, linkMeta, targeting, cta, unpublished, media }) {
  // media: multer file or undefined. Text-only -> /feed. Photo -> /photos. Video -> /videos.
  if (media?.mimetype?.startsWith('video/')) {
    const form = new FormData();
    form.append('description', text || '');
    form.append('source', new Blob([await media.bytes], { type: media.mimetype }), media.originalname);
    const res = await fetch(`${GRAPH}/${pageId}/videos?access_token=${encodeURIComponent(pageToken)}`, { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok) throw await graphError(res, 'Facebook video failed');
    return { id: data.id, url: `https://www.facebook.com/${pageId}/videos/${data.id}` };
  }
  if (media?.mimetype?.startsWith('image/')) {
    const form = new FormData();
    form.append('caption', text || '');
    form.append('source', new Blob([await media.bytes], { type: media.mimetype }), media.originalname);
    const res = await fetch(`${GRAPH}/${pageId}/photos?access_token=${encodeURIComponent(pageToken)}`, { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok) throw await graphError(res, 'Facebook photo failed');
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

export async function publishInstagram({ igUserId, pageToken, caption, alt, collabs, locationId, mediaUrl, isVideo }) {
  if (!mediaUrl) throw new Error('Instagram needs a photo or video. Attach media first.');
  const createParams = {
    caption: caption || '',
    access_token: pageToken,
    ...(alt ? { accessibility_caption: String(alt).slice(0, 500) } : {}),
    ...(Array.isArray(collabs) && collabs.length ? { collaborators: collabs } : {}),
    ...(locationId ? { location_id: String(locationId) } : {}),
    ...(isVideo ? { media_type: 'REELS', video_url: mediaUrl } : { image_url: mediaUrl }),
  };
  const cRes = await fetch(`${GRAPH}/${igUserId}/media`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(createParams),
  });
  const container = await cRes.json();
  if (!cRes.ok) throw new Error(container.error?.message || 'Instagram container failed');
  // wait for video processing
  if (isVideo) {
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 8000));
      const s = await fetch(`${GRAPH}/${container.id}?fields=status_code&access_token=${encodeURIComponent(pageToken)}`);
      const sj = await s.json();
      if (sj.status_code === 'FINISHED') break;
      if (sj.status_code === 'ERROR') throw new Error('Instagram could not process this video');
    }
  }
  const pRes = await fetch(`${GRAPH}/${igUserId}/media_publish`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: container.id, access_token: pageToken }),
  });
  const published = await pRes.json();
  if (!pRes.ok) throw new Error(published.error?.message || 'Instagram publish failed');
  return { id: published.id, url: 'https://www.instagram.com/' };
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
  const pub = await fetch(`${GRAPH}/${igUserId}/media_publish`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: parent.id, access_token: pageToken }),
  });
  const published = await pub.json();
  if (!pub.ok) throw new Error(published.error?.message || 'Instagram carousel publish failed');
  return { id: published.id, url: 'https://www.instagram.com/' };
}

// --- Facebook multi-photo: upload each as unpublished, then one feed post ---
// Prevents N separate timeline posts when a carousel is intended.
export async function publishFacebookCarousel({ pageId, pageToken, text, mediaList }) {
  const items = (mediaList || []).filter((m) => m?.bytes && String(m.mimetype || '').startsWith('image/'));
  if (items.length < 2) throw new Error('Carousel needs at least 2 photos');
  if (items.length > 10) throw new Error('Facebook carousel allows up to 10 photos');
  const attached = [];
  for (const m of items.slice(0, 10)) {
    const form = new FormData();
    form.append('published', 'false');
    form.append('source', new Blob([m.bytes], { type: m.mimetype }), m.originalname || 'photo.jpg');
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
