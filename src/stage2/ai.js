import { api } from '../lib.js';

// Shared Stage 2/3 caption generation: one request, per-platform answers.
// Pass only:<platform> for a fast single-card regen (one card, ~1/3 tokens).
export function requestCaptions(token, { brief, brand, files, tone, emoji, length, only }) {
  return api('/api/ai/captions', token, {
    method: 'POST',
    body: JSON.stringify({
      summary: brief,
      brand: brand || '',
      asset_description: files && files.length ? `${files.length} x ${files[0].type}` : '',
      goal: 'enquiries',
      trends: false,
      tone, emoji, length,
      ...(only ? { only } : {}),
    }),
  });
}

// Tell the server this caption was approved. The server promotes it to a
// reference for future generations of the same brand by the same user, so the
// writing drifts toward what they actually accept rather than a guess.
// Fire-and-forget: a failed preference ping must never interrupt the flow.
export function approveCaption(token, { brand, platform }) {
  try {
    void api('/api/ai/feedback', token, {
      method: 'POST',
      body: JSON.stringify({ brand, platform }),
    }).catch(() => {});
  } catch {}
}

export function mapResponse(data) {
  const c = data.captions || data;
  const ytTags = Array.isArray(c.youtube?.tags) ? c.youtube.tags.join(', ') : (c.youtube?.tags || '');
  const igTags = Array.isArray(c.instagram?.hashtags) ? c.instagram.hashtags.join(' ') : (c.instagram?.hashtags || '');
  const xText = typeof c.x?.text === 'string' ? c.x.text.slice(0, 280) : '';
  return {
    instagram: { caption: c.instagram?.caption || '', hashtags: igTags },
    facebook: { message: c.facebook?.message || '' },
    youtube: { title: c.youtube?.title || '', description: c.youtube?.description || '', tags: ytTags },
    x: { text: xText },
  };
}
