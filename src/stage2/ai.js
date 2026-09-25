import { api } from '../lib.js';

// Shared Stage 2/3 caption generation: one request, per-platform answers.
export function requestCaptions(token, { brief, brand, files, tone, emoji, length, fresh }) {
  return api('/api/ai/captions', token, {
    method: 'POST',
    body: JSON.stringify({
      summary: brief,
      brand: brand || '',
      asset_description: files && files.length ? `${files.length} x ${files[0].type}` : '',
      goal: 'enquiries',
      trends: false,
      tone, emoji, length,
      fresh: fresh === true,
    }),
  });
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
