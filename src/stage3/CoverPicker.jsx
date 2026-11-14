import React, { useEffect, useMemo, useRef, useState } from 'react';
import BorderGlow from '../components/reactbits/BorderGlow.jsx';

const FORMATS = {
  youtube: { width: 1280, height: 720, label: '16:9' },
  facebook: { width: 1280, height: 720, label: '16:9' },
  instagram: { width: 720, height: 1280, label: '9:16' },
};
const formatTime = (seconds = 0) => {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
};

export async function makeCover(source, platform, name) {
  const format = FORMATS[platform];
  const bitmap = await createImageBitmap(source);
  const canvas = document.createElement('canvas');
  canvas.width = format.width;
  canvas.height = format.height;
  const ctx = canvas.getContext('2d', { alpha: false });
  if (!ctx) { bitmap.close?.(); throw new Error('Could not prepare the cover image.'); }
  // Use a soft, darkened backdrop to fill the platform canvas while keeping
  // the complete supplied artwork legible in the foreground. This avoids
  // cropping overlay text, logos, or a designed frame.
  const fillScale = Math.max(canvas.width / bitmap.width, canvas.height / bitmap.height);
  ctx.save();
  ctx.filter = 'blur(28px)';
  ctx.globalAlpha = 0.48;
  ctx.drawImage(bitmap, (canvas.width - bitmap.width * fillScale) / 2, (canvas.height - bitmap.height * fillScale) / 2, bitmap.width * fillScale, bitmap.height * fillScale);
  ctx.restore();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.24)';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const scale = Math.min(canvas.width / bitmap.width, canvas.height / bitmap.height);
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
  const dragging = useRef(false);
  const videoFile = files.find((file) => (file.type || file.raw?.type || '').startsWith('video/'));
  const timePercent = duration ? Math.max(0, Math.min(100, (time / duration) * 100)) : 0;
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

  const seekTo = (seconds) => {
    const next = Math.max(0, Math.min(duration || 0, Number(seconds) || 0));
    setTime(next);
    if (videoRef.current && Number.isFinite(next)) videoRef.current.currentTime = next;
  };
  const seekAtPointer = (event) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    if (!bounds.width || !duration) return;
    seekTo(((event.clientX - bounds.left) / bounds.width) * duration);
  };
  const onScrubberKeyDown = (event) => {
    const step = event.shiftKey ? 1 : 0.1;
    let next;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = time - step;
    else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = time + step;
    else if (event.key === 'PageDown') next = time - 5;
    else if (event.key === 'PageUp') next = time + 5;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = duration;
    else return;
    event.preventDefault();
    seekTo(next);
  };

  const label = platform === 'instagram' ? 'Instagram Reel cover' : platform === 'facebook' ? 'Facebook video cover' : 'YouTube thumbnail';
  return <section className="s3-cover-picker" aria-label={label}>
    <div className="s3-cover-head"><b>{label}</b><small>{FORMATS[platform].label} · video posts</small></div>
    {coverUrl && <div className={`s3-cover-preview ${platform}`}><img src={coverUrl} alt="Selected post cover preview" /><BorderGlow asChild className="btn-glow" backgroundColor="#071019" borderRadius={0} glowColor="199 95 74" colors={['#7dd3fc', '#4dc3f7', '#a5ddfa']} fillOpacity={0.3} glowRadius={12}><button type="button" onClick={() => onChange(null)} disabled={busy}>Remove</button></BorderGlow></div>}
    <div className="s3-cover-actions">
      <BorderGlow asChild className="btn-glow" backgroundColor="#071019" borderRadius={0} glowColor="199 95 74" colors={['#7dd3fc', '#4dc3f7', '#a5ddfa']} fillOpacity={0.3} glowRadius={12}><button type="button" className="s3-mini-btn" onClick={() => inputRef.current?.click()} disabled={busy}>{busy ? 'Preparing…' : 'Import cover image'}</button></BorderGlow>
      <input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(event) => { importCover(event.target.files?.[0]); event.target.value = ''; }} />
    </div>
    {videoUrl && <div className="s3-frame-picker">
      <video ref={videoRef} src={videoUrl} preload="metadata" muted playsInline onLoadedMetadata={(event) => { const length = Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0; setDuration(length); setTime((current) => Math.min(current, length)); }} />
      <div className="s3-frame-control">
        <div className="s3-frame-time"><span>Choose a video frame</span><b>{formatTime(time)} <small>/ {formatTime(duration)}</small></b></div>
        <div
          className={`s3-frame-scrubber${duration && !busy ? '' : ' disabled'}`}
          role="slider"
          tabIndex={duration && !busy ? 0 : -1}
          aria-label="Choose video frame for cover"
          aria-valuemin={0}
          aria-valuemax={Math.round(duration * 10) / 10}
          aria-valuenow={Math.round(time * 10) / 10}
          aria-valuetext={`${time.toFixed(1)} seconds`}
          aria-disabled={!duration || busy}
          onKeyDown={onScrubberKeyDown}
          onPointerDown={(event) => {
            if (!duration || busy) return;
            dragging.current = true;
            event.currentTarget.setPointerCapture?.(event.pointerId);
            seekAtPointer(event);
          }}
          onPointerMove={(event) => { if (dragging.current) seekAtPointer(event); }}
          onPointerUp={(event) => {
            dragging.current = false;
            if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onPointerCancel={() => { dragging.current = false; }}
        >
          <span className="s3-frame-track"><i style={{ width: `${timePercent}%` }} /></span>
          <span className="s3-frame-knob" style={{ left: `${timePercent}%` }} />
        </div>
        <div className="s3-frame-scale"><span>Start</span><span>{formatTime(duration)}</span></div>
      </div>
      <BorderGlow asChild className="btn-glow" backgroundColor="#071019" borderRadius={0} glowColor="199 95 74" colors={['#7dd3fc', '#4dc3f7', '#a5ddfa']} fillOpacity={0.3} glowRadius={12}><button type="button" className="s3-mini-btn" onClick={useFrame} disabled={!duration || busy}>Use selected frame</button></BorderGlow>
    </div>}
    {!videoUrl && <small className="s3-subnote">Attach a video in Stage 2 to choose a frame. Uploaded covers are prepared as {FORMATS[platform].label} JPEGs.</small>}
    {error && <p className="s3-err" role="alert">{error}</p>}
  </section>;
}
