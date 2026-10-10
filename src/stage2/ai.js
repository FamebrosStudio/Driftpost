import { api } from '../lib.js';

async function compactImage(file) {
  if (!file?.type?.startsWith('image/')) return null;
  let bitmap = null;
  try {
    bitmap = await createImageBitmap(file);
    const maxEdge = 1280;
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) return null;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const encode = (quality) => new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    let blob = await encode(0.76);
    // Keep vision uploads small for faster analysis, especially on slower
    // networks and machines. Only resize/re-encode when the first pass needs it.
    if (blob?.size > 1_250_000) {
      const shrink = Math.min(1, 1024 / Math.max(bitmap.width, bitmap.height));
      canvas.width = Math.max(1, Math.round(bitmap.width * shrink));
      canvas.height = Math.max(1, Math.round(bitmap.height * shrink));
      canvas.getContext('2d', { alpha: false })?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      blob = await encode(0.64);
    }
    if (!blob || blob.size > 1_500_000) return null;
    const base = String(file.name || 'photo').replace(/\.[^.]+$/, '').slice(0, 80) || 'photo';
    return new File([blob], `${base}.jpg`, { type: 'image/jpeg' });
  } catch {
    return ['image/jpeg', 'image/png'].includes(file.type) && file.size <= 1_500_000 ? file : null;
  } finally {
    bitmap?.close?.();
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
    const frames = [];
    const captureFrame = (index) => {
      const scale = Math.min(1, 1024 / Math.max(video.videoWidth, video.videoHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(video.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
      canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
      return new Promise((resolve) => canvas.toBlob((blob) => {
        if (blob) frames.push(new File([blob], `video-frame-${index + 1}.jpg`, { type: 'image/jpeg' }));
        resolve();
      }, 'image/jpeg', 0.76));
    };
    if (!Number.isFinite(duration) || duration <= 0) {
      // MediaRecorder WebM exports commonly have no finite duration in their
      // metadata. They can still decode normally, so sample a few early frames
      // while playing instead of rejecting the whole caption request.
      await new Promise((resolve, reject) => {
        if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return resolve();
        const timer = setTimeout(() => reject(new Error('Video preview timed out')), 10000);
        video.onloadeddata = () => { clearTimeout(timer); resolve(); };
        video.onerror = () => { clearTimeout(timer); reject(new Error('Video preview could not be read')); };
      });
      if (video.videoWidth && video.videoHeight) await captureFrame(0);
      try { await video.play(); } catch {}
      let previousSample = Number(video.currentTime) || 0;
      const deadline = Date.now() + 8000;
      while (frames.length < count && !video.ended && Date.now() < deadline) {
        const mediaTime = await new Promise((resolve) => {
          let settled = false;
          const done = (time) => { if (!settled) { settled = true; clearTimeout(timer); resolve(time); } };
          const timer = setTimeout(() => done(Number(video.currentTime) || previousSample), 1200);
          if (typeof video.requestVideoFrameCallback === 'function') {
            video.requestVideoFrameCallback((_now, metadata) => done(Number(metadata.mediaTime) || Number(video.currentTime) || previousSample));
          } else {
            video.addEventListener('timeupdate', () => done(Number(video.currentTime) || previousSample), { once: true });
          }
        });
        if (mediaTime - previousSample >= 0.65 && video.videoWidth && video.videoHeight) {
          await captureFrame(frames.length);
          previousSample = mediaTime;
        }
      }
      try { video.pause(); } catch {}
      return frames;
    }
    const frameCount = Math.min(count, Math.max(1, Math.floor(duration * 2)));
    for (let i = 0; i < frameCount; i++) {
      const time = Math.max(0, Math.min(duration - 0.05, duration * ((i + 0.5) / frameCount)));
      await new Promise((resolve, reject) => {
        if (Math.abs(video.currentTime - time) < 0.01) { resolve(); return; }
        const timer = setTimeout(() => reject(new Error('Video frame extraction timed out')), 8000);
        video.onseeked = () => { clearTimeout(timer); resolve(); };
        video.currentTime = time;
      });
      await captureFrame(i);
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
export function requestCaptions(token, { brief, brand, brandId, files, tone, emoji, length, analysis = 'fast', only, platforms, frameCount = 3, teamVideo = false }) {
  return (async () => {
    const entries = files || [];
    const analyzeMedia = analysis === 'analyze';
    const photos = analyzeMedia ? entries.filter((f) => f?.raw?.type?.startsWith('image/')) : [];
    const video = analyzeMedia ? entries.find((f) => f?.raw?.type?.startsWith('video/')) : null;
    const frames = video ? await sampleVideo(video.raw, Math.max(1, Math.min(8, Number(frameCount) || 3))) : [];
    // Keep the standard composer light: three video moments plus one photo, or
    // four photos. The video itself is sent once for speech transcription.
    const selected = video ? [...photos.slice(0, 1), ...frames] : photos.slice(0, 4);
    const form = new FormData();
    const body = {
      summary: String(brief || '').trim() || (selected.length ? 'Write a caption grounded in the visible subject and details in the attached media.' : ''),
      brand: brand || '',
      ...(brandId ? { brand_id: brandId } : {}),
      asset_description: analyzeMedia && entries.length ? `${entries.length} selected media file(s)${video ? '; video frames sampled across the full clip' : ''}` : '',
      image_count: 0,
      goal: 'enquiries',
      trends: false,
      tone, emoji, length,
      ...(only ? { only } : Array.isArray(platforms) && platforms.length
        ? { only: JSON.stringify([...new Set(platforms)]) }
        : {}),
      ...(video && Number(frameCount) > 3 ? { video_frame_analysis: '1' } : {}),
    };
    const compacted = await Promise.all(selected.map((photo) => compactImage(photo?.raw || photo)));
    compacted.filter(Boolean).forEach((file) => form.append('images', file, file.name));
    if (selected.length && !form.getAll('images').length) {
      throw new Error('Could not prepare your selected photos for caption analysis. Try a JPG or PNG photo.');
    }
    if (video) form.append('video', video.raw, video.name || 'video.mp4');
    body.image_count = form.getAll('images').length;
    for (const [key, value] of Object.entries(body)) form.append(key, String(value ?? ''));
    const result = await api('/api/ai/captions', token, {
      method: 'POST',
      body: form,
      ...(teamVideo ? { headers: { 'X-Driftpost-Team-Video': '1' } } : {}),
    });
    // Keep extracted stills local for the private team flow's separate cover
    // decision. They are not serialized back from the API.
    return { ...result, videoFrames: frames };
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
