import { openAsBlob } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveProvider } from './ai-provider.js';

const execFileAsync = promisify(execFile);
// OpenAI's transcription endpoint rejects uploads above 25 MB. A 64 kbps mono
// track is roughly 0.5 MB per minute, so even long videos stay well under it.
const OPENAI_MAX_AUDIO_BYTES = 24 * 1024 * 1024;

// xAI's speech-to-text endpoint accepts MP4 media directly, so avoid a local
// transcode pass and submit the selected clip as-is for its audio track.
export async function transcribeVideo(filePath, originalName = 'video', mimeType = 'video/mp4') {
  const provider = resolveProvider();
  if (!provider.hasKey) throw new Error(`AI is not configured yet (${provider.apiKeyEnv} missing)`);
  if (provider.id === 'openai') return transcribeWithOpenAI(provider, filePath, originalName);
  return transcribeWithXai(provider, filePath, originalName, mimeType);
}

async function transcribeWithXai(provider, filePath, originalName, mimeType) {
  const form = new FormData();
  form.append('model', process.env[provider.config.transcribe.modelEnv] || provider.config.transcribe.defaultModel);
  form.append('file', await openAsBlob(filePath, { type: mimeType }), originalName || 'video.mp4');
  const response = await fetch(provider.config.transcribe.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${provider.apiKey}` },
    body: form,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error?.message || data.error || `Video transcription failed (${response.status})`);
  return {
    text: String(data.text || '').slice(0, 5000),
    language: String(data.language || '').slice(0, 20) || null,
    duration: Number(data.duration) || 0,
  };
}

async function transcribeWithOpenAI(provider, filePath, originalName) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'driftpost-audio-'));
  const audioPath = path.join(directory, 'audio.mp3');
  try {
    // Extract the audio track only: OpenAI bills and limits by audio upload
    // size, and the video container is far larger than its soundtrack.
    await execFileAsync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', filePath,
      '-vn', '-ac', '1', '-ar', '16000', '-b:a', '64k', audioPath,
    ], { timeout: 120_000, maxBuffer: 1024 * 1024 });
    const stat = await fs.stat(audioPath);
    if (!stat.size) throw new Error('This video has no audible track to transcribe.');
    if (stat.size > OPENAI_MAX_AUDIO_BYTES) {
      throw new Error('The audio track of this video is too long to transcribe in one request.');
    }
    const form = new FormData();
    form.append('model', process.env[provider.config.transcribe.modelEnv] || provider.config.transcribe.defaultModel);
    form.append('file', await openAsBlob(audioPath, { type: 'audio/mpeg' }), 'audio.mp3');
    const response = await fetch(provider.config.transcribe.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${provider.apiKey}` },
      body: form,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = data.error?.message || data.error || `Video transcription failed (${response.status})`;
      throw new Error(typeof message === 'string' ? message : JSON.stringify(message).slice(0, 200));
    }
    const languages = Array.isArray(data.languages) ? data.languages : [];
    return {
      text: String(data.text || '').slice(0, 5000),
      language: String(languages[0]?.code || data.language || '').slice(0, 20) || null,
      duration: Number(data.duration) || 0,
    };
  } finally {
    await fs.rm(directory, { recursive: true, force: true }).catch(() => {});
  }
}
