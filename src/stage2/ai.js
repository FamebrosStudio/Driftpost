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

// Extract a few evenly spaced stills in-browser; videos stay on the user's
// device apart from the small JPEG samples and audio sent for analysis.
async function sampleVideo(file, count = 3) {
  if (!file?.type?.startsWith('video/')) return [];
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.muted = true;
  video.playsInline = true;
  video.src = url;
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Video preview timed out')), 10000);
      video.onloadedmetadata = () => { clearTimeout(timer); resolve(); };
      video.onerror = () => { clearTimeout(timer); reject(new Error('Video preview could not be read')); };
    });
    const duration = Number(video.duration) || 0;
    if (!Number.isFinite(duration) || duration <= 0) throw new Error('Video has no readable duration');
    const frames = [];
    const frameCount = Math.min(count, Math.max(1, Math.floor(duration * 2)));
    for (let i = 0; i < frameCount; i++) {
      const time = Math.max(0, Math.min(duration - 0.05, duration * ((i + 0.5) / frameCount)));
      await new Promise((resolve, reject) => {
        if (Math.abs(video.currentTime - time) < 0.01) { resolve(); return; }
        const timer = setTimeout(() => reject(new Error('Video frame extraction timed out')), 8000);
        video.onseeked = () => { clearTimeout(timer); resolve(); };
        video.currentTime = time;
      });
      const scale = Math.min(1, 1024 / Math.max(video.videoWidth, video.videoHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.76));
      if (blob) frames.push(new File([blob], `video-frame-${i + 1}.jpg`, { type: 'image/jpeg' }));
    }
    return frames;
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}

// Shared Stage 2/3 caption generation: one request, per-platform answers.
// Pass only:<platform> for a fast single-card regen (one card, ~1/3 tokens).
export function requestCaptions(token, { brief, brand, files, tone, emoji, length, analysis = 'fast', only }) {
  return (async () => {
    const entries = files || [];
    const analyzeMedia = analysis === 'analyze';
    const photos = analyzeMedia ? entries.filter((f) => f?.raw?.type?.startsWith('image/')) : [];
    const video = analyzeMedia ? entries.find((f) => f?.raw?.type?.startsWith('video/')) : null;
    const frames = video ? await sampleVideo(video.raw) : [];
    // Keep one generation call light: three video moments plus one photo, or
    // four photos. The video itself is sent once for speech transcription.
    const selected = video ? [...photos.slice(0, 1), ...frames] : photos.slice(0, 4);
    const form = new FormData();
    const body = {
      summary: String(brief || '').trim() || (selected.length ? 'Write a caption grounded in the visible subject and details in the attached media.' : ''),
      brand: brand || '',
      asset_description: analyzeMedia && entries.length ? `${entries.length} selected media file(s)${video ? '; video frames sampled across the full clip' : ''}` : '',
      image_count: 0,
      goal: 'enquiries',
      trends: false,
      tone, emoji, length,
      ...(only ? { only } : {}),
    };
    const compacted = await Promise.all(selected.map((photo) => compactImage(photo?.raw || photo)));
    compacted.filter(Boolean).forEach((file) => form.append('images', file, file.name));
    if (selected.length && !form.getAll('images').length) {
      throw new Error('Could not prepare your selected photos for caption analysis. Try a JPG or PNG photo.');
    }
    if (video) form.append('video', video.raw, video.name || 'video.mp4');
    body.image_count = form.getAll('images').length;
    for (const [key, value] of Object.entries(body)) form.append(key, String(value ?? ''));
    return api('/api/ai/captions', token, { method: 'POST', body: form });
  })();
}

// Tell the server this caption was approved. The server promotes it to a
// reference for future generations of the same brand by the same user, so the
// writing drifts toward what they actually accept rather than a guess.
// Await persistence so the UI can report failures instead of silently losing
// the user's approval signal.
export function approveCaption(token, { brand, platform, caption }) {
  return api('/api/ai/feedback', token, {
      method: 'POST',
      body: JSON.stringify({ brand, platform, caption }),
    });
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
