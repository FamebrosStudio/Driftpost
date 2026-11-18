import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, apiRequestUrl } from '../lib.js';
import { isAiAccount } from '../ai-access.js';
import { compactImage, mapResponse as mapAiCaptions, sampleVideo } from '../stage2/ai.js';
import { FAMEBROS_INSTAGRAM_TAGGING_LIST, getAssignedInstagramTagsForBrand } from '../stage3/instagramCollaborators.js';
import { WorkspaceNav } from './Workspace.jsx';
import BorderGlow from '../components/reactbits/BorderGlow.jsx';
import './team-video.css';

export default function TeamVideoPage({ session, onNavigate, onSignOut }) {
  const [driveState, setDriveState] = useState({ loading: true, connected: false, error: '' });
  const [driveJobs, setDriveJobs] = useState([]);
  const [driveBusy, setDriveBusy] = useState(false);
  const [driveScanTick, setDriveScanTick] = useState(0);
  const [driveScanError, setDriveScanError] = useState('');

  const [mediaFiles, setMediaFiles] = useState([]);
  const [coverMode, setCoverMode] = useState('auto'); // 'auto' | 'frame' | 'upload'
  const [coverFile, setCoverFile] = useState(null);
  const [coverLabel, setCoverLabel] = useState('');
  const [filmstrip, setFilmstrip] = useState([]);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoTime, setVideoTime] = useState(0);
  const [coverBusy, setCoverBusy] = useState(false);
  const coverVideoRef = useRef(null);
  const [description, setDescription] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadPercent, setUploadPercent] = useState(0);
  const [generatingCaptions, setGeneratingCaptions] = useState(false);
  const [captionStage, setCaptionStage] = useState('');
  const [generatedCaptions, setGeneratedCaptions] = useState(null);
  const [captionMeta, setCaptionMeta] = useState({ brand: null, platforms: [], instagramTags: [], usedDesc: false });
  const [captionPlatform, setCaptionPlatform] = useState('instagram');
  const [copiedKey, setCopiedKey] = useState('');
  const [stoppingJobId, setStoppingJobId] = useState('');
  const [inboxOpen, setInboxOpen] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const file = mediaFiles[0] || null;
  const isVideoSelection = Boolean(file?.type?.startsWith('video/'));
  const hasActiveJobs = driveJobs.some((job) => ['queued', 'processing', 'publishing'].includes(job?.status));

  const videoPreviewUrl = useMemo(() => {
    if (!isVideoSelection || !file) return '';
    try { return URL.createObjectURL(file); } catch { return ''; }
  }, [isVideoSelection, file]);

  const coverPreviewUrl = useMemo(() => {
    if (!coverFile) return '';
    try { return URL.createObjectURL(coverFile); } catch { return ''; }
  }, [coverFile]);

  useEffect(() => () => { if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl); }, [videoPreviewUrl]);
  useEffect(() => () => { if (coverPreviewUrl) URL.revokeObjectURL(coverPreviewUrl); }, [coverPreviewUrl]);

  const formatTime = (sec = 0) => {
    const v = Math.max(0, Math.floor(Number(sec) || 0));
    return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
  };

  const resetCoverState = () => {
    setCoverMode('auto');
    setCoverFile(null);
    setCoverLabel('');
    setFilmstrip([]);
    setVideoDuration(0);
    setVideoTime(0);
    setGeneratedCaptions(null);
    setCaptionMeta({ brand: null, platforms: [], instagramTags: [], usedDesc: false });
    setCopiedKey('');
  };

  const handleGenerateCaptions = async () => {
    setError('');
    setNotice('');
    if (!isAiAccount(session.user?.email)) return setError('This private team workflow is not available for this account.');
    if (!mediaFiles.length) return setError('Choose a video or carousel images first.');
    const trimmedDesc = description.trim();
    setGeneratingCaptions(true);
    setCaptionStage(isVideoSelection ? 'Analyzing video, audio & brand…' : 'Analyzing media & brand…');
    try {
      const photos = mediaFiles.filter((item) => item.type?.startsWith('image/')).slice(0, 6);
      const video = mediaFiles.find((item) => item.type?.startsWith('video/')) || null;
      const frames = video ? await sampleVideo(video, 6) : [];
      const selectedImages = video ? frames : photos;
      const compacted = await Promise.all(selectedImages.map((item) => compactImage(item)));
      const form = new FormData();
      compacted.filter(Boolean).forEach((img) => form.append('images', img, img.name));
      if (video) form.append('video', video, video.name || 'video.mp4');
      form.append('fileName', (video || photos[0])?.name || '');
      form.append('isVideo', video ? '1' : '0');
      form.append('description', trimmedDesc);
      setCaptionStage('Routing brand & writing captions…');
      const data = await api('/api/intake/preview-captions', session.access_token, {
        method: 'POST',
        body: form,
      });
      const mapped = mapAiCaptions(data);
      const resolvedPlatforms = Array.isArray(data?.platforms) && data.platforms.length
        ? data.platforms
        : ['instagram', 'youtube', 'facebook', 'x'];
      setGeneratedCaptions(mapped);
      setCaptionMeta({
        brand: data?.brand || null,
        platforms: resolvedPlatforms,
        instagramTags: Array.isArray(data?.instagramTags) ? data.instagramTags : [],
        usedDesc: Boolean(trimmedDesc),
      });
      setCaptionPlatform(resolvedPlatforms.includes(captionPlatform) ? captionPlatform : resolvedPlatforms[0]);
      setCopiedKey('');
    } catch (e) {
      setError(e?.message || 'Could not generate captions from this media.');
    } finally {
      setGeneratingCaptions(false);
      setCaptionStage('');
    }
  };

  const copyText = async (key, value) => {
    const text = String(value || '');
    if (!text.trim()) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((cur) => (cur === key ? '' : cur)), 1800);
    } catch {
      setError('Could not copy to clipboard.');
    }
  };

  const captureVideoFrameAt = async (videoEl, targetSec) => {
    if (!videoEl || !videoEl.videoWidth || !videoEl.videoHeight) throw new Error('Video preview is still loading.');
    const clamped = Math.max(0, Math.min(videoEl.duration || 0, targetSec));
    if (Math.abs(videoEl.currentTime - clamped) > 0.03) {
      await new Promise((resolve, reject) => {
        const timer = window.setTimeout(() => { cleanup(); reject(new Error('Frame seek timed out.')); }, 8000);
        const onSeeked = () => { cleanup(); resolve(); };
        const onErr = () => { cleanup(); reject(new Error('Could not read video frame.')); };
        const cleanup = () => {
          window.clearTimeout(timer);
          videoEl.removeEventListener('seeked', onSeeked);
          videoEl.removeEventListener('error', onErr);
        };
        videoEl.addEventListener('seeked', onSeeked, { once: true });
        videoEl.addEventListener('error', onErr, { once: true });
        videoEl.currentTime = clamped;
      });
    }
    const canvas = document.createElement('canvas');
    canvas.width = videoEl.videoWidth;
    canvas.height = videoEl.videoHeight;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('Could not capture frame.');
    ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve, reject) => canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Could not encode cover frame.'))),
      'image/jpeg',
      0.9,
    ));
    const coverImg = new File([blob], `manual-cover-${Math.round(clamped * 10)}ds.jpg`, { type: 'image/jpeg' });
    return { file: coverImg, preview: URL.createObjectURL(blob), time: clamped };
  };

  const buildFilmstrip = async (videoEl) => {
    if (!videoEl || !videoEl.duration || !Number.isFinite(videoEl.duration) || filmstrip.length) return;
    const dur = videoEl.duration;
    const fractions = [0.06, 0.22, 0.4, 0.58, 0.76, 0.92];
    const items = [];
    for (const frac of fractions) {
      try {
        const shot = await captureVideoFrameAt(videoEl, dur * frac);
        items.push(shot);
      } catch {}
    }
    if (items.length) setFilmstrip(items);
    try { videoEl.currentTime = 0; } catch {}
  };

  useEffect(() => () => {
    for (const item of filmstrip) if (item?.preview) URL.revokeObjectURL(item.preview);
  }, [filmstrip]);

  useEffect(() => {
    let active = true;
    const refresh = (forceScan = false) => {
      api('/api/intake/drive/status', session.access_token)
        .then((data) => { if (active) setDriveState({ ...(data && typeof data === 'object' ? data : {}), loading: false, error: data?.error || '' }); })
        .catch((e) => { if (active) setDriveState((old) => ({ ...old, loading: false, error: e.message || 'Could not check the Drive connection.' })); });
      api(`/api/intake/drive/jobs${forceScan ? '?scan=1' : ''}`, session.access_token)
        .then((data) => {
          if (!active) return;
          setDriveJobs(Array.isArray(data?.jobs) ? data.jobs.filter((job) => job && typeof job === 'object') : []);
          setDriveScanError(data?.scan_error || '');
        })
        .catch((e) => { if (active) setDriveScanError(e?.message || 'Could not load inbox.'); });
    };
    refresh(driveScanTick > 0);
    const timer = window.setInterval(() => refresh(false), hasActiveJobs ? 2_500 : 5_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [session.access_token, driveScanTick, hasActiveJobs]);

  const connectDrive = async () => {
    setDriveBusy(true);
    setDriveState((old) => ({ ...old, error: '' }));
    try {
      const { url } = await api('/api/intake/drive/connect', session.access_token, { method: 'POST' });
      window.location.assign(url);
    } catch (e) {
      setDriveState((old) => ({ ...old, error: e.message || 'Could not start Google Drive connection.' }));
      setDriveBusy(false);
    }
  };

  const selectMedia = (fileList) => {
    const incoming = Array.from(fileList || []).filter(Boolean);
    if (!incoming.length) return;
    const videos = incoming.filter((item) => item.type?.startsWith('video/'));
    const images = incoming.filter((item) => item.type?.startsWith('image/'));
    if (videos.length && images.length) {
      setError('Choose either one video or up to 10 carousel images — not both together.');
      return;
    }
    if (videos.length) {
      if (videos.length > 1) {
        setError('Upload one video per post.');
        return;
      }
      if (videos[0].size > 400 * 1024 * 1024) {
        setError('The video is larger than Driftpost’s 400 MB upload limit.');
        return;
      }
      setMediaFiles([videos[0]]);
      resetCoverState();
    } else if (images.length) {
      if (images.length > 10) {
        setError('Carousels support up to 10 images per post.');
        return;
      }
      const oversized = images.find((img) => img.size > 10 * 1024 * 1024);
      if (oversized) {
        setError(`"${oversized.name}" exceeds the 10 MB image limit.`);
        return;
      }
      setMediaFiles(images);
      resetCoverState();
    } else {
      setError('Choose a video (MP4, MOV, WebM) or images (JPG, PNG, WebP).');
      return;
    }
    setError('');
    setNotice('');
  };

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setNotice('');
    if (!isAiAccount(session.user?.email)) return setError('This private team workflow is not available for this account.');
    if (!mediaFiles.length) return setError('Choose a video or up to 10 carousel images first.');

    setUploading(true);
    setUploadPercent(0);
    try {
      const form = new FormData();
      for (const item of mediaFiles) form.append('media', item, item.name);
      if (isVideoSelection && coverMode !== 'auto' && coverFile) {
        form.append('cover', coverFile, coverFile.name || 'manual-cover.jpg');
      }
      if (description.trim()) form.append('description', description.trim());
      const data = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', apiRequestUrl('/api/intake/direct'));
        xhr.setRequestHeader('Authorization', `Bearer ${session.access_token}`);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable && e.total > 0) {
            setUploadPercent(Math.min(99, Math.round((e.loaded / e.total) * 100)));
          }
        };
        xhr.onload = () => {
          let parsed = {};
          try { parsed = JSON.parse(xhr.responseText || '{}'); } catch {}
          if (xhr.status >= 200 && xhr.status < 300) resolve(parsed);
          else reject(new Error(parsed?.error || 'Could not queue your upload.'));
        };
        xhr.onerror = () => reject(new Error('Network error while uploading.'));
        xhr.send(form);
      });
      setUploadPercent(100);
      setMediaFiles([]);
      resetCoverState();
      setDescription('');
      setInboxOpen(true);
      setNotice(`Queued ${data.kind === 'carousel' ? `${data.count}-image carousel` : 'video'}! Driftpost is automatically routing, writing captions, applying tags & Story, and publishing.`);
      setDriveScanTick((t) => t + 1);
    } catch (e) {
      setError(e?.message || 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const stopJob = async (jobId) => {
    setStoppingJobId(jobId);
    setError('');
    try {
      await api(`/api/intake/drive/jobs/${encodeURIComponent(jobId)}/stop`, session.access_token, { method: 'POST' });
      setDriveScanTick((t) => t + 1);
    } catch (e) {
      setError(e?.message || 'Could not stop this post.');
    } finally {
      setStoppingJobId('');
    }
  };

  const jobProgressPercent = (job) => {
    const p = Number(job?.result?.progress?.percent);
    if (Number.isFinite(p) && p > 0) return Math.min(100, p);
    const s = String(job?.status || '').toLowerCase();
    if (s === 'queued') return 10;
    if (s === 'processing') return 45;
    if (s === 'publishing') return 92;
    if (['completed', 'partial', 'failed', 'stopped'].includes(s)) return 100;
    return 15;
  };

  return (
    <div className="ws team-video-page">
      <WorkspaceNav page="team-video" onNavigate={onNavigate} email={session.user?.email} onSignOut={onSignOut} />
      <main className="team-video-main">
        <header className="team-video-heading">
          <span>TEAM PIPELINE</span>
          <h1>Team Video</h1>
          <button type="button" className="team-review-refresh" onClick={() => onNavigate('team-video-review')}>Stopped review</button>
        </header>

        {!isAiAccount(session.user?.email) && (
          <div className="team-video-alert" role="alert">This private workflow is only available to approved team accounts.</div>
        )}

        <form className="team-video-form" onSubmit={submit}>
          <BorderGlow className="bg-glow" backgroundColor="#111114" borderRadius={14} glowColor="217 91 60" colors={['#3b82f6', '#60a5fa', '#93c5fd']} fillOpacity={0.12} glowRadius={22}>
            <section className="team-video-panel">
              <div className="team-video-section-title">
                <span>↑</span>
                <div>
                  <h2>Upload media</h2>
                </div>
              </div>

              <label
                className="team-video-drop"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => { event.preventDefault(); selectMedia(event.dataTransfer.files); }}
              >
                <span className="team-video-drop-mark">↑</span>
                <b>
                  {!mediaFiles.length
                    ? 'Choose or drop a video or carousel images'
                    : isVideoSelection
                      ? file.name
                      : `${mediaFiles.length} image${mediaFiles.length === 1 ? '' : 's'} selected`}
                </b>
                <small>
                  {!mediaFiles.length
                    ? 'Video (MP4, MOV, WebM · up to 400 MB) or 1–10 Images (JPG, PNG, WebP)'
                    : isVideoSelection
                      ? `${(file.size / 1024 / 1024).toFixed(1)} MB · ${file.type || 'video'}`
                      : mediaFiles.map((item) => item.name).join(' · ')}
                </small>
                <input
                  type="file"
                  accept="video/*,image/*"
                  multiple
                  onChange={(event) => { const input = event.currentTarget; selectMedia(input.files); input.value = ''; }}
                />
              </label>

              {mediaFiles.length > 0 && (
                <div className="team-media-clear">
                  <button type="button" onClick={() => { setMediaFiles([]); resetCoverState(); }}>Clear selected media</button>
                </div>
              )}

              {isVideoSelection && (
                <div className="team-cover-picker">
                  <div className="team-cover-head">
                    <div>
                      <strong>Thumbnail / Cover</strong>
                      <small>Let AI RAG pick the best frame, scrub your video, or upload a custom cover.</small>
                    </div>
                    <div className="team-cover-tabs" role="tablist" aria-label="Thumbnail mode">
                      <button
                        type="button"
                        role="tab"
                        aria-selected={coverMode === 'auto'}
                        className={coverMode === 'auto' ? 'active' : ''}
                        onClick={() => { setCoverMode('auto'); setCoverFile(null); setCoverLabel(''); }}
                      >
                        Auto (AI RAG)
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={coverMode === 'frame'}
                        className={coverMode === 'frame' ? 'active' : ''}
                        onClick={() => setCoverMode('frame')}
                      >
                        Pick frame
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={coverMode === 'upload'}
                        className={coverMode === 'upload' ? 'active' : ''}
                        onClick={() => setCoverMode('upload')}
                      >
                        Upload image
                      </button>
                    </div>
                  </div>

                  {coverMode === 'frame' && videoPreviewUrl && (
                    <div className="team-cover-frame-box">
                      <div className="team-cover-video-stage">
                        <video
                          ref={coverVideoRef}
                          src={videoPreviewUrl}
                          muted
                          playsInline
                          preload="metadata"
                          onLoadedMetadata={(e) => {
                            const vid = e.currentTarget;
                            setVideoDuration(Number.isFinite(vid.duration) ? vid.duration : 0);
                            setVideoTime(0);
                            void buildFilmstrip(vid);
                          }}
                          onTimeUpdate={(e) => setVideoTime(e.currentTarget.currentTime || 0)}
                        />
                      </div>
                      <div className="team-cover-scrubber">
                        <span>{formatTime(videoTime)}</span>
                        <input
                          type="range"
                          min={0}
                          max={videoDuration || 1}
                          step={0.05}
                          value={Math.min(videoTime, videoDuration || 1)}
                          onChange={(e) => {
                            const next = Number(e.currentTarget.value);
                            setVideoTime(next);
                            if (coverVideoRef.current) coverVideoRef.current.currentTime = next;
                          }}
                        />
                        <span>{formatTime(videoDuration)}</span>
                        <button
                          type="button"
                          className="team-cover-capture-btn"
                          disabled={coverBusy || !videoDuration}
                          onClick={async () => {
                            setCoverBusy(true);
                            setError('');
                            try {
                              const shot = await captureVideoFrameAt(coverVideoRef.current, videoTime);
                              setCoverFile(shot.file);
                              setCoverLabel(`Frame at ${formatTime(shot.time)}`);
                            } catch (err) {
                              setError(err?.message || 'Could not capture video frame.');
                            } finally {
                              setCoverBusy(false);
                            }
                          }}
                        >
                          {coverBusy ? 'Capturing…' : 'Use this frame'}
                        </button>
                      </div>
                      {filmstrip.length > 0 && (
                        <div className="team-cover-filmstrip" aria-label="Quick-pick video frames">
                          {filmstrip.map((item, idx) => (
                            <button
                              key={idx}
                              type="button"
                              className={`team-cover-thumb ${coverLabel === `Frame at ${formatTime(item.time)}` ? 'selected' : ''}`}
                              onClick={() => {
                                setCoverFile(item.file);
                                setCoverLabel(`Frame at ${formatTime(item.time)}`);
                                if (coverVideoRef.current) coverVideoRef.current.currentTime = item.time;
                                setVideoTime(item.time);
                              }}
                            >
                              <img src={item.preview} alt={`Frame at ${formatTime(item.time)}`} />
                              <span>{formatTime(item.time)}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {coverMode === 'upload' && (
                    <label className="team-cover-upload-drop">
                      <b>{coverFile ? coverFile.name : 'Choose or drop a custom thumbnail image'}</b>
                      <small>JPG, PNG, or WebP · up to 10 MB · automatically fitted for Reels &amp; YouTube</small>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        onChange={(e) => {
                          const img = e.currentTarget.files?.[0];
                          e.currentTarget.value = '';
                          if (!img) return;
                          if (!img.type.startsWith('image/')) return setError('Thumbnail must be a JPG, PNG, or WebP image.');
                          if (img.size > 10 * 1024 * 1024) return setError('Thumbnail image exceeds 10 MB.');
                          setError('');
                          setCoverFile(img);
                          setCoverLabel(img.name);
                        }}
                      />
                    </label>
                  )}

                  {coverMode !== 'auto' && coverPreviewUrl && (
                    <div className="team-cover-selected-bar">
                      <img src={coverPreviewUrl} alt="Selected thumbnail preview" />
                      <div>
                        <b>Manual thumbnail ready</b>
                        <span>{coverLabel || coverFile?.name}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => { setCoverMode('auto'); setCoverFile(null); setCoverLabel(''); }}
                      >
                        Reset to Auto
                      </button>
                    </div>
                  )}
                </div>
              )}

              <label className="team-field">
                <span>Optional description / AI caption instructions</span>
                <textarea
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  rows={3}
                  maxLength={2000}
                  placeholder="Optional: Add any changes, offers, prices, dates, or specific instructions for how the AI should write this caption."
                />
              </label>

              {uploading && (
                <div className="dp-progress-wrap" aria-live="polite">
                  <div className="dp-progress-head">
                    <span>Uploading media to Driftpost…</span>
                    <b>{uploadPercent}%</b>
                  </div>
                  <div className="dp-progress-track">
                    <i style={{ width: `${uploadPercent}%` }} />
                  </div>
                </div>
              )}

              {error && <p className="team-video-error" role="alert">{error}</p>}
              {notice && <div className="feed-it-success" role="status">{notice}</div>}

              <div className="team-video-actions">
                <button type="submit" disabled={uploading || generatingCaptions || !mediaFiles.length || !isAiAccount(session.user?.email)}>
                  {uploading ? `Uploading (${uploadPercent}%)…` : 'Send to automated pipeline'}
                </button>
                <button
                  type="button"
                  className="team-video-generate-btn"
                  disabled={uploading || generatingCaptions || !mediaFiles.length || !isAiAccount(session.user?.email)}
                  onClick={handleGenerateCaptions}
                >
                  {generatingCaptions ? (captionStage || 'Generating captions…') : 'Generate captions'}
                </button>
              </div>

              {generatedCaptions && (
                <div className="team-captions-panel" aria-live="polite">
                  <div className="team-captions-head">
                    <div className="team-captions-title-wrap">
                      <strong>Generated captions</strong>
                      <div className="team-captions-badges">
                        <span className="team-cap-badge brand">
                          {captionMeta.brand?.name || 'Auto-detected from media'}
                        </span>
                        {captionMeta.platforms.map((p) => (
                          <span key={p} className="team-cap-badge platform">
                            {p === 'x' ? 'X' : p.charAt(0).toUpperCase() + p.slice(1)}
                          </span>
                        ))}
                        {captionMeta.instagramTags.map((tag) => (
                          <span key={tag} className="team-cap-badge tag">@{String(tag).replace(/^@+/, '')}</span>
                        ))}
                        <span className="team-cap-badge mode">
                          {captionMeta.usedDesc ? 'Media + description' : 'Media only'}
                        </span>
                      </div>
                    </div>
                    <div className="team-captions-head-actions">
                      <button
                        type="button"
                        className="team-captions-regen-btn"
                        disabled={generatingCaptions || uploading}
                        onClick={handleGenerateCaptions}
                      >
                        {generatingCaptions ? 'Regenerating…' : 'Regenerate'}
                      </button>
                      <button
                        type="button"
                        className="team-captions-clear-btn"
                        disabled={generatingCaptions}
                        onClick={() => {
                          setGeneratedCaptions(null);
                          setCaptionMeta({ brand: null, platforms: [], instagramTags: [], usedDesc: false });
                          setCopiedKey('');
                        }}
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  <div className="team-captions-tabs" role="tablist" aria-label="Caption platform">
                    {[
                      ['instagram', 'Instagram'],
                      ['youtube', 'YouTube'],
                      ['facebook', 'Facebook'],
                      ['x', 'X'],
                    ]
                      .filter(([key]) => !captionMeta.platforms.length || captionMeta.platforms.includes(key))
                      .map(([key, label]) => (
                        <button
                          key={key}
                          type="button"
                          role="tab"
                          aria-selected={captionPlatform === key}
                          className={captionPlatform === key ? 'active' : ''}
                          onClick={() => setCaptionPlatform(key)}
                        >
                          {label}
                        </button>
                      ))}
                  </div>

                  {captionPlatform === 'instagram' && (
                    <div className="team-caption-editor">
                      <div className="team-caption-editor-bar">
                        <span>Instagram caption</span>
                        <button type="button" onClick={() => copyText('ig', generatedCaptions.instagram?.caption)}>
                          {copiedKey === 'ig' ? 'Copied!' : 'Copy'}
                        </button>
                      </div>
                      <textarea
                        rows={7}
                        value={generatedCaptions.instagram?.caption || ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          setGeneratedCaptions((old) => ({ ...old, instagram: { ...(old?.instagram || {}), caption: val } }));
                        }}
                      />
                    </div>
                  )}

                  {captionPlatform === 'youtube' && (
                    <div className="team-caption-editor">
                      <div className="team-caption-editor-bar">
                        <span>YouTube title</span>
                        <button type="button" onClick={() => copyText('yt-title', generatedCaptions.youtube?.title)}>
                          {copiedKey === 'yt-title' ? 'Copied!' : 'Copy title'}
                        </button>
                      </div>
                      <input
                        type="text"
                        maxLength={100}
                        value={generatedCaptions.youtube?.title || ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          setGeneratedCaptions((old) => ({ ...old, youtube: { ...(old?.youtube || {}), title: val } }));
                        }}
                      />
                      <div className="team-caption-editor-bar">
                        <span>YouTube description</span>
                        <button type="button" onClick={() => copyText('yt-desc', generatedCaptions.youtube?.description)}>
                          {copiedKey === 'yt-desc' ? 'Copied!' : 'Copy description'}
                        </button>
                      </div>
                      <textarea
                        rows={6}
                        value={generatedCaptions.youtube?.description || ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          setGeneratedCaptions((old) => ({ ...old, youtube: { ...(old?.youtube || {}), description: val } }));
                        }}
                      />
                      <div className="team-caption-editor-bar">
                        <span>YouTube tags</span>
                        <button type="button" onClick={() => copyText('yt-tags', generatedCaptions.youtube?.tags)}>
                          {copiedKey === 'yt-tags' ? 'Copied!' : 'Copy tags'}
                        </button>
                      </div>
                      <input
                        type="text"
                        value={generatedCaptions.youtube?.tags || ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          setGeneratedCaptions((old) => ({ ...old, youtube: { ...(old?.youtube || {}), tags: val } }));
                        }}
                      />
                    </div>
                  )}

                  {captionPlatform === 'facebook' && (
                    <div className="team-caption-editor">
                      <div className="team-caption-editor-bar">
                        <span>Facebook post</span>
                        <button type="button" onClick={() => copyText('fb', generatedCaptions.facebook?.message)}>
                          {copiedKey === 'fb' ? 'Copied!' : 'Copy'}
                        </button>
                      </div>
                      <textarea
                        rows={6}
                        value={generatedCaptions.facebook?.message || ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          setGeneratedCaptions((old) => ({ ...old, facebook: { ...(old?.facebook || {}), message: val } }));
                        }}
                      />
                    </div>
                  )}

                  {captionPlatform === 'x' && (
                    <div className="team-caption-editor">
                      <div className="team-caption-editor-bar">
                        <span>X post ({Array.from(generatedCaptions.x?.text || '').length}/280)</span>
                        <button type="button" onClick={() => copyText('x', generatedCaptions.x?.text)}>
                          {copiedKey === 'x' ? 'Copied!' : 'Copy'}
                        </button>
                      </div>
                      <textarea
                        rows={4}
                        maxLength={280}
                        value={generatedCaptions.x?.text || ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          setGeneratedCaptions((old) => ({ ...old, x: { ...(old?.x || {}), text: val } }));
                        }}
                      />
                    </div>
                  )}
                </div>
              )}
            </section>
          </BorderGlow>
        </form>

        <BorderGlow className="bg-glow" backgroundColor="#111114" borderRadius={14} glowColor="217 91 60" colors={['#3b82f6', '#60a5fa', '#93c5fd']} fillOpacity={0.12} glowRadius={22}>
          <section className="team-video-panel drive-intake-panel">
            <div className="team-video-section-title">
              <span>↗</span>
              <div>
                <h2>Inbox &amp; Google Drive</h2>
              </div>
            </div>

            {driveState.connected ? (
              <div className="drive-intake-ready">
                <b>Drive connected · {driveState.google_email}</b>
                <a href={driveState.folder_url} target="_blank" rel="noreferrer">Open Driftpost Video Intake folder ↗</a>
              </div>
            ) : (
              <div className="drive-intake-connect">
                <p>{driveState.loading ? 'Checking Google Drive setup…' : driveState.error || 'Connect the Famebros Drive account to turn on automatic Drive intake.'}</p>
                <button type="button" onClick={connectDrive} disabled={driveBusy || driveState.loading}>
                  {driveBusy ? 'Opening Google…' : 'Connect Google Drive'}
                </button>
              </div>
            )}

            <details className="dp-collapse" open={inboxOpen || hasActiveJobs} onToggle={(e) => setInboxOpen(e.currentTarget.open)}>
              <summary>
                <span>Live inbox and posting status ({driveJobs.length})</span>
                <button
                  type="button"
                  className="dp-collapse-action"
                  onClick={(e) => { e.preventDefault(); e.stopPropagation(); setDriveScanTick((t) => t + 1); }}
                >
                  Refresh now
                </button>
              </summary>
              <div className="dp-collapse-body">
                <div className="drive-intake-jobs" aria-live="polite">
                  {driveScanError && <small className="drive-job-error">{driveScanError}</small>}
                  {driveJobs.length ? driveJobs.slice(0, 12).map((job) => {
                    const progress = job.result?.progress;
                    const percent = jobProgressPercent(job);
                    const isCarousel = job.result?.media_kind === 'carousel' || job.mime_type === 'image/carousel';
                    const timestamp = new Date(job.updated_at || job.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
                    const createdMs = Date.parse(job.created_at || job.updated_at || 0);
                    const canStop = ['queued', 'processing', 'review'].includes(job.status)
                      || (job.status === 'publishing' && (!createdMs || Date.now() - createdMs > 2 * 60 * 1000));
                    const autoInstagramTags = (Array.isArray(job.result?.instagram_tags) && job.result.instagram_tags.length
                      ? job.result.instagram_tags
                      : getAssignedInstagramTagsForBrand({ brandId: job.result?.brand_id, brandName: job.account_name, accountName: job.file_name })
                    ).map((h) => `@${String(h).replace(/^@+/, '')}`);
                    return (
                      <div key={job.id} className={!!job.result?.review ? 'drive-job-needs-review' : ''}>
                        <div className="dp-job-top">
                          <span>
                            <strong>{job.file_name}</strong>
                            <small>
                              {job.account_name} · {(job.platforms || []).join(', ') || 'Destination needs correction'} · {isCarousel ? `${job.result?.source_drive_files?.length || 'Photo'}-image carousel` : job.mime_type || 'Video'} · {(Number(job.file_size || 0) / 1024 / 1024).toFixed(1)} MB
                              {autoInstagramTags.length ? ` · Auto-tags: ${autoInstagramTags.join(', ')}` : ''}
                            </small>
                          </span>
                          <div className="dp-job-badges">
                            <em className={`drive-job-status ${job.status || 'unknown'}`}>
                              {job.result?.brand_reviews?.length ? 'brand decision needed' : job.result?.review ? 'needs correction' : String(job.status || 'unknown').replaceAll('_', ' ')}
                            </em>
                            {canStop && (
                              <button
                                type="button"
                                className="dp-stop-btn"
                                disabled={stoppingJobId === job.id}
                                onClick={() => stopJob(job.id)}
                              >
                                {stoppingJobId === job.id ? 'Stopping…' : 'Stop'}
                              </button>
                            )}
                          </div>
                        </div>
                        <div className={`dp-progress-wrap is-${job.status || 'queued'}`}>
                          <div className="dp-progress-head">
                            <span>{progress?.detail || (job.status === 'queued' ? 'Waiting for the intake worker…' : job.status === 'publishing' ? 'Publishing to selected accounts…' : job.status === 'completed' ? 'Published successfully.' : job.status === 'partial' ? 'Some accounts published; check the post history.' : job.status === 'review' || job.result?.brand_reviews?.length ? 'Held before publishing. Open Video review to inspect the video and decide.' : job.status === 'failed' ? 'Needs attention.' : job.status === 'stopped' ? 'Stopped; this post was not published.' : 'Preparing media…')}</span>
                            <b>{percent}% · {timestamp}</b>
                          </div>
                          <div className="dp-progress-track">
                            <i style={{ width: `${percent}%` }} />
                          </div>
                        </div>
                        {!!progress?.destinations?.length && (
                          <small className="drive-job-destinations">
                            {progress.destinations.map((target) => `${target.platform} · ${target.account}: ${target.status}${target.error ? ` (${target.error})` : ''}`).join('  |  ')}
                          </small>
                        )}
                        {!!job.result?.source_drive_files?.length && (
                          <details className="drive-job-files">
                            <summary>Carousel contents ({job.result.source_drive_files.length} images)</summary>
                            <small>{job.result.source_drive_files.map((item) => item.name).join(' · ')}</small>
                          </details>
                        )}
                        {!!job.result?.brand_reviews?.length && (
                          <small className="drive-job-review-reason">
                            Automatic check stopped this post to avoid sending it to the wrong brand. {job.result.brand_reviews.map((item) => `${item.brand_name}: ${item.reason}`).join(' · ')}{' '}
                            <button type="button" onClick={() => onNavigate('team-video-review')}>Open review</button>
                          </small>
                        )}
                        {!!job.result?.review && (
                          <small className="drive-job-review-reason">
                            Automatic check stopped this post to avoid sending it to the wrong brand. {job.result?.review?.reason || job.error || 'Correct the filename or account mapping and upload again.'}
                          </small>
                        )}
                        {job.error && !job.result?.review && <small className="drive-job-error">{job.error}</small>}
                      </div>
                    );
                  }) : (
                    <p className="drive-job-empty">No media has entered this inbox yet. Upload above or drop a file into the linked Google Drive folder.</p>
                  )}
                </div>
              </div>
            </details>

            <details className="drive-intake-guide">
              <summary>How to name uploads</summary>
              <div className="drive-intake-guide-body">
                <p>Put the brand or connected account name in the filename. For example:</p>
                <p><code>@mahalaxmi.jewellers.kurla.mp4</code></p>
                <p>To target more than one brand, separate names with commas. To limit platforms, add <code>-- facebook,instagram</code> before the extension.</p>
                <p>Photo carousels: upload 1–10 images directly above, or in Drive create a <strong>folder named after the brand</strong> (for example, <code>Rajlaxmi Jewellers</code>) and drop up to 10 photos inside it. The first photo is automatically posted to your Instagram Story.</p>
              </div>
            </details>

            <details className="drive-intake-guide">
              <summary>Famebros Studio · Automatic Instagram Tagging List ({FAMEBROS_INSTAGRAM_TAGGING_LIST.length} brands)</summary>
              <div className="drive-intake-guide-body">
                <p><strong>TEAM INSTRUCTION:</strong> Driftpost automatically applies and verifies these handles whenever a matching brand is processed:</p>
                <ul>
                  {FAMEBROS_INSTAGRAM_TAGGING_LIST.map((entry) => (
                    <li key={entry.brandId}><strong>{entry.number}. {entry.brandName}:</strong> {entry.handles.map((h) => `@${h}`).join(', ')}</li>
                  ))}
                </ul>
              </div>
            </details>
          </section>
        </BorderGlow>
      </main>
    </div>
  );
}
