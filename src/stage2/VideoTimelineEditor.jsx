import React, { useEffect, useMemo, useRef, useState } from 'react';

const fmt = (value) => {
  const n = Number.isFinite(value) ? Math.max(0, value) : 0;
  return `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, '0')}.${String(Math.floor((n % 1) * 10))}`;
};

// Browser-only trim editor. It re-encodes the selected interval to WebM and
// carries the source audio track through when the browser exposes captureStream.
export default function VideoTimelineEditor({ entry, onBack, onApply }) {
  const videoRef = useRef(null);
  const [duration, setDuration] = useState(0);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const url = useMemo(() => URL.createObjectURL(entry.raw), [entry]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    const onMetadata = () => {
      const d = Number.isFinite(video.duration) ? video.duration : 0;
      setDuration(d);
      setEnd(d);
    };
    video.addEventListener('loadedmetadata', onMetadata);
    if (video.readyState >= 1) onMetadata();
    return () => video.removeEventListener('loadedmetadata', onMetadata);
  }, [entry]);

  const seek = (time) => new Promise((resolve, reject) => {
    const video = videoRef.current;
    if (!video) return reject(new Error('Preview is not ready.'));
    if (Math.abs(video.currentTime - time) < 0.04) return resolve();
    const done = () => { cleanup(); resolve(); };
    const fail = () => { cleanup(); reject(new Error('Could not seek this video.')); };
    const cleanup = () => {
      video.removeEventListener('seeked', done);
      video.removeEventListener('error', fail);
    };
    video.addEventListener('seeked', done, { once: true });
    video.addEventListener('error', fail, { once: true });
    video.currentTime = time;
  });

  const renderTrim = async () => {
    setError('');
    const video = videoRef.current;
    if (!video || !duration) { setError('Video is still loading. Try again in a moment.'); return; }
    if (end - start < 0.25) { setError('Choose a section at least 0.25 seconds long.'); return; }
    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
      setError('Video trimming is not supported in this browser. Please use the latest Chrome or Edge.'); return;
    }
    setBusy(true); setProgress(0);
    let recorder;
    let outputStream;
    let sourceStream;
    let raf = 0;
    try {
      video.pause();
      await seek(start);
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 1280 / Math.max(video.videoWidth, video.videoHeight));
      canvas.width = Math.max(2, Math.round(video.videoWidth * scale / 2) * 2);
      canvas.height = Math.max(2, Math.round(video.videoHeight * scale / 2) * 2);
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not start the video renderer.');
      outputStream = canvas.captureStream(30);
      const capture = video.captureStream || video.mozCaptureStream;
      if (capture) {
        sourceStream = capture.call(video);
        sourceStream.getAudioTracks().forEach((track) => outputStream.addTrack(track));
      }
      const candidates = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
      const mimeType = candidates.find((type) => MediaRecorder.isTypeSupported(type)) || '';
      recorder = new MediaRecorder(outputStream, mimeType ? { mimeType } : undefined);
      const chunks = [];
      recorder.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data); };
      const stopped = new Promise((resolve, reject) => {
        recorder.onstop = resolve;
        recorder.onerror = () => reject(new Error('The browser could not render this video.'));
      });
      let ended = false;
      const draw = () => {
        if (ended) return;
        if (video.readyState >= 2) ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const elapsed = Math.max(0, video.currentTime - start);
        setProgress(Math.min(100, Math.round((elapsed / (end - start)) * 100)));
        if (video.currentTime >= end || video.ended) {
          ended = true;
          video.pause();
          if (recorder.state !== 'inactive') recorder.stop();
          return;
        }
        raf = requestAnimationFrame(draw);
      };
      recorder.start(250);
      await video.play();
      draw();
      await stopped;
      cancelAnimationFrame(raf);
      const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
      if (!blob.size) throw new Error('The rendered clip is empty. Please retry.');
      const baseName = String(entry.name || 'video').replace(/\.[a-z0-9]+$/i, '');
      onApply(new File([blob], `${baseName}-trimmed.webm`, { type: blob.type }));
    } catch (err) {
      setError(err?.message || 'Could not render this trimmed video. Try Chrome or Edge.');
    } finally {
      cancelAnimationFrame(raf);
      try { if (recorder && recorder.state !== 'inactive') recorder.stop(); } catch {}
      try { sourceStream?.getTracks().forEach((track) => track.stop()); } catch {}
      try { outputStream?.getTracks().forEach((track) => track.stop()); } catch {}
      if (videoRef.current) videoRef.current.pause();
      setBusy(false);
    }
  };

  const clampStart = (raw) => setStart(Math.min(Number(raw), Math.max(0, end - 0.25)));
  const clampEnd = (raw) => setEnd(Math.max(Number(raw), Math.min(duration, start + 0.25)));

  return (
    <div className="s2-video-editor-page" role="dialog" aria-modal="true" aria-label="Edit video timeline">
      <header className="s2-video-editor-head">
        <div><h2>Edit video</h2><p>Trim your clip in this browser. Original media is not uploaded by the editor.</p></div>
        <button type="button" className="s2-cancel" onClick={onBack} disabled={busy}>Back to crop tools</button>
      </header>
      <div className="s2-video-editor-body">
        <video ref={videoRef} src={url} controls playsInline preload="metadata" onTimeUpdate={(e) => {
          if (busy && e.currentTarget.currentTime >= end) e.currentTarget.pause();
        }} />
        <div className="s2-timeline">
          <div className="s2-timeline-label"><span>Trim range</span><b>{fmt(start)} – {fmt(end)} <small>/ {fmt(duration)}</small></b></div>
          <label>Start <input type="range" min="0" max={Math.max(duration, 0.1)} step="0.1" value={start} disabled={!duration || busy} onChange={(e) => clampStart(e.target.value)} /></label>
          <label>End <input type="range" min="0" max={Math.max(duration, 0.1)} step="0.1" value={end} disabled={!duration || busy} onChange={(e) => clampEnd(e.target.value)} /></label>
          <div className="s2-timeline-actions">
            <button type="button" className="s2-editor-music" disabled={!duration || busy} onClick={() => { videoRef.current.currentTime = start; videoRef.current.play().catch(() => {}); }}>Preview trim</button>
            <button type="button" className="s2-done" disabled={!duration || busy} onClick={renderTrim}>{busy ? `Rendering… ${progress}%` : 'Render trimmed video'}</button>
          </div>
          {busy && <progress className="s2-trim-progress" max="100" value={progress} aria-label="Render progress" />}
          {error && <p className="s2-trim-error" role="alert">{error}</p>}
        </div>
      </div>
    </div>
  );
}
