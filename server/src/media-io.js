import { createReadStream, createWriteStream, openAsBlob } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { Transform } from 'node:stream';
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

export async function downloadMediaFile(url, destination, { maxBytes = 400 * 1024 * 1024, expectedSize } = {}) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15 * 60 * 1000) });
  if (!response.ok || !response.body) throw new Error('Media download failed from Supabase');
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body.cancel().catch(() => {});
    throw new Error('Stored media exceeds the allowed download size. Re-upload a smaller file.');
  }
  let received = 0;
  const sizeGuard = new Transform({
    transform(chunk, _encoding, callback) {
      received += chunk.length;
      if (received > maxBytes) callback(new Error('Stored media exceeds the allowed download size. Re-upload a smaller file.'));
      else callback(null, chunk);
    },
  });
  try {
    await pipeline(response.body, sizeGuard, createWriteStream(destination, { flags: 'wx' }));
    if (Number.isFinite(expectedSize) && received !== expectedSize) {
      throw new Error('Stored media size does not match its upload record. Re-upload the file and try again.');
    }
  } catch (error) {
    await unlink(destination).catch(() => {});
    throw error;
  }
  return { size: received };
}
