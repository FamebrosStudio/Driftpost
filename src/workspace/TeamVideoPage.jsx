import React, { useEffect, useMemo, useState } from 'react';
import { api, groupBrands, PLATFORMS } from '../lib.js';
import { isAiAccount, hasAiAccess } from '../ai-access.js';
import { requestCaptions, mapResponse } from '../stage2/ai.js';
import { saveCaptionDraft, readStageSelection } from '../stage2/captionDraftScope.js';
import { readVault, writeVault } from '../stage2/mediaVault.js';
import { makeCover } from '../stage3/CoverPicker.jsx';
import { WorkspaceNav } from './Workspace.jsx';
import './team-video.css';

const PLATFORM_LABELS = Object.fromEntries(PLATFORMS.map(({ id, name }) => [id, name]));
const SCOPED = (key, userId) => `${key}:${userId}`;

export default function TeamVideoPage({ session, onNavigate, onSignOut, onOpenReview }) {
  const userId = session.user.id;
  const [connections, setConnections] = useState([]);
  const [loadError, setLoadError] = useState('');
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
    try { return JSON.parse(localStorage.getItem(SCOPED('driftpost-team-video-jobs', userId)) || '[]').map((job) => job.status === 'analyzing' ? { ...job, status: 'failed', message: 'Analysis stopped when this page was closed. Submit the video again.' } : job); } catch { return []; }
  });
  const activeJobs = jobs.filter((job) => job.status === 'analyzing').length;
  const [error, setError] = useState('');

  useEffect(() => {
    try { localStorage.setItem(SCOPED('driftpost-team-video-jobs', userId), JSON.stringify(jobs.map(({ id, brand, status, message, createdAt, autoPublish, coverWarning, brandKey, accountIds, platforms, brief, crosspost, instagramStory, collaborators, warning, group, outputs, cfg, transcript }) => ({ id, brand, status, message, createdAt, autoPublish, coverWarning, brandKey, accountIds, platforms, brief, crosspost, instagramStory, collaborators, warning, group, outputs, cfg, transcript })))); } catch {}
  }, [jobs, userId]);

  useEffect(() => {
    let active = true;
    api('/api/connections', session.access_token)
      .then((data) => { if (active) { setConnections(data.connections || []); setLoadError(''); } })
      .catch((e) => { if (active) setLoadError(e.message || 'Could not load connected accounts.'); });
    return () => { active = false; };
  }, [session.access_token]);

  const brands = useMemo(() => groupBrands(connections), [connections]);
  const brand = brands.find((item) => item.key === brandKey) || null;
  const chosen = useMemo(() => connections.filter((item) => selectedIds.includes(item.id)), [connections, selectedIds]);
  const selectedPlatforms = useMemo(() => [...new Set(chosen.map((item) => item.platform))], [chosen]);
  const accountBrand = (account) => {
    if (!brand) return true;
    const mapped = brand.map?.[account.platform];
    if (mapped === account.id) return true;
    // An editor may deliberately select a second page/channel for the same
    // brand. Keep this explicit in the UI rather than silently guessing.
    return String(account.account_name || '').toLowerCase().includes(String(brand.label || '').toLowerCase())
      || String(brand.label || '').toLowerCase().includes(String(account.account_name || '').toLowerCase());
  };

  const toggleAccount = (account) => {
    if (!accountBrand(account) && !confirmedAccountIds.includes(account.id)) return;
    setSelectedIds((old) => old.includes(account.id) ? old.filter((id) => id !== account.id) : [...old, account.id]);
  };
  const selectBrand = (key) => {
    setBrandKey(key);
    setSelectedIds([]);
    setConfirmedAccountIds([]);
    setInstagramStory(false);
    setCollaborators('');
  };
  const selectVideo = (video) => {
    setFile(video);
    setYoutubeThumb(null);
    setInstagramCover(null);
    setFacebookCover(null);
  };

  const chooseAiCovers = async (token, frames, platforms, videoName) => {
    if (!frames.length) throw new Error('Driftpost could not extract any video frames for cover selection.');
    const form = new FormData();
    frames.forEach((frame) => form.append('images', frame, frame.name));
    const { selection } = await api('/api/ai/video-covers', token, { method: 'POST', body: form });
    const covers = { thumb: null, instagram: null, facebook: null };
    const mappings = [
      ['youtube', 'thumb'], ['instagram', 'instagram'], ['facebook', 'facebook'],
    ];
    for (const [platform, key] of mappings) {
      if (!platforms.includes(platform)) continue;
      const frame = frames[selection?.[platform]];
      if (!frame) throw new Error(`AI did not return a valid ${platform} cover frame.`);
      covers[key] = (await makeCover(frame, platform, `${videoName}-${platform}-ai-cover.jpg`)).raw;
    }
    return covers;
  };

  const openJob = async (job) => {
    try {
      const media = await readVault(`driftpost-team-video-job:${userId}:${job.id}`);
      if (!media?.files?.some((entry) => entry.blob instanceof Blob)) throw new Error('This job’s saved video is unavailable. Analyze the video again.');
      const group = job.group;
      localStorage.setItem(SCOPED('driftpost-team-workflow', userId), 'true');
      localStorage.setItem(SCOPED('driftpost-team-selection', userId), JSON.stringify({ brandKey: job.brandKey, group }));
      localStorage.setItem(SCOPED('driftpost-stage2-crosspost', userId), JSON.stringify(job.crosspost));
      localStorage.setItem(SCOPED('driftpost-stage2-brief', userId), JSON.stringify(job.brief));
      localStorage.setItem(SCOPED('driftpost-team-warning', userId), JSON.stringify(job.warning || job.coverWarning || ''));
      sessionStorage.setItem(`driftpost-team-transcript:${userId}`, JSON.stringify(job.transcript || ''));
      const selection = readStageSelection(userId);
      saveCaptionDraft(userId, selection, job.outputs);
      localStorage.setItem(SCOPED('driftpost-stage3-cfg', userId), JSON.stringify(job.cfg));
      localStorage.setItem(SCOPED('driftpost-stage3-accounts', userId), JSON.stringify({}));
      const autoReady = job.autoPublish && !job.warning && !job.coverWarning;
      localStorage.setItem(SCOPED('driftpost-stage3-reviewed', userId), JSON.stringify(Object.fromEntries(group.platforms.map((pid) => [pid, autoReady]))));
      await writeVault(`driftpost-stage2-media:${userId}`, media);
      if (autoReady) sessionStorage.setItem(`driftpost-team-auto-publish:${userId}`, group.id);
      else sessionStorage.removeItem(`driftpost-team-auto-publish:${userId}`);
      onOpenReview();
    } catch (e) { setError(e.message || 'Could not open this video review.'); }
  };

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    if (!isAiAccount(session.user?.email) || !hasAiAccess(session)) return setError('This private team tool is not available for this account or browser.');
    if (!brand) return setError('Choose the brand this video belongs to.');
    if (!file || !file.type.startsWith('video/')) return setError('Choose a video file first.');
    if (file.size > 400 * 1024 * 1024) return setError('The video is larger than Driftpost’s 400 MB upload limit.');
    if (!chosen.length) return setError('Choose at least one account to publish to.');
    if (crosspost && !(selectedPlatforms.includes('instagram') && selectedPlatforms.includes('facebook'))) return setError('Cross-posting needs at least one selected Instagram and Facebook account.');

    const id = `team-video-${crypto.randomUUID()}`;
    const snapshot = {
      id, createdAt: Date.now(), status: 'analyzing', message: 'Extracting frames and transcribing speech…',
      file, brandKey, brand: brand.label, accountIds: chosen.map((item) => item.id), platforms: [...selectedPlatforms],
      brief: brief.trim(), crosspost, instagramStory, collaborators: collaborators.trim(), autoPublish,
      manualCovers: { thumb: youtubeThumb, instagram: instagramCover, facebook: facebookCover },
    };
    setJobs((current) => [{ id, brand: brand.label, status: 'analyzing', message: snapshot.message, createdAt: snapshot.createdAt, autoPublish }, ...current]);
    try {
      const generated = await requestCaptions(session.access_token, {
        brief: snapshot.brief,
        brand: snapshot.brand,
        files: [{ raw: snapshot.file, name: snapshot.file.name, type: snapshot.file.type }],
        analysis: 'analyze',
        frameCount: 8,
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
        try { coverMap = await chooseAiCovers(session.access_token, generated.videoFrames || [], coverPlatforms, snapshot.file.name.replace(/\.[^.]+$/, '')); }
        catch (coverError) { coverWarning = `AI cover selection needs review: ${coverError.message || 'cover analysis unavailable'}`; }
      }
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
      const job = { ...snapshot, status: 'ready', message: 'Analysis and cover selection complete.', group, outputs, cfg, transcript: generated.transcript || '', warning: generated.videoAnalysisWarning || '', coverWarning };
      setJobs((current) => [job, ...current.filter((item) => item.id !== id)]);
    } catch (e) {
      setJobs((current) => current.map((job) => job.id === id ? { ...job, status: 'failed', message: e.message || 'Could not prepare this video.' } : job));
    }
  };

  const fileInput = (title, value, setValue, platform) => <label className="team-file-field"><span>{title}</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={async (event) => {
    const source = event.target.files?.[0] || null;
    event.target.value = '';
    if (!source) return setValue(null);
    try { setValue((await makeCover(source, platform, source.name)).raw); setError(''); }
    catch (e) { setError(e.message || 'Could not prepare that image.'); }
  }} /><small>{value ? `${value.name} · ${(value.size / 1024 / 1024).toFixed(1)} MB · prepared as JPEG` : 'AI selects a frame from the video by default. Upload a custom cover to override it.'}</small></label>;

  return <div className="team-video-page">
    <WorkspaceNav page="team-video" onNavigate={onNavigate} email={session.user?.email} onSignOut={onSignOut} />
    <main className="team-video-main">
      <header className="team-video-heading"><span>PRIVATE TEAM WORKFLOW</span><h1>Send one video. Prepare every destination.</h1><p>Driftpost reads the video and speech, writes for the selected brand, then uses the same platform review and publishing system as the regular workspace.</p></header>
      {!isAiAccount(session.user?.email) && <div className="team-video-alert" role="alert">This private workflow is only available to approved team accounts.</div>}
      {loadError && <div className="team-video-alert" role="alert">{loadError} <button type="button" onClick={() => window.location.reload()}>Retry</button></div>}
      <form className="team-video-form" onSubmit={submit}>
        <section className="team-video-panel">
          <div className="team-video-section-title"><span>01</span><div><h2>Choose the brand and video</h2><p>The selected brand controls the facts, voice, and caption rules.</p></div></div>
          <label className="team-field"><span>Brand</span><select value={brandKey} onChange={(event) => selectBrand(event.target.value)} required><option value="">Choose a connected brand</option>{brands.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
          <label className="team-video-drop" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const dropped = event.dataTransfer.files?.[0]; if (dropped?.type.startsWith('video/')) { selectVideo(dropped); setError(''); } else if (dropped) setError('Choose a video file.'); }}><span className="team-video-drop-mark">↑</span><b>{file ? file.name : 'Choose or drop a video'}</b><small>{file ? `${(file.size / 1024 / 1024).toFixed(1)} MB · ${file.type || 'video'}` : 'MP4, MOV, WebM · up to 400 MB'}</small><input type="file" accept="video/*" onChange={(event) => { selectVideo(event.target.files?.[0] || null); setError(''); }} /></label>
          <label className="team-field"><span>Optional editor note</span><textarea value={brief} onChange={(event) => setBrief(event.target.value)} rows={3} maxLength={2000} placeholder="Campaign context, key message, or anything the video does not make clear." /></label>
        </section>

        <section className="team-video-panel">
          <div className="team-video-section-title"><span>02</span><div><h2>Select platforms and accounts</h2><p>Choose every destination. You can select multiple accounts on the same platform.</p></div></div>
          {!brand ? <p className="team-video-empty">Choose a brand to load your connected accounts.</p> : !connections.length ? <p className="team-video-empty">No connected accounts are available. Connect accounts in Driftpost first.</p> : <div className="team-account-groups">{PLATFORMS.map(({ id, name }) => {
            const accounts = connections.filter((item) => item.platform === id);
            if (!accounts.length) return null;
            return <fieldset className="team-account-group" key={id}><legend>{name}</legend>{accounts.map((account) => {
              const matchesBrand = accountBrand(account);
              const confirmed = confirmedAccountIds.includes(account.id);
              return <div className={`team-account ${selectedIds.includes(account.id) ? 'selected' : ''}`} key={account.id}>
                <input type="checkbox" checked={selectedIds.includes(account.id)} disabled={!matchesBrand && !confirmed} onChange={() => toggleAccount(account)} />
                <span><b>{account.account_name || name}</b><small>{matchesBrand ? 'Matches this brand' : 'This account name does not clearly match the selected brand.'}</small>
                  {!matchesBrand && <label className="team-account-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmedAccountIds((old) => event.target.checked ? [...old, account.id] : old.filter((item) => item !== account.id))} /><small>I confirm this account belongs to {brand.label}.</small></label>}
                </span>
              </div>;
            })}</fieldset>;
          })}</div>}
          {chosen.length > 0 && <p className="team-selection-summary">{chosen.length} account{chosen.length === 1 ? '' : 's'} selected · {selectedPlatforms.map((pid) => PLATFORM_LABELS[pid]).join(', ')}</p>}
        </section>

        <section className="team-video-panel">
          <div className="team-video-section-title"><span>03</span><div><h2>Destination options</h2><p>Only settings supported by the selected platforms are enabled.</p></div></div>
          <div className="team-options-grid">
            {selectedPlatforms.includes('youtube') && file && file.type.startsWith('video/') && fileInput('YouTube thumbnail', youtubeThumb, setYoutubeThumb, 'youtube')}
            {selectedPlatforms.includes('instagram') && file && file.type.startsWith('video/') && fileInput('Instagram Reel cover', instagramCover, setInstagramCover, 'instagram')}
            {selectedPlatforms.includes('facebook') && file && file.type.startsWith('video/') && fileInput('Facebook video cover', facebookCover, setFacebookCover, 'facebook')}
            {selectedPlatforms.includes('instagram') && <label className="team-option"><input type="checkbox" checked={instagramStory} onChange={(event) => setInstagramStory(event.target.checked)} /><span><b>Also publish as an Instagram Story</b><small>Stories expire after 24 hours and use the selected Instagram account(s).</small></span></label>}
            {selectedPlatforms.includes('instagram') && <label className="team-field"><span>Instagram collaborators (up to 3)</span><input value={collaborators} onChange={(event) => setCollaborators(event.target.value)} placeholder="handles separated by commas" /><small>Meta must accept each handle and the account must have collaborator access.</small></label>}
            {selectedPlatforms.includes('instagram') && selectedPlatforms.includes('facebook') && <label className="team-option"><input type="checkbox" checked={crosspost} onChange={(event) => setCrosspost(event.target.checked)} /><span><b>Cross-post Instagram to Facebook</b><small>Use the selected Facebook accounts as the mirrored destination.</small></span></label>}
          </div>
          <label className="team-option team-auto"><input type="checkbox" checked={autoPublish} onChange={(event) => setAutoPublish(event.target.checked)} /><span><b>Auto-publish this job</b><small>After analysis, open its job card to start publishing. Driftpost runs destination validation and reports each account’s result. Turn this off to review drafts before posting.</small></span></label>
        </section>
        {error && <p className="team-video-error" role="alert">{error}</p>}
        <div className="team-video-actions"><button type="submit" disabled={activeJobs >= 3 || !connections.length || !brand || !file || !selectedIds.length}>{activeJobs >= 3 ? 'Three analyses already running' : autoPublish ? 'Analyze and publish' : 'Analyze and review'}</button><small>{activeJobs ? `${activeJobs} analysis${activeJobs === 1 ? '' : 'es'} running. You can start up to 3 at once.` : 'The original post creation flow is unchanged.'}</small></div>
      </form>
      {!!jobs.length && <section className="team-video-jobs" aria-label="Video processing jobs"><div className="team-video-section-title"><span>↻</span><div><h2>Video processing jobs</h2><p>Each job keeps its own accounts, captions, covers, and video while other analyses run.</p></div></div>{jobs.map((job) => <article className="team-video-job" key={job.id}><div><b>{job.brand || 'Team video'}</b><small>{job.message || (job.status === 'ready' ? 'Ready to review.' : job.status)}</small>{job.warning && <small className="team-job-warning">{job.warning} Automatic publishing is paused until reviewed.</small>}{job.coverWarning && <small className="team-job-warning">{job.coverWarning} Automatic publishing is paused.</small>}</div>{job.status === 'ready' && <button type="button" onClick={() => openJob(job)}>{job.autoPublish && !job.warning && !job.coverWarning ? 'Open review · publish' : 'Open review'}</button>}</article>)}</section>}
    </main>
  </div>;
}
