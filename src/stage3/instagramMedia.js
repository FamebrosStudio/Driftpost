const IG_WIDTH = 1080;
const IG_HEIGHT = 1440;
const IG_MAX_BYTES = 8 * 1024 * 1024;
const FB_WIDTH = 1080;
const FB_HEIGHT = 1440;
const FB_MAX_BYTES = 10 * 1024 * 1024;

function toBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not prepare this photo for Instagram.')), 'image/jpeg', quality);
  });
}

async function jpegForTarget(entry, { width: targetWidth, height: targetHeight, maxBytes, suffix, platform }) {
  if (!entry?.raw || !String(entry.type || entry.raw.type).startsWith('image/')) return entry;
  let bitmap;
  try { bitmap = await createImageBitmap(entry.raw); }
  catch { throw new Error(`${entry.name || 'A photo'} could not be decoded. Re-export it as JPG or PNG and try again.`); }
  try {
    const canvas = document.createElement('canvas');
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error(`Your browser could not prepare this photo for ${platform}.`);

    // A blurred cover keeps the whole photo visible in each platform's
    // standard frame, without destructively cropping the original.
    const cover = Math.max(targetWidth / bitmap.width, targetHeight / bitmap.height);
    ctx.save();
    ctx.filter = 'blur(28px) brightness(.72)';
    ctx.drawImage(bitmap, (targetWidth - bitmap.width * cover) / 2, (targetHeight - bitmap.height * cover) / 2, bitmap.width * cover, bitmap.height * cover);
    ctx.restore();
    const fit = Math.min(targetWidth / bitmap.width, targetHeight / bitmap.height);
    const width = bitmap.width * fit;
    const height = bitmap.height * fit;
    ctx.drawImage(bitmap, (targetWidth - width) / 2, (targetHeight - height) / 2, width, height);

    let blob = await toBlob(canvas, 0.9);
    for (const quality of [0.82, 0.72, 0.62]) {
      if (blob.size <= maxBytes) break;
      blob = await toBlob(canvas, quality);
    }
    if (blob.size > maxBytes) throw new Error(`${entry.name || 'A photo'} is too detailed for ${platform} after resizing. Try a smaller image.`);
    const base = String(entry.name || entry.raw.name || 'social-photo').replace(/\.[^.]+$/, '');
    const raw = new File([blob], `${base}-${suffix}.jpg`, { type: 'image/jpeg', lastModified: Date.now() });
    return { ...entry, raw, name: raw.name, type: raw.type, size: `${(raw.size / 1024 / 1024).toFixed(1)} MB` };
  } finally {
    bitmap.close?.();
  }
}

export async function instagramMediaFiles(files = []) {
  return Promise.all(files.map((entry) => jpegForTarget(entry, {
    width: IG_WIDTH, height: IG_HEIGHT, maxBytes: IG_MAX_BYTES, suffix: 'instagram', platform: 'Instagram',
  })));
}

export async function facebookMediaFiles(files = []) {
  return Promise.all(files.map((entry) => jpegForTarget(entry, {
    width: FB_WIDTH, height: FB_HEIGHT, maxBytes: FB_MAX_BYTES, suffix: 'facebook', platform: 'Facebook',
  })));
}
