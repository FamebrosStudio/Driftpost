import { api } from '../lib.js';

async function compactImage(file) {
  if (!file?.type?.startsWith('image/')) return null;
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
    if (blob?.size > 2 * 1024 * 1024) {
      const smaller = document.createElement('canvas');
      const shrink = Math.min(1, 1100 / Math.max(bitmap.width, bitmap.height));
      smaller.width = Math.max(1, Math.round(bitmap.width * shrink));
      smaller.height = Math.max(1, Math.round(bitmap.height * shrink));
      smaller.getContext('2d').drawImage(bitmap, 0, 0, smaller.width, smaller.height);
      blob = await new Promise((resolve) => smaller.toBlob(resolve, 'image/jpeg', 0.68));
    }
    bitmap.close?.();
    if (!blob || blob.size > 2 * 1024 * 1024) return null;
    const base = String(file.name || 'photo').replace(/\.[^.]+$/, '').slice(0, 80) || 'photo';
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg' });
  } catch {
    return ['image/jpeg', 'image/png'].includes(file.type) && file.size <= 2 * 1024 * 1024 ? file : null;
  }
}

// Shared Stage 2/3 caption generation: one request, per-platform answers.
// Pass only:<platform> for a fast single-card regen (one card, ~1/3 tokens).
export function requestCaptions(token, { brief, brand, files, tone, emoji, length, only }) {
  return (async () => {
    const photos = (files || []).filter((f) => f?.raw?.type?.startsWith('image/')).slice(0, 4);
    const form = new FormData();
    const body = {
      summary: String(brief || '').trim() || (photos.length ? 'Write a caption grounded in the visible subject and details in these photos.' : ''),
      brand: brand || '',
      asset_description: files && files.length ? `${files.length} selected media file(s)` : '',
      image_count: 0,
      goal: 'enquiries',
      trends: false,
      tone, emoji, length,
      ...(only ? { only } : {}),
    };
    // Inspect up to four selected photos in the SAME generation call: the
    // model sees the visual evidence before writing, with no extra analysis
    // round-trip or raw full-resolution upload.
    for (const photo of photos) {
      const compact = await compactImage(photo.raw);
      if (compact) form.append('images', compact, compact.name);
    }
    if (photos.length && !form.getAll('images').length) {
      throw new Error('Could not prepare your selected photos for caption analysis. Try a JPG or PNG photo.');
    }
    body.image_count = form.getAll('images').length;
    for (const [key, value] of Object.entries(body)) form.append(key, String(value ?? ''));
    return api('/api/ai/captions', token, { method: 'POST', body: form });
  })();
}

// Tell the server this caption was approved. The server promotes it to a
// reference for future generations of the same brand by the same user, so the
// writing drifts toward what they actually accept rather than a guess.
// Fire-and-forget: a failed preference ping must never interrupt the flow.
export function approveCaption(token, { brand, platform, caption }) {
  try {
    void api('/api/ai/feedback', token, {
      method: 'POST',
      body: JSON.stringify({ brand, platform, caption }),
    }).catch(() => {});
  } catch {}
}

export function mapResponse(data) {
  const c = data.captions || data;
  const ytTags = Array.isArray(c.youtube?.tags) ? c.youtube.tags.join(', ') : (c.youtube?.tags || '');
  const rawTags = Array.isArray(c.instagram?.hashtags) ? c.instagram.hashtags : String(c.instagram?.hashtags || '').split(/[,\s]+/);
  const igTags = [...new Set(rawTags.map((t) => String(t).replace(/^#+/, '').trim()).filter(Boolean))].map((t) => `#${t}`).join(' ');
  const igCaption = String(c.instagram?.caption || '').split('\n')
    .filter((line) => !igTags || !/^\s*(?:#[\p{L}\p{N}_]+\s*)+$/u.test(line)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  const xText = typeof c.x?.text === 'string' ? c.x.text.slice(0, 280) : '';
  return {
    instagram: { caption: igCaption, hashtags: igTags },
    facebook: { message: c.facebook?.message || '' },
    youtube: { title: c.youtube?.title || '', description: c.youtube?.description || '', tags: ytTags },
    x: { text: xText },
  };
}
