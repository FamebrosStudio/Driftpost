// YouTube Community Posts have no public API — only Studio/browser automation
// can create them, and that needs a logged-in Google session we don't hold.
// What the Data API does accept is a video, so a photo is rendered to a short
// clip here in the browser and uploaded as one. Encode stays client-side: no
// server round-trip, no ffmpeg dependency, and the original photo is untouched.
// h264 mp4 is the best input for YouTube, but it is not always encodable in a
// browser; vp8 is the fast software fallback and YouTube ingests it fine.
const PREFERRED_TYPES = [
  'video/mp4;codecs=avc1.42E01E',
  'video/webm;codecs=vp8',
  'video/webm;codecs=vp9',
  'video/webm',
];

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('That image could not be read'));
    img.src = src;
  });
}

export function canMakeVideo() {
  try { return typeof MediaRecorder !== 'undefined' && !!HTMLCanvasElement.prototype.captureStream; }
  catch { return false; }
}

export async function photoToVideo(file, {
  seconds = 6, width = 1080, height = 1920, fps = 30, bitrate = 8_000_000,
} = {}) {
  if (!canMakeVideo()) throw new Error('This browser cannot encode video — please attach a video in Stage 2 instead.');
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    const mimeType = PREFERRED_TYPES.find((m) => MediaRecorder.isTypeSupported?.(m)) || '';
    const stream = canvas.captureStream(fps);
    const rec = new MediaRecorder(stream, mimeType
      ? { mimeType, videoBitsPerSecond: bitrate }
      : undefined);
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise((resolve) => { rec.onstop = resolve; });

    // Cover the 9:16 frame, then ease into a slow zoom so a still doesn't
    // read as a frozen frame on the Shorts feed.
    const draw = (t) => {
      const p = Math.max(0, Math.min(1, t / seconds));
      const zoom = 1 + 0.12 * p;
      const scale = Math.max(canvas.width / img.width, canvas.height / img.height) * zoom;
      const dw = img.width * scale;
      const dh = img.height * scale;
      ctx.drawImage(img, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
    };

    draw(0);
    rec.start();
    const t0 = performance.now();
    await new Promise((resolve) => {
      const tick = () => {
        const t = (performance.now() - t0) / 1000;
        if (t >= seconds) { draw(seconds); resolve(); return; }
        draw(t);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    rec.stop();
    await stopped;
    stream.getTracks().forEach((t) => t.stop());

    const type = rec.mimeType || mimeType || 'video/webm';
    const ext = type.includes('mp4') ? 'mp4' : 'webm';
    const blob = new Blob(chunks, { type });
    if (!blob.size) throw new Error('The video could not be created — please attach a video in Stage 2 instead.');
    const base = (file.name || 'photo').replace(/\.[^.]+$/, '');
    return new File([blob], `${base}.${ext}`, { type });
  } finally {
    URL.revokeObjectURL(url);
  }
}
