import { createReadStream, createWriteStream, openAsBlob } from 'node:fs';
import { pipeline } from 'node:stream/promises';

// Keep media on disk: a Buffer plus a multipart Blob can otherwise consume
// several times the video size on a small API instance.
export async function uploadMediaFile(storage, key, file, options = {}) {
  const stream = createReadStream(file.path);
  try {
    return await storage.upload(key, stream, {
      ...options, contentType: file.mimetype || 'application/octet-stream', duplex: 'half',
    });
  } finally {
    stream.destroy();
  }
}

export async function mediaBlob(media) {
  if (media.path) return openAsBlob(media.path, { type: media.mimetype || 'application/octet-stream' });
  if (media.bytes) return new Blob([await media.bytes], { type: media.mimetype });
  throw new Error('Media file is unavailable');
}

export async function downloadMediaFile(url, destination) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15 * 60 * 1000) });
  if (!response.ok || !response.body) throw new Error('Media download failed from Supabase');
  await pipeline(response.body, createWriteStream(destination, { flags: 'wx' }));
}
