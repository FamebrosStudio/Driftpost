import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function frameRate(value) {
  const [numerator, denominator = '1'] = String(value || '').split('/');
  const n = Number(numerator);
  const d = Number(denominator);
  return d > 0 ? n / d : 0;
}

export function isInstagramCompatibleVideo(info) {
  const video = info?.streams?.find((stream) => stream.codec_type === 'video');
  const audio = info?.streams?.find((stream) => stream.codec_type === 'audio');
  const fps = frameRate(video?.avg_frame_rate || video?.r_frame_rate);
  const container = String(info?.format?.format_name || '');
  return Boolean(
    video
    && /^(mp4|mov)(,|$)/.test(container)
    && video.codec_name === 'h264'
    && video.pix_fmt === 'yuv420p'
    && Number(video.width) > 0
    && Number(video.height) > 0
    && Number(video.width) <= 1920
    && Number(video.height) <= 1920
    && fps >= 23
    && fps <= 60
    && (!audio || audio.codec_name === 'aac'),
  );
}

// Meta's Reels processor rejects otherwise playable files with unsupported
// codecs, pixel formats, frame rates, or oversized dimensions. Normalize only
// the Instagram copy; Facebook and the user's original remain untouched.
export async function prepareInstagramVideo(inputPath, maxBytes = 400 * 1024 * 1024) {
  let info;
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error', '-show_streams', '-show_format', '-of', 'json', inputPath,
    ], { timeout: 30_000, maxBuffer: 2 * 1024 * 1024 });
    info = JSON.parse(stdout);
  } catch {
    throw new Error('Could not inspect this video for Instagram. Please try an MP4 or MOV video.');
  }
  if (isInstagramCompatibleVideo(info)) return { path: inputPath, converted: false };

  const outputPath = path.join(os.tmpdir(), `driftpost-instagram-${crypto.randomUUID()}.mp4`);
  try {
    await execFileAsync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', inputPath,
      '-map', '0:v:0', '-map', '0:a:0?', '-vf', 'scale=1920:1920:force_original_aspect_ratio=decrease:force_divisible_by=2,fps=30',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-pix_fmt', 'yuv420p',
      '-maxrate', '12M', '-bufsize', '24M', '-c:a', 'aac', '-b:a', '128k', '-ar', '48000',
      '-movflags', '+faststart', outputPath,
    ], { timeout: 15 * 60 * 1000, maxBuffer: 2 * 1024 * 1024 });
    const stat = await fs.stat(outputPath);
    if (!stat.size || stat.size > maxBytes) throw new Error('output size is outside the supported range');
    return { path: outputPath, converted: true };
  } catch {
    await fs.unlink(outputPath).catch(() => {});
    throw new Error('Instagram could not prepare this video. Please export it as MP4 (H.264 video, AAC audio) and try again.');
  }
}
