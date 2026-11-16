import React, { useEffect, useState } from 'react';
import { api, apiRequestUrl } from '../lib.js';
import { isAiAccount } from '../ai-access.js';
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
  const [description, setDescription] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadPercent, setUploadPercent] = useState(0);
  const [stoppingJobId, setStoppingJobId] = useState('');
  const [inboxOpen, setInboxOpen] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const file = mediaFiles[0] || null;
  const isVideoSelection = Boolean(file?.type?.startsWith('video/'));
  const hasActiveJobs = driveJobs.some((job) => ['queued', 'processing', 'publishing'].includes(job?.status));

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
          <span>PRIVATE TEAM WORKFLOW</span>
          <h1>Drop your media. Driftpost handles the rest.</h1>
          <p>Upload a video or carousel named after the brand (plus optional instructions for the AI). Driftpost automatically matches accounts, applies tags, posts to Story, and publishes.</p>
          <button type="button" className="team-review-refresh" onClick={() => onNavigate('team-video-review')}>Open stopped-video review</button>
        </header>

        {!isAiAccount(session.user?.email) && (
          <div className="team-video-alert" role="alert">This private workflow is only available to approved team accounts.</div>
        )}

        <form className="team-video-form" onSubmit={submit}>
          <BorderGlow className="bg-glow" backgroundColor="#0c0d10" borderRadius={0} glowColor="199 95 74" colors={['#7dd3fc', '#4dc3f7', '#a5ddfa']} fillOpacity={0.12} glowRadius={22}>
            <section className="team-video-panel">
              <div className="team-video-section-title">
                <span>↑</span>
                <div>
                  <h2>Upload directly</h2>
                  <p>Name your file(s) with the brand name (e.g. <code>Rajlaxmi Jewellers.mp4</code> or <code>Hair Match 01.jpg</code>) — no Google Drive needed.</p>
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
                  <button type="button" onClick={() => setMediaFiles([])}>Clear selected media</button>
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
                <button type="submit" disabled={uploading || !mediaFiles.length || !isAiAccount(session.user?.email)}>
                  {uploading ? `Uploading (${uploadPercent}%)…` : 'Send to automated pipeline'}
                </button>
              </div>
            </section>
          </BorderGlow>
        </form>

        <BorderGlow className="bg-glow" backgroundColor="#0c0d10" borderRadius={0} glowColor="199 95 74" colors={['#7dd3fc', '#4dc3f7', '#a5ddfa']} fillOpacity={0.12} glowRadius={22}>
          <section className="team-video-panel drive-intake-panel">
            <div className="team-video-section-title">
              <span>↗</span>
              <div>
                <h2>Live inbox &amp; Google Drive drop-off</h2>
                <p>Track both direct uploads and Google Drive uploads in one place.</p>
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
