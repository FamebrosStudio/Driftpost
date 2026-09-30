import React, { useEffect, useMemo, useRef, useState } from 'react';

const FORMATS = {
  youtube: { width: 1280, height: 720, label: '16:9' },
  facebook: { width: 1280, height: 720, label: '16:9' },
  instagram: { width: 720, height: 1280, label: '9:16' },
};

async function makeCover(source, platform, name) {
  const format = FORMATS[platform];
  const bitmap = await createImageBitmap(source);
  const canvas = document.createElement('canvas');
  canvas.width = format.width;
  canvas.height = format.height;
  const ctx = canvas.getContext('2d');
  const scale = Math.max(canvas.width / bitmap.width, canvas.height / bitmap.height);
  const width = bitmap.width * scale;
  const height = bitmap.height * scale;
  ctx.drawImage(bitmap, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
  bitmap.close?.();
  const blob = await new Promise((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Could not create the cover image.')), 'image/jpeg', 0.88));
  if (blob.size > 5 * 1024 * 1024) throw new Error('Cover image is larger than 5 MB after resizing. Choose another image.');
  return { raw: new File([blob], name.replace(/\.[^.]+$/, '') + '-cover.jpg', { type: 'image/jpeg' }), name };
}

export default function CoverPicker({ platform, files = [], cover, onChange }) {
  const inputRef = useRef(null);
  const videoRef = useRef(null);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const videoFile = files.find((file) => (file.type || file.raw?.type || '').startsWith('video/'));
  const videoUrl = useMemo(() => {
    if (!videoFile?.raw) return '';
    try { return URL.createObjectURL(videoFile.raw); } catch { return ''; }
  }, [videoFile]);
  const coverUrl = useMemo(() => {
    if (!cover?.raw) return '';
    try { return URL.createObjectURL(cover.raw); } catch { return ''; }
  }, [cover]);
  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl); }, [videoUrl]);
  useEffect(() => () => { if (coverUrl) URL.revokeObjectURL(coverUrl); }, [coverUrl]);

  const importCover = async (file) => {
    if (!file) return;
    setBusy(true); setError('');
    try {
      if (!file.type.startsWith('image/')) throw new Error('Choose a JPG, PNG, or WebP image.');
      onChange(await makeCover(file, platform, file.name || 'cover'));
    } catch (e) { setError(e.message || 'Could not prepare that cover image.'); }
    finally { setBusy(false); }
  };

  const useFrame = async () => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) return;
    setBusy(true); setError('');
    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      const frame = await new Promise((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Could not capture this video frame.')), 'image/jpeg', 0.95));
      const file = new File([frame], `video-frame-${Math.floor(video.currentTime)}s.jpg`, { type: 'image/jpeg' });
      onChange(await makeCover(file, platform, file.name));
    } catch (e) { setError(e.message || 'Could not capture this video frame.'); }
    finally { setBusy(false); }
  };

  const label = platform === 'instagram' ? 'Instagram Reel cover' : platform === 'facebook' ? 'Facebook video cover' : 'YouTube thumbnail';
  return <section className="s3-cover-picker" aria-label={label}>
    <div className="s3-cover-head"><b>{label}</b><small>{FORMATS[platform].label} · video posts</small></div>
    {coverUrl && <div className={`s3-cover-preview ${platform}`}><img src={coverUrl} alt="Selected post cover preview" /><button type="button" onClick={() => onChange(null)} disabled={busy}>Remove</button></div>}
    <div className="s3-cover-actions">
      <button type="button" className="s3-mini-btn" onClick={() => inputRef.current?.click()} disabled={busy}>{busy ? 'Preparing…' : 'Import cover image'}</button>
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => { importCover(event.target.files?.[0]); event.target.value = ''; }} />
    </div>
    {videoUrl && <div className="s3-frame-picker">
      <video ref={videoRef} src={videoUrl} preload="metadata" muted playsInline onLoadedMetadata={(event) => { setDuration(event.currentTarget.duration || 0); setTime(0); }} onSeeked={(event) => setTime(event.currentTarget.currentTime || 0)} />
      <label><span>Choose a frame · {time.toFixed(1)}s</span><input type="range" min="0" max={duration || 0} step="0.1" value={Math.min(time, duration || 0)} onChange={(event) => { const next = Number(event.target.value); setTime(next); if (videoRef.current) videoRef.current.currentTime = next; }} disabled={!duration || busy} /></label>
      <button type="button" className="s3-mini-btn" onClick={useFrame} disabled={!duration || busy}>Use selected frame</button>
    </div>}
    {!videoUrl && <small className="s3-subnote">Attach a video in Stage 2 to choose a frame. Uploaded covers are prepared as {FORMATS[platform].label} JPEGs.</small>}
    {error && <p className="s3-err" role="alert">{error}</p>}
  </section>;
}
