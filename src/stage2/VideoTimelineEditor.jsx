import React, { useEffect, useMemo, useRef, useState } from 'react';

const MIN_CLIP_SECONDS = 0.5;
const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2];

function fmtTime(seconds) {
  const safe = Math.max(0, Number(seconds) || 0);
  const mins = Math.floor(safe / 60);
  const secs = Math.floor(safe % 60);
  const tenths = Math.floor((safe % 1) * 10);
  return `${mins}:${String(secs).padStart(2, '0')}.${tenths}`;
}

function recordingMimeType() {
  if (typeof MediaRecorder === 'undefined') return '';
  const candidates = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4;codecs=avc1,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  return candidates.find((type) => !MediaRecorder.isTypeSupported || MediaRecorder.isTypeSupported(type)) || '';
}

function waitForEvent(target, name, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for ${name}`));
    }, timeoutMs);
    const onDone = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error('Could not read the selected video.')); };
    const cleanup = () => {
      window.clearTimeout(timer);
      target.removeEventListener(name, onDone);
      target.removeEventListener('error', onError);
    };
    target.addEventListener(name, onDone, { once: true });
    target.addEventListener('error', onError, { once: true });
  });
}

export default function VideoTimelineEditor({ file, onApply, onClose }) {
  const videoRef = useRef(null);
  const timelineRef = useRef(null);
  const dragModeRef = useRef(null);
  const dragOriginRef = useRef({ clientX: 0, start: 0, end: 0 });
  const [duration, setDuration] = useState(0);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loopTrim, setLoopTrim] = useState(true);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(100);
  const [speed, setSpeed] = useState(1);
  const [filmstrip, setFilmstrip] = useState([]);
  const [busy, setBusy] = useState(false);
  const [renderPct, setRenderPct] = useState(0);
  const [error, setError] = useState('');

  const videoUrl = useMemo(() => (file?.raw ? URL.createObjectURL(file.raw) : ''), [file]);
  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl); }, [videoUrl]);

  // Extract a visual filmstrip of thumbnails across the video duration
  useEffect(() => {
    if (!videoUrl || !duration || duration <= 0) {
      setFilmstrip([]);
      return undefined;
    }
    let cancelled = false;
    const thumbs = [];
    const probe = document.createElement('video');
    probe.src = videoUrl;
    probe.muted = true;
    probe.playsInline = true;
    probe.preload = 'auto';
    (async () => {
      try {
        await waitForEvent(probe, 'loadeddata', 6000);
        const count = 8;
        const canvas = document.createElement('canvas');
        const ratio = (probe.videoWidth || 16) / (probe.videoHeight || 9);
        canvas.height = 56;
        canvas.width = Math.max(36, Math.round(56 * ratio));
        const ctx = canvas.getContext('2d');
        for (let i = 0; i < count; i++) {
          if (cancelled) return;
          const t = Math.min(Math.max(0, duration - 0.05), ((i + 0.5) / count) * duration);
          probe.currentTime = t;
          await waitForEvent(probe, 'seeked', 2500).catch(() => {});
          if (cancelled) return;
          ctx?.drawImage(probe, 0, 0, canvas.width, canvas.height);
          thumbs.push(canvas.toDataURL('image/jpeg', 0.65));
        }
        if (!cancelled) setFilmstrip(thumbs);
      } catch {
        // Filmstrip is a visual aid; ignore extraction failures
      } finally {
        probe.removeAttribute('src');
        probe.load();
      }
    })();
    return () => { cancelled = true; };
  }, [videoUrl, duration]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = muted;
    v.volume = Math.max(0, Math.min(1, volume / 100));
  }, [muted, volume]);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = speed;
  }, [speed]);

  useEffect(() => {
    const onKey = (e) => {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        stepTime(e.shiftKey ? -1 : -0.1);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        stepTime(e.shiftKey ? 1 : 0.1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const clampStart = (value) => {
    const maxStart = Math.max(0, (end || duration) - MIN_CLIP_SECONDS);
    return Math.max(0, Math.min(Number(value) || 0, maxStart));
  };

  const clampEnd = (value) => {
    const minEnd = Math.min(duration, start + MIN_CLIP_SECONDS);
    return Math.min(duration, Math.max(Number(value) || 0, minEnd));
  };

  const seekTo = (time) => {
    const video = videoRef.current;
    const bounded = Math.max(start, Math.min(end || duration, Number(time) || 0));
    setCurrentTime(bounded);
    if (video && Number.isFinite(bounded)) video.currentTime = bounded;
  };

  const stepTime = (delta) => {
    const video = videoRef.current;
    if (video && !video.paused) video.pause();
    seekTo((video?.currentTime ?? currentTime) + delta);
  };

  const updateFromPointer = (clientX, mode = dragModeRef.current) => {
    const bar = timelineRef.current;
    if (!bar || !duration || !mode) return;
    const rect = bar.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
    const time = Number((ratio * duration).toFixed(2));
    if (mode === 'start') {
      const next = clampStart(time);
      setStart(next);
      seekTo(next);
      return;
    }
    if (mode === 'end') {
      const next = clampEnd(time);
      setEnd(next);
      seekTo(next);
      return;
    }
    if (mode === 'range') {
      const deltaSec = ((clientX - dragOriginRef.current.clientX) / Math.max(1, rect.width)) * duration;
      const span = dragOriginRef.current.end - dragOriginRef.current.start;
      let nextStart = Math.max(0, Math.min(duration - span, dragOriginRef.current.start + deltaSec));
      let nextEnd = nextStart + span;
      setStart(Number(nextStart.toFixed(2)));
      setEnd(Number(nextEnd.toFixed(2)));
      seekTo(nextStart);
      return;
    }
    seekTo(time);
  };

  const startHandleDrag = (mode, event) => {
    event.preventDefault();
    event.stopPropagation();
    dragModeRef.current = mode;
    dragOriginRef.current = { clientX: event.clientX, start, end };
    event.currentTarget.setPointerCapture?.(event.pointerId);
    if (mode !== 'range') updateFromPointer(event.clientX, mode);
  };

  const moveHandleDrag = (event) => {
    if (!dragModeRef.current) return;
    updateFromPointer(event.clientX);
  };

  const stopHandleDrag = (event) => {
    if (dragModeRef.current && event?.currentTarget?.hasPointerCapture?.(event.pointerId)) {
      try { event.currentTarget.releasePointerCapture(event.pointerId); } catch {}
    }
    dragModeRef.current = null;
  };

  const togglePlay = async () => {
    const video = videoRef.current;
    if (!video) return;
    setError('');
    if (!video.paused) {
      video.pause();
      return;
    }
    if (video.currentTime < start || video.currentTime >= end - 0.05) video.currentTime = start;
    try {
      await video.play();
    } catch {
      setError('Click the video preview once if your browser blocked playback.');
    }
  };

  const resetTrim = () => {
    setStart(0);
    setEnd(duration);
    setMuted(false);
    setVolume(100);
    setSpeed(1);
    seekTo(0);
  };

  const renderTrim = async () => {
    const clipLength = (end - start) / speed;
    if (busy || clipLength < MIN_CLIP_SECONDS) return;
    const isUnchanged = start <= 0.05 && Math.abs(end - duration) <= 0.08 && !muted && volume === 100 && speed === 1;
    if (isUnchanged) {
      onApply(file.raw);
      return;
    }

    setBusy(true);
    setRenderPct(1);
    setError('');

    const src = document.createElement('video');
    src.src = videoUrl;
    src.playsInline = true;
    src.preload = 'auto';
    src.crossOrigin = 'anonymous';
    let audioCtx = null;
    try {
      await waitForEvent(src, 'loadedmetadata', 8000);
      const maxEdge = 1920;
      const scale = Math.min(1, maxEdge / Math.max(src.videoWidth || 1, src.videoHeight || 1));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(2, Math.round((src.videoWidth || 1280) * scale));
      canvas.height = Math.max(2, Math.round((src.videoHeight || 720) * scale));
      if (canvas.width % 2 !== 0) canvas.width -= 1;
      if (canvas.height % 2 !== 0) canvas.height -= 1;
      const ctx = canvas.getContext('2d');
      if (!ctx || typeof canvas.captureStream !== 'function' || typeof MediaRecorder === 'undefined') {
        throw new Error('This browser cannot export trimmed videos.');
      }

      const stream = canvas.captureStream(30);
      if (!muted && volume > 0) {
        try {
          const AudioContextClass = window.AudioContext || window.webkitAudioContext;
          if (AudioContextClass) {
            audioCtx = new AudioContextClass();
            await audioCtx.resume().catch(() => {});
            const sourceNode = audioCtx.createMediaElementSource(src);
            const gainNode = audioCtx.createGain();
            gainNode.gain.value = Math.max(0, Math.min(1.5, volume / 100));
            const destNode = audioCtx.createMediaStreamDestination();
            sourceNode.connect(gainNode);
            gainNode.connect(destNode);
            destNode.stream.getAudioTracks().forEach((track) => stream.addTrack(track));
          }
        } catch {
          const fallbackStream = src.captureStream?.() || src.mozCaptureStream?.();
          fallbackStream?.getAudioTracks?.().forEach((track) => stream.addTrack(track));
        }
      } else {
        src.muted = true;
      }

      const mimeType = recordingMimeType();
      const recorder = new MediaRecorder(stream, {
        ...(mimeType ? { mimeType } : {}),
        videoBitsPerSecond: 8_000_000,
      });
      const chunks = [];
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunks.push(event.data);
      };
      const stopped = new Promise((resolve, reject) => {
        recorder.onstop = resolve;
        recorder.onerror = (event) => reject(event.error || new Error('Video export failed.'));
      });

      src.currentTime = start;
      await waitForEvent(src, 'seeked', 5000).catch(() => {});
      src.playbackRate = speed;
      ctx.drawImage(src, 0, 0, canvas.width, canvas.height);

      recorder.start(150);
      await src.play();

      await new Promise((resolve) => {
        let raf = 0;
        const finish = () => {
          window.cancelAnimationFrame(raf);
          src.pause();
          if (recorder.state !== 'inactive') recorder.stop();
          resolve();
        };
        const paint = () => {
          if (src.readyState >= 2) ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
          const progress = Math.max(1, Math.min(99, Math.round(((src.currentTime - start) / Math.max(0.1, end - start)) * 100)));
          setRenderPct(progress);
          if (src.ended || src.currentTime >= end - 0.02) {
            finish();
            return;
          }
          raf = window.requestAnimationFrame(paint);
        };
        raf = window.requestAnimationFrame(paint);
      });

      await stopped;
      stream.getTracks().forEach((track) => track.stop());
      const outType = recorder.mimeType || mimeType || 'video/mp4';
      const ext = outType.includes('mp4') ? 'mp4' : 'webm';
      const base = (file?.name || 'clip').replace(/\.[^.]+$/, '');
      const blob = new Blob(chunks, { type: outType });
      if (!blob.size) throw new Error('Trimmed video was empty. Try again.');
      const trimmedFile = new File([blob], `${base}-trimmed.${ext}`, { type: outType });
      onApply(trimmedFile);
    } catch (err) {
      setError(err.message || 'Could not trim this video.');
    } finally {
      try { src.pause(); src.removeAttribute('src'); src.load(); } catch {}
      try { await audioCtx?.close?.(); } catch {}
      setBusy(false);
      setRenderPct(0);
    }
  };

  const clipSpan = Math.max(0, end - start);
  const effectiveDuration = speed > 0 ? clipSpan / speed : clipSpan;
  const startPct = duration ? Math.max(0, Math.min(100, (start / duration) * 100)) : 0;
  const endPct = duration ? Math.max(startPct, Math.min(100, (end / duration) * 100)) : 100;
  const playheadPct = duration ? Math.max(startPct, Math.min(endPct, (currentTime / duration) * 100)) : 0;

  return (
    <section className="s2-timeline-page" aria-label="Video trimming studio">
      <header className="s2-timeline-topbar">
        <button type="button" className="s2-studio-btn ghost" onClick={onClose} disabled={busy}>
          ← Back to editor
        </button>
        <div className="s2-timeline-title">
          <strong>Trim &amp; Audio Studio</strong>
          <span>{file?.name || 'Selected video'} · Output {fmtTime(effectiveDuration)}</span>
        </div>
        <div className="s2-timeline-top-actions">
          <button type="button" className="s2-studio-btn ghost" onClick={resetTrim} disabled={busy || !duration}>
            Reset
          </button>
          <button type="button" className="s2-studio-btn primary" onClick={renderTrim} disabled={busy || clipSpan < MIN_CLIP_SECONDS}>
            {busy ? `Exporting ${renderPct}%…` : 'Apply Trim'}
          </button>
        </div>
      </header>

      <div className="s2-timeline-stage">
        <div className="s2-timeline-player">
          <video
            ref={videoRef}
            src={videoUrl}
            playsInline
            preload="metadata"
            onClick={togglePlay}
            onLoadedMetadata={(event) => {
              const total = Number(event.currentTarget.duration) || 0;
              setDuration(total);
              setStart(0);
              setEnd(total);
              setCurrentTime(0);
            }}
            onTimeUpdate={(event) => {
              const now = event.currentTarget.currentTime;
              if (end && now >= end) {
                if (loopTrim) {
                  event.currentTarget.currentTime = start;
                  setCurrentTime(start);
                  event.currentTarget.play().catch(() => {});
                } else {
                  event.currentTarget.pause();
                  event.currentTarget.currentTime = start;
                  setCurrentTime(start);
                }
                return;
              }
              setCurrentTime(now);
            }}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
          />
          <div className="s2-timeline-transport">
            <div className="s2-transport-left">
              <button type="button" className="s2-studio-btn primary" onClick={togglePlay} disabled={!duration || busy}>
                {playing ? '⏸ Pause' : '▶ Play'}
              </button>
              <button type="button" className="s2-studio-btn icon" onClick={() => stepTime(-0.1)} disabled={!duration || busy} title="Step back 0.1s (←)">
                −0.1s
              </button>
              <button type="button" className="s2-studio-btn icon" onClick={() => stepTime(0.1)} disabled={!duration || busy} title="Step forward 0.1s (→)">
                +0.1s
              </button>
              <button
                type="button"
                className={loopTrim ? 's2-studio-btn active' : 's2-studio-btn ghost'}
                onClick={() => setLoopTrim((v) => !v)}
                disabled={busy}
                title="Loop trimmed section"
              >
                ↻ Loop
              </button>
            </div>
            <div className="s2-timeline-readout">
              <span><b>In</b> {fmtTime(start)}</span>
              <span><b>Now</b> {fmtTime(currentTime)}</span>
              <span><b>Out</b> {fmtTime(end)}</span>
              <span className="accent"><b>Clip</b> {fmtTime(effectiveDuration)}</span>
            </div>
          </div>
        </div>
      </div>

      <footer className="s2-timeline-dock">
        <div className="s2-timeline-controls-grid">
          <div className="s2-timeline-control-card">
            <label>
              <span>In Point (Start)</span>
              <div className="s2-time-stepper">
                <button type="button" onClick={() => { const n = clampStart(start - 0.1); setStart(n); seekTo(n); }} disabled={busy}>−</button>
                <input
                  type="number"
                  min={0}
                  max={Math.max(0, end - MIN_CLIP_SECONDS)}
                  step="0.1"
                  value={Number(start.toFixed(1))}
                  disabled={busy || !duration}
                  onChange={(e) => { const n = clampStart(e.target.value); setStart(n); seekTo(n); }}
                />
                <button type="button" onClick={() => { const n = clampStart(start + 0.1); setStart(n); seekTo(n); }} disabled={busy}>+</button>
              </div>
            </label>
            <label>
              <span>Out Point (End)</span>
              <div className="s2-time-stepper">
                <button type="button" onClick={() => { const n = clampEnd(end - 0.1); setEnd(n); seekTo(n); }} disabled={busy}>−</button>
                <input
                  type="number"
                  min={Math.min(duration, start + MIN_CLIP_SECONDS)}
                  max={duration}
                  step="0.1"
                  value={Number(end.toFixed(1))}
                  disabled={busy || !duration}
                  onChange={(e) => { const n = clampEnd(e.target.value); setEnd(n); seekTo(n); }}
                />
                <button type="button" onClick={() => { const n = clampEnd(end + 0.1); setEnd(n); seekTo(n); }} disabled={busy}>+</button>
              </div>
            </label>
          </div>

          <div className="s2-timeline-control-card">
            <label>
              <span>Audio Volume ({muted ? 'Muted' : `${volume}%`})</span>
              <div className="s2-audio-row">
                <button
                  type="button"
                  className={muted ? 's2-studio-btn active' : 's2-studio-btn ghost'}
                  onClick={() => setMuted((m) => !m)}
                  disabled={busy}
                >
                  {muted ? '🔇 Muted' : '🔊 Audio On'}
                </button>
                <input
                  type="range"
                  min={0}
                  max={150}
                  value={muted ? 0 : volume}
                  disabled={busy}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setVolume(v);
                    if (v > 0 && muted) setMuted(false);
                  }}
                />
              </div>
            </label>
            <label>
              <span>Playback Speed</span>
              <div className="s2-speed-pills">
                {SPEEDS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className={speed === s ? 's2-studio-pill on' : 's2-studio-pill'}
                    onClick={() => setSpeed(s)}
                    disabled={busy}
                  >
                    {s}x
                  </button>
                ))}
              </div>
            </label>
          </div>
        </div>

        <div
          ref={timelineRef}
          className="s2-timeline-bar"
          onPointerDown={(event) => startHandleDrag('playhead', event)}
          onPointerMove={moveHandleDrag}
          onPointerUp={stopHandleDrag}
          onPointerCancel={stopHandleDrag}
        >
          <div className="s2-timeline-filmstrip" aria-hidden="true">
            {filmstrip.length > 0
              ? filmstrip.map((src, idx) => <img key={idx} src={src} alt="" draggable={false} />)
              : Array.from({ length: 24 }).map((_, index) => <i key={index} className="s2-filmstrip-tick" />)}
          </div>
          <div className="s2-timeline-shade left" style={{ width: `${startPct}%` }} />
          <div className="s2-timeline-shade right" style={{ width: `${Math.max(0, 100 - endPct)}%` }} />
          <div
            className="s2-timeline-range"
            style={{ left: `${startPct}%`, width: `${Math.max(0.5, endPct - startPct)}%` }}
            title="Drag to slide trimmed window"
            onPointerDown={(event) => startHandleDrag('range', event)}
          />
          <button
            type="button"
            className="s2-trim-handle start"
            style={{ left: `${startPct}%` }}
            aria-label="Trim start handle"
            onPointerDown={(event) => startHandleDrag('start', event)}
          />
          <button
            type="button"
            className="s2-trim-handle end"
            style={{ left: `${endPct}%` }}
            aria-label="Trim end handle"
            onPointerDown={(event) => startHandleDrag('end', event)}
          />
          <button
            type="button"
            className="s2-playhead"
            style={{ left: `${playheadPct}%` }}
            aria-label="Timeline playhead"
            onPointerDown={(event) => startHandleDrag('playhead', event)}
          />
        </div>

        <div className="s2-timeline-scale">
          <span>0:00.0</span>
          <span>Drag yellow brackets to trim · Drag inside box to slip window · Space to play/pause</span>
          <span>{fmtTime(duration)}</span>
        </div>

        {error && <p className="s2-err" role="alert">{error}</p>}
      </footer>
    </section>
  );
}
