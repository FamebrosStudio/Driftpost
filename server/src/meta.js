// Meta (Facebook + Instagram) via Graph API. No X/Twitter anywhere in Driftpost.
const GRAPH = 'https://graph.facebook.com/v21.0';
// Scopes are configurable via META_SCOPES so Meta dashboard changes never need a code edit.
// Default is Facebook-only (standard permissions, work in Development mode with no review).
// Add Instagram later with: pages_show_list,pages_read_engagement,pages_manage_posts,instagram_business_basic,instagram_business_content_publish
const SCOPES = process.env.META_SCOPES || 'pages_show_list,pages_read_engagement,pages_manage_posts';

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
  const res = await fetch(`${GRAPH}/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&limit=50`, {
    headers: { Authorization: `Bearer ${userToken}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Unable to list Facebook Pages');
  return data.data || [];
}

export async function publishFacebook({ pageId, pageToken, text, media }) {
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
  const res = await fetch(`${GRAPH}/${pageId}/feed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: text, access_token: pageToken }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || 'Facebook post failed');
  return { id: data.id, url: `https://www.facebook.com/${String(data.id).replace('_', '/posts/')}` };
}

export async function publishInstagram({ igUserId, pageToken, caption, mediaUrl, isVideo }) {
  if (!mediaUrl) throw new Error('Instagram needs a photo or video. Attach media first.');
  const createParams = {
    caption: caption || '',
    access_token: pageToken,
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
