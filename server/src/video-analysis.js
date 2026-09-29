import { openAsBlob } from 'node:fs';

// xAI's speech-to-text endpoint accepts MP4 media directly, so avoid a local
// transcode pass and submit the selected clip as-is for its audio track.
export async function transcribeVideo(filePath, originalName = 'video', mimeType = 'video/mp4') {
  if (!process.env.XAI_API_KEY) throw new Error('AI is not configured yet (XAI_API_KEY missing)');
  const form = new FormData();
  form.append('model', 'grok-voice-transcribe-2.0');
  form.append('file', await openAsBlob(filePath, { type: mimeType }), originalName || 'video.mp4');
  const response = await fetch('https://api.x.ai/v1/stt', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.XAI_API_KEY}` },
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
