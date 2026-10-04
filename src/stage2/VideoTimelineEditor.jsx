import React, { useEffect, useMemo, useRef, useState } from 'react';
import EpidemicCatalog from '../music/EpidemicCatalog.jsx';
import { mp4RecordingType } from '../music/mixVideoAudio.js';

const fmt = (value) => {
  const n = Number.isFinite(value) ? Math.max(0, value) : 0;
  return `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, '0')}.${String(Math.floor((n % 1) * 10))}`;
};

// Browser-only trim editor. It re-encodes the selected interval to WebM and
// carries the source audio track through when the browser exposes captureStream.
export default function VideoTimelineEditor({ entry, token, onBack, onApply, onApplyMusic, onRemoveMusic }) {
  const videoRef = useRef(null);
  const [duration, setDuration] = useState(0);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [playhead, setPlayhead] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [dragging, setDragging] = useState('');
  const [musicTrack, setMusicTrack] = useState(() => entry.musicTrack || null);
  const [musicSourceFile, setMusicSourceFile] = useState(() => entry.musicOriginalRaw || entry.raw);
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
    const mimeType = mp4RecordingType();
    if (!mimeType || !HTMLCanvasElement.prototype.captureStream) {
      setError('This browser cannot render a compatible MP4 here. Please use the latest Chrome or Edge.'); return;
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
      recorder = new MediaRecorder(outputStream, { mimeType, videoBitsPerSecond: 5_000_000, audioBitsPerSecond: 192_000 });
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
      const blob = new Blob(chunks, { type: recorder.mimeType || mimeType });
      if (!blob.size) throw new Error('The rendered clip is empty. Please retry.');
      const baseName = String(entry.name || 'video').replace(/\.[a-z0-9]+$/i, '');
      onApply(new File([blob], `${baseName}-trimmed.mp4`, { type: blob.type }));
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
  const timeFromPointer = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return Math.max(0, Math.min(duration, ((event.clientX - rect.left) / rect.width) * duration));
  };
  const movePlayhead = (time) => {
    const bounded = Math.max(start, Math.min(end, time));
    setPlayhead(bounded);
    if (videoRef.current) videoRef.current.currentTime = bounded;
  };
  const beginDrag = (kind, event) => {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragging(kind);
  };
  const dragTimeline = (event) => {
    if (!dragging || !duration) return;
    const time = timeFromPointer(event);
    if (dragging === 'start') clampStart(time);
    else if (dragging === 'end') clampEnd(time);
    else movePlayhead(time);
  };
  const handleKey = (kind, event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const delta = event.shiftKey ? 1 : 0.1;
    const current = kind === 'start' ? start : kind === 'end' ? end : playhead;
    const value = event.key === 'Home' ? 0 : event.key === 'End' ? duration : current + (event.key === 'ArrowLeft' ? -delta : delta);
    if (kind === 'start') clampStart(value);
    else if (kind === 'end') clampEnd(value);
    else movePlayhead(value);
  };
  const togglePlayback = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      if (video.currentTime < start || video.currentTime >= end) movePlayhead(start);
      video.play().catch(() => setError('Could not play this video in the browser.'));
    } else video.pause();
  };

  return (
    <div className="s2-video-editor-page" role="dialog" aria-modal="true" aria-label="Edit video timeline">
      <header className="s2-video-editor-head">
        <div><h2>Edit video</h2><p>Trim your clip in this browser. Original media is not uploaded by the editor.</p></div>
        <button type="button" className="s2-cancel" onClick={onBack} disabled={busy}>Back to crop tools</button>
      </header>
      <div className="s2-video-editor-workspace">
        <div className="s2-video-preview-wrap">
          <video ref={videoRef} src={url} playsInline preload="metadata" onTimeUpdate={(e) => {
            const time = e.currentTarget.currentTime;
            setPlayhead(time);
            if (playing && time >= end) e.currentTarget.pause();
            if (busy && time >= end) e.currentTarget.pause();
          }} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
          <div className="s2-video-transport">
            <button type="button" aria-label={playing ? 'Pause' : 'Play'} disabled={busy || !duration} onClick={togglePlayback}>{playing ? 'Pause' : 'Play'}</button>
            <span>{fmt(playhead)} <small>/ {fmt(duration)}</small></span>
            <button type="button" className="s2-editor-music" disabled={!duration || busy} onClick={() => movePlayhead(start)}>Go to start</button>
          </div>
        </div>
        <section className="s2-timeline" aria-label="Video timeline">
          <div className="s2-timeline-title"><div><span>Timeline</span><small>Drag the handles to trim · drag the playhead to scrub</small></div><b>Selected {fmt(Math.max(0, end - start))}</b></div>
          <div className="s2-timeline-ruler" aria-hidden="true">{[0, 0.25, 0.5, 0.75, 1].map((fraction) => <span key={fraction} style={{ left: `${fraction * 100}%` }}>{fmt(duration * fraction)}</span>)}</div>
          <div className={`s2-clip-track${dragging ? ' is-dragging' : ''}`} onPointerMove={dragTimeline} onPointerUp={() => setDragging('')} onPointerCancel={() => setDragging('')} onPointerDown={(event) => {
            if (event.target === event.currentTarget || event.target.classList.contains('s2-clip-strip')) movePlayhead(timeFromPointer(event));
          }}>
            <div className="s2-clip-strip" aria-hidden="true" />
            <div className="s2-clip-selected" style={{ left: `${duration ? start / duration * 100 : 0}%`, width: `${duration ? (end - start) / duration * 100 : 0}%` }} />
            <button type="button" className="s2-trim-handle start" style={{ left: `${duration ? start / duration * 100 : 0}%` }} role="slider" aria-label="Trim start" aria-valuemin="0" aria-valuemax={duration} aria-valuenow={start} disabled={!duration || busy} onPointerDown={(event) => beginDrag('start', event)} onKeyDown={(event) => handleKey('start', event)} />
            <button type="button" className="s2-trim-handle end" style={{ left: `${duration ? end / duration * 100 : 0}%` }} role="slider" aria-label="Trim end" aria-valuemin="0" aria-valuemax={duration} aria-valuenow={end} disabled={!duration || busy} onPointerDown={(event) => beginDrag('end', event)} onKeyDown={(event) => handleKey('end', event)} />
            <button type="button" className="s2-playhead" style={{ left: `${duration ? playhead / duration * 100 : 0}%` }} aria-label="Timeline playhead" aria-valuemin="0" aria-valuemax={duration} aria-valuenow={playhead} role="slider" disabled={!duration || busy} onPointerDown={(event) => beginDrag('playhead', event)} onKeyDown={(event) => handleKey('playhead', event)} />
          </div>
          <div className={`s2-audio-track${musicTrack ? ' has-music' : ''}`}>
            <div className="s2-audio-track-label"><b>AUDIO</b><span>{musicTrack ? `${musicTrack.title || musicTrack.name || 'Music'}${musicTrack.mainArtists?.[0]?.name ? ` · ${musicTrack.mainArtists[0].name}` : ''}` : 'No music added'}</span></div>
            <div className="s2-audio-lane" aria-label={musicTrack ? 'Added music track' : 'Empty audio track'}>
              {musicTrack && <div className="s2-audio-clip" style={{ left: 0, width: '100%' }}><span>{musicTrack.title || musicTrack.name || 'Music'}</span></div>}
              {!musicTrack && <span className="s2-audio-empty">Choose a soundtrack below</span>}
            </div>
            {musicTrack && <button type="button" className="s2-audio-remove" onClick={async () => {
              await onRemoveMusic();
              setMusicTrack(null);
              setMusicSourceFile(entry.musicOriginalRaw || musicSourceFile);
            }}>Remove</button>}
          </div>
          <div className="s2-timeline-values">
            <label>In <input type="number" min="0" max={Math.max(0, end - 0.25)} step="0.1" value={start.toFixed(1)} disabled={!duration || busy} onChange={(event) => clampStart(event.target.value)} /></label>
            <label>Out <input type="number" min={Math.min(duration, start + 0.25)} max={duration} step="0.1" value={end.toFixed(1)} disabled={!duration || busy} onChange={(event) => clampEnd(event.target.value)} /></label>
          </div>
          <div className="s2-timeline-actions">
            <button type="button" className="s2-editor-music" disabled={!duration || busy} onClick={() => { movePlayhead(start); videoRef.current.play().catch(() => setError('Could not play this video in the browser.')); }}>Preview selection</button>
            <button type="button" className="s2-done" disabled={!duration || busy} onClick={renderTrim}>{busy ? `Rendering… ${progress}%` : 'Render trimmed video'}</button>
          </div>
          {busy && <progress className="s2-trim-progress" max="100" value={progress} aria-label="Render progress" />}
          {error && <p className="s2-trim-error" role="alert">{error}</p>}
          <div className="s2-editor-music-catalog">
            <EpidemicCatalog
              token={token}
              files={[{ ...entry, raw: musicSourceFile || entry.raw }]}
              selectedIndex={0}
              onSelectVideo={() => {}}
              summaryLabel={musicTrack ? 'Replace or preview music' : 'Add music to audio track'}
              onApply={async (_index, mixedFile, track) => {
                await onApplyMusic(mixedFile, track);
                setMusicTrack(track);
              }}
            />
          </div>
        </section>
      </div>
    </div>
  );
}
