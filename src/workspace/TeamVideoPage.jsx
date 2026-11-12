import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api, matchesSearchText, PLATFORMS } from '../lib.js';
import { isAiAccount } from '../ai-access.js';
import { requestCaptions, mapResponse } from '../stage2/ai.js';
import { saveCaptionDraft, readStageSelection } from '../stage2/captionDraftScope.js';
import { readVault, writeVault } from '../stage2/mediaVault.js';
import { makeCover } from '../stage3/CoverPicker.jsx';
import { parseInstagramCollaborators } from '../stage3/instagramCollaborators.js';
import { WorkspaceNav } from './Workspace.jsx';

const PLATFORM_LABELS = Object.fromEntries(PLATFORMS.map(({ id, name }) => [id, name]));
const SCOPED = (key, userId) => `${key}:${userId}`;

function TeamCoverField({ title, value, setValue, platform, setError, setBusy }) {
  const [previewUrl, setPreviewUrl] = useState('');
  const [processing, setProcessing] = useState(false);
  useEffect(() => {
    if (!value) { setPreviewUrl(''); return undefined; }
    const url = URL.createObjectURL(value);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [value]);

  return <div className="team-file-field">
    <label><span>{title}</span><input type="file" accept="image/jpeg,image/png,image/webp" disabled={processing} onChange={async (event) => {
      const source = event.target.files?.[0] || null;
      event.target.value = '';
      if (!source) return;
      setProcessing(true);
      setBusy(true);
      try { setValue((await makeCover(source, platform, source.name)).raw); setError(''); }
      catch (e) { setError(e.message || 'Could not prepare that image.'); }
      finally { setProcessing(false); setBusy(false); }
    }} /></label>
    {value ? <div className="team-cover-preview"><img src={previewUrl} alt={`${title} preview`} /><div><b>{value.name}</b><small>{(value.size / 1024 / 1024).toFixed(1)} MB · prepared as JPEG</small></div><button type="button" aria-label={`Remove ${title.toLowerCase()}`} onClick={() => setValue(null)}>Remove</button></div> : <small>AI selects a frame from your video. Upload a custom cover to override it.</small>}
  </div>;
}

export default function TeamVideoPage({ session, onNavigate, onSignOut, onOpenReview }) {
  const userId = session.user.id;
  const [connections, setConnections] = useState([]);
  const [driveState, setDriveState] = useState({ loading: true, connected: false, folder_url: '', google_email: '', error: '' });
  const [driveBusy, setDriveBusy] = useState(false);
  const [driveJobs, setDriveJobs] = useState([]);
  const [connectionsLoading, setConnectionsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [brandOptions, setBrandOptions] = useState([]);
  const [brandLoading, setBrandLoading] = useState(true);
  const [brandLoadError, setBrandLoadError] = useState('');
  const [accountSearch, setAccountSearch] = useState('');
  const [file, setFile] = useState(null);
  const [brandKey, setBrandKey] = useState('');
  const [selectedIds, setSelectedIds] = useState([]);
  const [confirmedAccountIds, setConfirmedAccountIds] = useState([]);
  const [brief, setBrief] = useState('');
  const [instagramStory, setInstagramStory] = useState(false);
  const [crosspost, setCrosspost] = useState(false);
  const [collaborators, setCollaborators] = useState('');
  const [youtubeThumb, setYoutubeThumb] = useState(null);
  const [instagramCover, setInstagramCover] = useState(null);
  const [facebookCover, setFacebookCover] = useState(null);
  const [autoPublish, setAutoPublish] = useState(true);
  const [jobs, setJobs] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(SCOPED('driftpost-team-video-jobs', userId)) || '[]');
      if (!Array.isArray(saved)) return [];
      return saved.filter((job) => job && typeof job === 'object').map((job) => job.status === 'analyzing' ? { ...job, status: 'failed', message: 'Analysis stopped when this page was closed. Submit the video again.' } : job);
    } catch { return []; }
  });
  // React state updates are asynchronous. Keep a synchronous reservation so
  // rapid double-clicks or parallel submissions cannot exceed the job cap.
  const activeJobIds = useRef(new Set());
  const pendingCoverIds = useRef(new Set());
  const [retryTick, setRetryTick] = useState(0);
  const [pendingCoverCount, setPendingCoverCount] = useState(0);
  const activeJobs = jobs.filter((job) => job.status === 'analyzing').length;
  const [error, setError] = useState('');

  useEffect(() => {
    try { localStorage.setItem(SCOPED('driftpost-team-video-jobs', userId), JSON.stringify(jobs.map(({ id, file_name, brand, status, message, createdAt, autoPublish, coverWarning, brandKey, accountIds, platforms, brief, crosspost, instagramStory, collaborators, warning, group, outputs, cfg, transcript, brandReviews, brandSuggestions }) => ({ id, file_name, brand, status, message, createdAt, autoPublish, coverWarning, brandKey, accountIds, platforms, brief, crosspost, instagramStory, collaborators, warning, group, outputs, cfg, transcript, brandReviews, brandSuggestions })))); } catch {}
  }, [jobs, userId]);

  useEffect(() => {
    let active = true;
    const refresh = () => {
       api('/api/intake/drive/status', session.access_token)
         .then((data) => { if (active) setDriveState({ ...(data && typeof data === 'object' ? data : {}), loading: false, error: '' }); })
         .catch((e) => { if (active) setDriveState((old) => ({ ...old, loading: false, error: e.message || 'Could not check the Drive connection.' })); });
       api('/api/intake/drive/jobs', session.access_token).then((data) => { if (active) setDriveJobs(Array.isArray(data?.jobs) ? data.jobs.filter((job) => job && typeof job === 'object') : []); }).catch(() => {});
    };
    refresh();
    const timer = window.setInterval(refresh, 5_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [session.access_token]);

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

  useEffect(() => {
    let active = true;
    setConnectionsLoading(true);
    setBrandLoading(true);
    setLoadError('');
    setBrandLoadError('');
    api('/api/connections', session.access_token)
      .then((data) => { if (active) { setConnections(Array.isArray(data?.connections) ? data.connections.filter((item) => item && typeof item === 'object') : []); setLoadError(''); } })
      .catch((e) => { if (active) setLoadError(e.message || 'Could not load connected accounts.'); })
      .finally(() => { if (active) setConnectionsLoading(false); });
    api('/api/ai/brands?limit=200', session.access_token)
      .then((data) => { if (active) { setBrandOptions(Array.isArray(data?.brands) ? data.brands.filter((item) => item && typeof item === 'object') : []); setBrandLoadError(''); setBrandLoading(false); } })
      .catch((e) => { if (active) { setBrandLoadError(e.message || 'Could not load the saved brand profiles.'); setBrandLoading(false); } });
    return () => { active = false; };
  }, [session.access_token, retryTick]);

  const brands = useMemo(() => brandOptions.map((item) => ({ key: item.id, label: item.name })), [brandOptions]);
  const brand = brands.find((item) => item.key === brandKey) || null;
  const chosen = useMemo(() => connections.filter((item) => selectedIds.includes(item.id)), [connections, selectedIds]);
  const selectedPlatforms = useMemo(() => [...new Set(chosen.map((item) => item.platform))], [chosen]);
  const filteredConnections = useMemo(() => {
    return connections.filter((item) => matchesSearchText(accountSearch, item.account_name, item.username, item.handle, item.platform_account_id, item.platform, PLATFORM_LABELS[item.platform]));
  }, [connections, accountSearch]);
  const accountBrand = (account) => {
    if (!brand) return true;
    const mapped = brand.map?.[account.platform];
    if (mapped === account.id) return true;
    // An editor may deliberately select a second page/channel for the same
    // brand. Keep this explicit in the UI rather than silently guessing.
    const accountName = String(account.account_name || '').trim().toLowerCase();
    const brandName = String(brand.label || '').trim().toLowerCase();
    return !!accountName && !!brandName && (accountName.includes(brandName) || brandName.includes(accountName));
  };

  const toggleAccount = (account) => {
    if (!accountBrand(account) && !confirmedAccountIds.includes(account.id)) return;
    setSelectedIds((old) => old.includes(account.id) ? old.filter((id) => id !== account.id) : [...old, account.id]);
  };
  const selectBrand = (key) => {
    setBrandKey(key);
    setSelectedIds([]);
    setConfirmedAccountIds([]);
    setCrosspost(false);
    setInstagramStory(false);
    setCollaborators('');
  };
  const selectVideo = (video) => {
    if (!video) return;
    if (!video.type?.startsWith('video/')) { setError('Choose a video file.'); return; }
    if (video.size > 400 * 1024 * 1024) { setError('The video is larger than Driftpost’s 400 MB upload limit.'); return; }
    setFile(video);
    setYoutubeThumb(null);
    setInstagramCover(null);
    setFacebookCover(null);
    setError('');
  };
  const setCoverBusy = (key, busy) => {
    if (busy) pendingCoverIds.current.add(key);
    else pendingCoverIds.current.delete(key);
    setPendingCoverCount(pendingCoverIds.current.size);
  };

  const chooseDefaultCovers = async (frames, platforms, videoName, selectedFrameIndex = null) => {
    if (!frames.length) throw new Error('Driftpost could not extract any video frames for cover selection.');
    const frameIndex = Number.isInteger(selectedFrameIndex) && selectedFrameIndex >= 0 && selectedFrameIndex < frames.length
      ? selectedFrameIndex
      : Math.floor(frames.length / 2);
    const frame = frames[frameIndex];
    const covers = { thumb: null, instagram: null, facebook: null };
    const mappings = [
      ['youtube', 'thumb'], ['instagram', 'instagram'], ['facebook', 'facebook'],
    ];
    for (const [platform, key] of mappings) {
      if (!platforms.includes(platform)) continue;
      covers[key] = (await makeCover(frame, platform, `${videoName}-${platform}-cover.jpg`)).raw;
    }
    return covers;
  };

  const openJob = async (job) => {
    try {
      const media = await readVault(`driftpost-team-video-job:${userId}:${job.id}`);
      if (!media?.files?.some((entry) => entry.blob instanceof Blob)) throw new Error('This job’s saved video is unavailable. Analyze the video again.');
      const group = job.group;
      if (!group?.id || !Array.isArray(group.accountIds) || !group.accountIds.length || !Array.isArray(group.platforms) || !group.platforms.length) {
        throw new Error('This job is missing its saved destinations. Load it to retry with the accounts selected again.');
      }
      if (!job.outputs || !job.cfg) throw new Error('This job is missing its generated captions or publishing options. Load it to retry.');
      const stageMediaKey = `driftpost-stage2-media:${userId}`;
      await writeVault(stageMediaKey, media);
      const stagedMedia = await readVault(stageMediaKey);
      if (!stagedMedia?.files?.some((entry) => entry.blob instanceof Blob)) {
        throw new Error('This browser could not restore the video for publishing. Free browser storage and try opening the job again.');
      }
      localStorage.setItem(SCOPED('driftpost-team-workflow', userId), 'true');
      localStorage.setItem(SCOPED('driftpost-team-selection', userId), JSON.stringify({ brandKey: job.brandKey, brandLabel: job.brand, group }));
      localStorage.setItem(SCOPED('driftpost-stage2-crosspost', userId), JSON.stringify(job.crosspost));
      localStorage.setItem(SCOPED('driftpost-stage2-brief', userId), JSON.stringify(job.brief));
      localStorage.setItem(SCOPED('driftpost-stage2-analysis', userId), JSON.stringify('analyze'));
      localStorage.setItem(SCOPED('driftpost-stage2-tone', userId), JSON.stringify('auto'));
      localStorage.setItem(SCOPED('driftpost-stage2-emoji', userId), JSON.stringify('medium'));
      localStorage.setItem(SCOPED('driftpost-stage2-length', userId), JSON.stringify('medium'));
      localStorage.setItem(SCOPED('driftpost-team-warning', userId), JSON.stringify(job.warning || job.coverWarning || ''));
      sessionStorage.setItem(`driftpost-team-transcript:${userId}`, JSON.stringify(job.transcript || ''));
      const selection = readStageSelection(userId);
      saveCaptionDraft(userId, selection, job.outputs);
      localStorage.setItem(SCOPED('driftpost-stage3-cfg', userId), JSON.stringify(job.cfg));
      localStorage.setItem(SCOPED('driftpost-stage3-accounts', userId), JSON.stringify({}));
      // Optional speech/cover warnings must not turn automation into a manual
      // review dependency. Stage 3 still validates destinations before publish.
      const autoReady = job.autoPublish;
      localStorage.setItem(SCOPED('driftpost-stage3-reviewed', userId), JSON.stringify(Object.fromEntries(group.platforms.map((pid) => [pid, autoReady]))));
      if (autoReady) sessionStorage.setItem(`driftpost-team-auto-publish:${userId}`, group.id);
      else sessionStorage.removeItem(`driftpost-team-auto-publish:${userId}`);
      onOpenReview();
    } catch (e) { setError(e.message || 'Could not open this video review.'); }
  };

  const loadJobForRetry = async (job) => {
    try {
      const media = await readVault(`driftpost-team-video-job:${userId}:${job.id}`);
      const video = media?.files?.find((entry) => entry.blob instanceof Blob);
      if (!video) throw new Error('This failed attempt did not save its video. Choose the video again to retry.');
      setBrandKey(job.brandKey || '');
      setSelectedIds(job.accountIds || []);
      setConfirmedAccountIds(job.accountIds || []);
      setBrief(job.brief || '');
      setCrosspost(!!job.crosspost);
      setInstagramStory(!!job.instagramStory);
      setCollaborators(job.collaborators || '');
      setAutoPublish(!!job.autoPublish);
      setFile(video.blob instanceof File ? video.blob : new File([video.blob], video.name || 'team-video.mp4', { type: video.type || 'video/mp4' }));
      const thumb = media.thumb?.blob;
      setYoutubeThumb(thumb instanceof Blob ? (thumb instanceof File ? thumb : new File([thumb], media.thumb.name || 'youtube-cover.jpg', { type: thumb.type || 'image/jpeg' })) : null);
      const asFile = (entry, fallback) => entry?.blob instanceof Blob ? (entry.blob instanceof File ? entry.blob : new File([entry.blob], entry.name || fallback, { type: entry.blob.type || 'image/jpeg' })) : null;
      setInstagramCover(asFile(media.coverMap?.instagram, 'instagram-cover.jpg'));
      setFacebookCover(asFile(media.coverMap?.facebook, 'facebook-cover.jpg'));
      setError('Video and settings restored. Submit again to retry this analysis.');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e) { setError(e.message || 'Could not restore this failed job.'); }
  };

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (!isAiAccount(session.user?.email)) return setError('This private team tool is not available for this account.');
    if (!brand) return setError('Choose the brand this video belongs to.');
    if (!file || !file.type.startsWith('video/')) return setError('Choose a video file first.');
    if (file.size > 400 * 1024 * 1024) return setError('The video is larger than Driftpost’s 400 MB upload limit.');
    if (!chosen.length) return setError('Choose at least one account to publish to.');
    if (crosspost && !(selectedPlatforms.includes('instagram') && selectedPlatforms.includes('facebook'))) return setError('Cross-posting needs at least one selected Instagram and Facebook account.');
    if (instagramStory && !selectedPlatforms.includes('instagram')) return setError('Select an Instagram account to publish a Story.');
    if (collaborators && selectedPlatforms.includes('instagram')) {
      const validation = parseInstagramCollaborators(collaborators);
      if (validation.error) return setError(validation.error);
    }
    if (pendingCoverIds.current.size) return setError('Wait for the selected cover image to finish preparing.');
    if (activeJobIds.current.size >= 3) return setError('Three analyses are already running. Wait for one to finish before starting another.');

    const id = `team-video-${crypto.randomUUID()}`;
    activeJobIds.current.add(id);
    const snapshot = {
      id, createdAt: Date.now(), status: 'analyzing', message: 'Extracting frames and transcribing speech…',
      file, brandKey, brand: brand.label, accountIds: chosen.map((item) => item.id), platforms: [...selectedPlatforms],
      brief: brief.trim(), crosspost, instagramStory, collaborators: collaborators.trim(), autoPublish,
      manualCovers: { thumb: youtubeThumb, instagram: instagramCover, facebook: facebookCover },
    };
    setJobs((current) => [{ id, file_name: file.name, brand: brand.label, status: 'analyzing', message: snapshot.message, createdAt: snapshot.createdAt, autoPublish, brandKey, accountIds: snapshot.accountIds, platforms: snapshot.platforms, brief: snapshot.brief, crosspost, instagramStory, collaborators: snapshot.collaborators }, ...current]);
    try {
      await writeVault(`driftpost-team-video-job:${userId}:${id}`, {
        files: [{ name: file.name, size: file.size, type: file.type, blob: file }],
        thumb: youtubeThumb ? { name: youtubeThumb.name, blob: youtubeThumb } : null,
        coverMap: {
          instagram: instagramCover ? { name: instagramCover.name, blob: instagramCover } : {},
          facebook: facebookCover ? { name: facebookCover.name, blob: facebookCover } : {},
        },
      });
      const sourceSaved = await readVault(`driftpost-team-video-job:${userId}:${id}`);
      if (!sourceSaved?.files?.some((entry) => entry.blob instanceof Blob)) throw new Error('This browser could not save the video for retry. Free some browser storage and retry.');
      const generated = await requestCaptions(session.access_token, {
        brief: snapshot.brief,
        brand: snapshot.brand,
        brandId: snapshot.brandKey,
        files: [{ raw: snapshot.file, name: snapshot.file.name, type: snapshot.file.type }],
        analysis: 'analyze',
        frameCount: 8,
        teamVideo: true,
        platforms: snapshot.platforms,
        tone: 'auto', emoji: 'medium', length: 'medium',
      });
      const outputs = mapResponse(generated);
      const group = {
        id,
        name: `Team video · ${snapshot.brand}`,
        accountIds: snapshot.accountIds,
        platforms: snapshot.platforms,
        workflow: 'team_video',
      };
      let coverMap = { thumb: null, instagram: null, facebook: null };
      let coverWarning = '';
      const coverPlatforms = snapshot.platforms.filter((platform) => ['youtube', 'instagram', 'facebook'].includes(platform));
      const manualCoversComplete = coverPlatforms.every((platform) => snapshot.manualCovers[platform === 'youtube' ? 'thumb' : platform]);
      if (coverPlatforms.length && !manualCoversComplete) {
        try { coverMap = await chooseDefaultCovers(generated.videoFrames || [], coverPlatforms, snapshot.file.name.replace(/\.[^.]+$/, ''), generated.videoCoverFrameIndex); }
        catch (coverError) { coverWarning = `Automatic cover preparation failed; publishing will continue without an optional custom cover. ${coverError.message || 'Could not prepare a cover.'}`; }
      }
      coverWarning = [coverWarning, generated.videoCoverSelectionWarning].filter(Boolean).join(' ');
      coverMap = {
        thumb: snapshot.manualCovers.thumb || coverMap.thumb,
        instagram: snapshot.manualCovers.instagram || coverMap.instagram,
        facebook: snapshot.manualCovers.facebook || coverMap.facebook,
      };
      const cfg = {
        instagram: { story: snapshot.instagramStory, collabs: snapshot.collaborators, collabsEnabled: !!snapshot.collaborators },
        facebook: {}, youtube: {}, x: {},
      };
      const media = {
        files: [{ name: snapshot.file.name, size: snapshot.file.size, type: snapshot.file.type, blob: snapshot.file }],
        thumb: coverMap.thumb ? { name: coverMap.thumb.name, blob: coverMap.thumb } : null,
        coverMap: {
          instagram: coverMap.instagram ? { name: coverMap.instagram.name, blob: coverMap.instagram } : {},
          facebook: coverMap.facebook ? { name: coverMap.facebook.name, blob: coverMap.facebook } : {},
        },
      };
      await writeVault(`driftpost-team-video-job:${userId}:${id}`, media);
      const savedMedia = await readVault(`driftpost-team-video-job:${userId}:${id}`);
      if (!savedMedia?.files?.some((entry) => entry.blob instanceof Blob)) {
        throw new Error('This browser could not save the video for the publishing step. Free some browser storage and retry.');
      }
      const coverMissing = (coverMap.thumb && !(savedMedia.thumb?.blob instanceof Blob))
        || (coverMap.instagram && !(savedMedia.coverMap?.instagram?.blob instanceof Blob))
        || (coverMap.facebook && !(savedMedia.coverMap?.facebook?.blob instanceof Blob));
      if (coverMissing) throw new Error('This browser could not save one or more selected covers. Free browser storage and retry.');
      const job = { ...snapshot, status: 'ready', message: 'Analysis complete. Preparing automatic publishing.', group, outputs, cfg, transcript: generated.transcript || '', warning: generated.videoAnalysisWarning || '', coverWarning };
      setJobs((current) => [job, ...current.filter((item) => item.id !== id)]);
      if (job.autoPublish) await openJob(job);
    } catch (e) {
      const brandCheck = e.data?.brandCheck;
      setJobs((current) => current.map((job) => job.id === id ? {
        ...job,
        status: brandCheck ? 'review' : 'failed',
        message: brandCheck ? `AI stopped before publishing: ${brandCheck.reason || 'brand match is uncertain.'}` : (e.message || 'Could not prepare this video.'),
        ...(brandCheck ? { brandReviews: [{ brand_id: snapshot.brandKey, brand_name: snapshot.brand, verdict: brandCheck.verdict, confidence: brandCheck.confidence, reason: brandCheck.reason || e.message }], brandSuggestions: e.data?.brandSuggestions || [] } : {}),
      } : job));
    } finally {
      activeJobIds.current.delete(id);
    }
  };

  return <div className="ws team-video-page">
    <WorkspaceNav page="team-video" onNavigate={onNavigate} email={session.user?.email} onSignOut={onSignOut} />
    <main className="team-video-main">
      <header className="team-video-heading"><span>PRIVATE TEAM WORKFLOW</span><h1>Send one video. Prepare every destination.</h1><p>Driftpost analyzes the video, writes for the selected brand, validates each destination, and automatically publishes when enabled.</p><button type="button" className="team-review-refresh" onClick={() => onNavigate('team-video-review')}>Open stopped-video review</button></header>
      {!isAiAccount(session.user?.email) && <div className="team-video-alert" role="alert">This private workflow is only available to approved team accounts.</div>}
      {(loadError || brandLoadError) && <div className="team-video-alert" role="alert">{loadError || brandLoadError} <button type="button" onClick={() => setRetryTick((tick) => tick + 1)} disabled={connectionsLoading || brandLoading}>Retry loading</button></div>}
      <section className="team-video-panel drive-intake-panel">
        <div className="team-video-section-title"><span>↗</span><div><h2>Editor video drop-off</h2><p>Connect the private team Drive once. Editors upload into the shared folder; Driftpost checks it every 10 seconds and processes up to two jobs at once.</p></div></div>
        {driveState.connected ? <div className="drive-intake-ready"><b>Drive connected · {driveState.google_email}</b><a href={driveState.folder_url} target="_blank" rel="noreferrer">Open Driftpost Video Intake folder ↗</a></div>
          : <div className="drive-intake-connect"><p>{driveState.loading ? 'Checking Google Drive setup…' : driveState.error || 'Connect the Famebros Drive account to turn on automatic video intake.'}</p><button type="button" onClick={connectDrive} disabled={driveBusy || driveState.loading}>{driveBusy ? 'Opening Google…' : 'Connect Google Drive'}</button></div>}
        <details className="drive-intake-guide"><summary>How to name uploads</summary><div className="drive-intake-guide-body"><p>Put the brand or connected account name in the filename. For example:</p><p><code>@mahalaxmi.jewellers.kurla.mp4</code></p><p>To target more than one brand, separate names with commas. To limit platforms, add <code>-- facebook,instagram</code> before the extension. Driftpost matches the names to your connected accounts and checks each video against its brand. If it cannot safely match a brand, it stops the post and explains what to correct.</p><p>Photo carousels: use the same destination in each filename with an order number (for example, <code>Brand 01.jpg</code>, <code>Brand 02.jpg</code>). Upload up to 10 JPEG or PNG images. The inbox groups them after uploads settle.</p></div></details>
        <div className="drive-intake-jobs" aria-live="polite"><div className="drive-jobs-heading"><b>Live Drive inbox and posting status</b><button type="button" onClick={() => setRetryTick((tick) => tick + 1)}>Refresh now</button></div>{driveJobs.length ? driveJobs.slice(0, 12).map((job) => {
          const progress = job.result?.progress;
          const isCarousel = job.result?.media_kind === 'carousel' || job.mime_type === 'image/carousel';
          const timestamp = new Date(job.updated_at || job.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
          return <div key={job.id} className={!!job.result?.review ? 'drive-job-needs-review' : ''}>
            <span><strong>{job.file_name}</strong><small>{job.account_name} · {(job.platforms || []).join(', ') || 'Destination needs correction'} · {isCarousel ? `${job.result?.source_drive_files?.length || 'Photo'}-image carousel` : job.mime_type || 'Video'} · {(Number(job.file_size || 0) / 1024 / 1024).toFixed(1)} MB</small></span>
           <em className={`drive-job-status ${job.status || 'unknown'}`}>{job.result?.brand_reviews?.length ? 'brand decision needed' : job.result?.review ? 'needs correction' : String(job.status || 'unknown').replaceAll('_', ' ')}</em>
             <small className="drive-job-progress">{progress?.detail || (job.status === 'queued' ? 'Waiting for the intake worker…' : job.status === 'publishing' ? 'Publishing to selected accounts…' : job.status === 'completed' ? 'Published successfully.' : job.status === 'partial' ? 'Some accounts published; check the post history.' : job.status === 'review' || job.result?.brand_reviews?.length ? 'Held before publishing. Open Video review to inspect the video and decide.' : job.status === 'failed' ? 'Needs attention.' : job.status === 'stopped' ? 'Stopped; this video was not published.' : 'Preparing media…')} · Updated {timestamp}</small>
            {!!progress?.destinations?.length && <small className="drive-job-destinations">{progress.destinations.map((target) => `${target.platform} · ${target.account}: ${target.status}${target.error ? ` (${target.error})` : ''}`).join('  |  ')}</small>}
            {!!job.result?.source_drive_files?.length && <details className="drive-job-files"><summary>Carousel contents ({job.result.source_drive_files.length} images)</summary><small>{job.result.source_drive_files.map((item) => item.name).join(' · ')}</small></details>}
              {!!job.result?.brand_reviews?.length && <small className="drive-job-review-reason">Automatic check stopped this post to avoid sending it to the wrong brand. {job.result.brand_reviews.map((item) => `${item.brand_name}: ${item.reason}`).join(' · ')} <button type="button" onClick={() => onNavigate('team-video-review')}>Open review</button></small>}
              {!!job.result?.review && <small className="drive-job-review-reason">Automatic check stopped this post to avoid sending it to the wrong brand. {job.result?.review?.reason || job.error || 'Correct the filename or account mapping and upload again.'}</small>}
            {job.error && !job.result?.review && <small className="drive-job-error">{job.error}</small>}
          </div>;
        }) : <p className="drive-job-empty">{driveState.connected ? 'No media has entered this inbox yet. Upload a video or image batch to the linked folder; videos appear within about 10 seconds. Carousel batches wait 90 seconds for all image uploads to finish.' : 'Connect the team Google Drive above before uploading. Without a linked Drive, new media cannot be detected or shown here.'}</p>}</div>
      </section>
      <form className="team-video-form" onSubmit={submit}>
        <section className="team-video-panel">
          <div className="team-video-section-title"><span>01</span><div><h2>Choose the brand and video</h2><p>The selected brand controls the facts, voice, and caption rules.</p></div></div>
          <label className="team-field"><span>Brand profile</span><select value={brandKey} onChange={(event) => selectBrand(event.target.value)} required disabled={brandLoading || !!brandLoadError}><option value="">{brandLoading ? 'Loading saved brand profiles…' : brandLoadError ? 'Brand profiles unavailable' : 'Choose a saved brand profile'}</option>{brands.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
          <label className="team-video-drop" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const dropped = event.dataTransfer.files?.[0]; if (dropped) selectVideo(dropped); }}><span className="team-video-drop-mark">↑</span><b>{file ? file.name : 'Choose or drop a video'}</b><small>{file ? `${(file.size / 1024 / 1024).toFixed(1)} MB · ${file.type || 'video'}` : 'MP4, MOV, WebM · up to 400 MB'}</small><input type="file" accept="video/*" onChange={(event) => { const input = event.currentTarget; selectVideo(input.files?.[0] || null); input.value = ''; }} /></label>
          <label className="team-field"><span>Optional editor note</span><textarea value={brief} onChange={(event) => setBrief(event.target.value)} rows={3} maxLength={2000} placeholder="Campaign context, key message, or anything the video does not make clear." /></label>
        </section>

        <section className="team-video-panel">
          <div className="team-video-section-title"><span>02</span><div><h2>Select platforms and accounts</h2><p>Choose every destination. You can select multiple accounts on the same platform.</p></div></div>
          <label className="team-field team-account-search"><span>Search accounts across all platforms</span><input type="search" value={accountSearch} onChange={(event) => setAccountSearch(event.target.value)} placeholder="Search account name, handle, or platform" /><small>{filteredConnections.length} of {connections.length} connected accounts · YouTube, Instagram, Facebook, X</small></label>
          {connectionsLoading ? <p className="team-video-empty">Loading connected accounts…</p> : !connections.length ? <p className="team-video-empty">No connected accounts are available. Connect accounts in Driftpost first.</p> : <div className="team-account-groups">{PLATFORMS.map(({ id, name }) => {
            const accounts = filteredConnections.filter((item) => item.platform === id);
            if (!accounts.length) return null;
            return <fieldset className="team-account-group" key={id}><legend>{name}</legend>{accounts.map((account) => {
              const matchesBrand = accountBrand(account);
              const confirmed = confirmedAccountIds.includes(account.id);
              return <div className={`team-account ${selectedIds.includes(account.id) ? 'selected' : ''}`} key={account.id}>
                <input type="checkbox" checked={selectedIds.includes(account.id)} disabled={!brand || (!matchesBrand && !confirmed)} onChange={() => toggleAccount(account)} />
                <span><b>{account.account_name || name}</b><small>{!brand ? 'Choose a brand profile above to enable this account.' : matchesBrand ? 'Matches this brand' : 'This account name does not clearly match the selected brand.'}</small>
                  {brand && !matchesBrand && <label className="team-account-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmedAccountIds((old) => event.target.checked ? [...old, account.id] : old.filter((item) => item !== account.id))} /><small>I confirm this account belongs to {brand.label}.</small></label>}
                </span>
              </div>;
            })}</fieldset>;
          })}</div>}
          {connections.length > 0 && !filteredConnections.length && <p className="team-video-empty">No connected accounts match “{accountSearch}”.</p>}
          {chosen.length > 0 && <p className="team-selection-summary">{chosen.length} account{chosen.length === 1 ? '' : 's'} selected · {selectedPlatforms.map((pid) => PLATFORM_LABELS[pid]).join(', ')}</p>}
        </section>

        <section className="team-video-panel">
          <div className="team-video-section-title"><span>03</span><div><h2>Destination options</h2><p>Only settings supported by the selected platforms are enabled.</p></div></div>
          <div className="team-options-grid">
            {file && selectedPlatforms.includes('youtube') && <TeamCoverField title="YouTube thumbnail" value={youtubeThumb} setValue={setYoutubeThumb} platform="youtube" setError={setError} setBusy={(busy) => setCoverBusy('youtube', busy)} />}
            {file && selectedPlatforms.includes('instagram') && <TeamCoverField title="Instagram Reel cover" value={instagramCover} setValue={setInstagramCover} platform="instagram" setError={setError} setBusy={(busy) => setCoverBusy('instagram', busy)} />}
            {file && selectedPlatforms.includes('facebook') && <TeamCoverField title="Facebook video cover" value={facebookCover} setValue={setFacebookCover} platform="facebook" setError={setError} setBusy={(busy) => setCoverBusy('facebook', busy)} />}
            {selectedPlatforms.includes('instagram') && <label className="team-option"><input type="checkbox" checked={instagramStory} onChange={(event) => setInstagramStory(event.target.checked)} /><span><b>Also publish as an Instagram Story</b><small>Stories expire after 24 hours and use the selected Instagram account(s).</small></span></label>}
            {selectedPlatforms.includes('instagram') && <label className="team-field"><span>Instagram collaborators (up to 3)</span><input value={collaborators} onChange={(event) => setCollaborators(event.target.value)} placeholder="handles separated by commas" aria-invalid={!!collaborators && !!parseInstagramCollaborators(collaborators).error} /><small>{parseInstagramCollaborators(collaborators).error || 'Meta must accept each handle and the account must have collaborator access.'}</small></label>}
            {selectedPlatforms.includes('instagram') && selectedPlatforms.includes('facebook') && <label className="team-option"><input type="checkbox" checked={crosspost} onChange={(event) => setCrosspost(event.target.checked)} /><span><b>Cross-post Instagram to Facebook</b><small>Use the selected Facebook accounts as the mirrored destination.</small></span></label>}
          </div>
          <label className="team-option team-auto"><input type="checkbox" checked={autoPublish} onChange={(event) => setAutoPublish(event.target.checked)} /><span><b>Publish automatically after analysis</b><small>Driftpost validates every selected destination before publishing. Turn this off to prepare drafts without publishing.</small></span></label>
        </section>
        {error && <p className="team-video-error" role="alert">{error}</p>}
        <div className="team-video-actions"><button type="submit" disabled={activeJobs >= 3 || pendingCoverCount > 0 || connectionsLoading || !connections.length || !brand || !file || !chosen.length}>{pendingCoverCount ? 'Preparing cover…' : activeJobs >= 3 ? 'Three analyses already running' : autoPublish ? 'Analyze and publish' : 'Analyze and review'}</button><small>{activeJobs ? `${activeJobs} analysis${activeJobs === 1 ? '' : 'es'} running. You can start up to 3 at once.` : 'The original post creation flow is unchanged.'}</small></div>
      </form>
        {!!jobs.length && <section className="team-video-jobs" aria-label="Video processing jobs"><div className="team-video-section-title"><span>↻</span><div><h2>Video processing jobs</h2><p>Each job keeps its own accounts, captions, covers, and video while other analyses run.</p></div></div>{jobs.map((job) => <article className="team-video-job" key={job.id}><div><b>{job.brand || 'Team video'}</b><small>{job.message || (job.status === 'ready' ? 'Draft ready.' : job.status)}</small>{job.warning && <small className="team-job-warning">{job.warning}</small>}{job.coverWarning && <small className="team-job-warning">{job.coverWarning}</small>}</div>{job.status === 'ready' && <button type="button" onClick={() => openJob(job)}>{job.autoPublish ? 'Open publishing status' : 'Open draft'}</button>}{job.status === 'review' && <button type="button" onClick={() => onNavigate('team-video-review')}>Review video</button>}{job.status === 'failed' && <button type="button" onClick={() => loadJobForRetry(job)}>Load to retry</button>}</article>)}</section>}
    </main>
  </div>;
}
