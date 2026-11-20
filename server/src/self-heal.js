import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const RECOVERABLE_PATTERNS = [
  { pattern: /\b429\b|rate[- ]?limit|too many requests|quota/i, reason: 'Upstream API rate limit', waitSeconds: 20 },
  { pattern: /\b(502|503|504)\b|bad gateway|service unavailable|gateway timeout/i, reason: 'Upstream service temporarily unavailable', waitSeconds: 15 },
  { pattern: /ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|UND_ERR_CONNECT_TIMEOUT|fetch failed|network|socket hang up|timed out|abort/i, reason: 'Temporary network or timeout error', waitSeconds: 10 },
];

/**
 * Classifies whether a runtime intake/publish error is transient and safe
 * to automatically retry without user intervention or AI credits.
 */
export function classifyRecoverableError(error) {
  const message = String(error?.message || error || '').trim();
  for (const entry of RECOVERABLE_PATTERNS) {
    if (entry.pattern.test(message)) {
      return { recoverable: true, reason: entry.reason, waitSeconds: entry.waitSeconds };
    }
  }
  return { recoverable: false, reason: '', waitSeconds: 0 };
}

/**
 * Deterministically repairs quirky MP4/MOV/WebM containers (missing moov atom,
 * unreadable duration, unusual pixel formats) using ffmpeg remux and, if
 * needed, a fast H.264 re-encode. Returns the healed file path or null.
 */
export async function healVideoContainer(videoPath, directory) {
  const remuxPath = path.join(directory, 'healed-remux.mp4');
  try {
    await execFileAsync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', videoPath,
      '-c', 'copy', '-movflags', '+faststart', remuxPath,
    ], { timeout: 90_000, maxBuffer: 2 * 1024 * 1024 });
    const stat = await fs.stat(remuxPath).catch(() => null);
    if (stat?.size > 0) return remuxPath;
  } catch {}

  const transcodePath = path.join(directory, 'healed-transcode.mp4');
  try {
    await execFileAsync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', videoPath,
      '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-movflags', '+faststart', transcodePath,
    ], { timeout: 120_000, maxBuffer: 2 * 1024 * 1024 });
    const stat = await fs.stat(transcodePath).catch(() => null);
    if (stat?.size > 0) return transcodePath;
  } catch {}

  return null;
}
