import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, apiRequestUrl, PLATFORMS } from '../lib.js';
import { mapResponse, requestCaptions } from '../stage2/ai.js';
import { readStageSelection, saveCaptionDraft } from '../stage2/captionDraftScope.js';
import { readVault, writeVault } from '../stage2/mediaVault.js';
import { WorkspaceNav } from './Workspace.jsx';

const LEGACY_BRAND_REVIEW_ERROR = 'Automatic brand verification stopped the post, but Driftpost could not save the result.';
const isHeld = (job) => !['stopped', 'send'].includes(job?.result?.review_decision?.action) && (
  job?.status === 'review'
  || (job?.status === 'failed' && (Array.isArray(job?.result?.brand_reviews) || String(job?.error || '').includes(LEGACY_BRAND_REVIEW_ERROR)))
);
const emptyCaptions = () => ({ instagram: { caption: '' }, facebook: { message: '' }, youtube: { title: '', description: '', tags: '' }, x: { text: '' } });

export default function TeamVideoReviewPage({ session, onNavigate, onSignOut }) {
  const [jobs, setJobs] = useState([]);
  const [brands, setBrands] = useState([]);
  const [connections, setConnections] = useState([]);
  const [selectedId, setSelectedId] = useState('');
  const [mediaFile, setMediaFile] = useState(null);
  const [mediaUrl, setMediaUrl] = useState('');
  const [brandId, setBrandId] = useState('');
  const [connectionIds, setConnectionIds] = useState([]);
  const [captions, setCaptions] = useState(emptyCaptions);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [localMedia, setLocalMedia] = useState(null);
  const userId = session.user.id;
  const token = session.access_token;
  const selectedJob = jobs.find((job) => job.id === selectedId) || null;
  const selectedBrand = brands.find((brand) => brand.id === brandId) || null;
  const selectedConnections = useMemo(() => connections.filter((item) => connectionIds.includes(item.id)), [connections, connectionIds]);
  const selectedPlatforms = useMemo(() => [...new Set(selectedConnections.map((item) => item.platform))], [selectedConnections]);

  const refresh = useCallback(async () => {
    const data = await api('/api/intake/drive/jobs', token);
    let localJobs = [];
    try { localJobs = JSON.parse(localStorage.getItem(`driftpost-team-video-jobs:${userId}`) || '[]'); } catch {}
    const heldLocal = Array.isArray(localJobs) ? localJobs.filter((job) => job?.status === 'review' && Array.isArray(job?.brandReviews)).map((job) => ({ ...job, created_at: job.createdAt, updated_at: job.createdAt, source: 'browser', result: { brand_reviews: job.brandReviews, suggested_brands: job.brandSuggestions || [], destination_connection_ids: job.accountIds || [] } })) : [];
    const heldDrive = Array.isArray(data?.jobs) ? data.jobs.filter(isHeld).map((job) => ({ ...job, source: 'drive' })) : [];
    setJobs([...heldLocal, ...heldDrive]);
  }, [token, userId]);

  useEffect(() => {
    let live = true;
    Promise.all([
      api('/api/intake/drive/jobs', token),
      api('/api/ai/brands?limit=200', token),
      api('/api/connections', token),
    ]).then(([jobData, brandData, accountData]) => {
      if (!live) return;
      let localJobs = [];
      try { localJobs = JSON.parse(localStorage.getItem(`driftpost-team-video-jobs:${userId}`) || '[]'); } catch {}
      const heldLocal = Array.isArray(localJobs) ? localJobs.filter((job) => job?.status === 'review' && Array.isArray(job?.brandReviews)).map((job) => ({ ...job, created_at: job.createdAt, updated_at: job.createdAt, source: 'browser', result: { brand_reviews: job.brandReviews, suggested_brands: job.brandSuggestions || [], destination_connection_ids: job.accountIds || [] } })) : [];
      const heldDrive = Array.isArray(jobData?.jobs) ? jobData.jobs.filter(isHeld).map((job) => ({ ...job, source: 'drive' })) : [];
      setJobs([...heldLocal, ...heldDrive]);
      setBrands(Array.isArray(brandData?.brands) ? brandData.brands : []);
      setConnections(Array.isArray(accountData?.connections) ? accountData.connections : []);
      setLoading(false);
    }).catch((e) => { if (live) { setError(e.message || 'Could not load the review inbox.'); setLoading(false); } });
    const timer = window.setInterval(() => { void refresh().catch(() => {}); }, 7000);
    return () => { live = false; window.clearInterval(timer); };
  }, [token, refresh]);

  useEffect(() => {
    let live = true;
    let objectUrl = '';
    setMediaFile(null); setLocalMedia(null);
    setMediaUrl('');
    if (!selectedJob) return undefined;
    setError(''); setNotice(''); setCaptions(emptyCaptions());
    const suggested = selectedJob.result?.suggested_brands || [];
    const initialBrand = suggested[0]?.id || selectedJob.result?.brand_reviews?.[0]?.brand_id || selectedJob.result?.brand_id || '';
    setBrandId(initialBrand);
    setConnectionIds(selectedJob.result?.destination_connection_ids || []);
    const loadBrowserFile = async () => {
      const saved = await readVault(`driftpost-team-video-job:${userId}:${selectedJob.id}`);
      const entry = saved?.files?.find((item) => item?.blob instanceof Blob);
      if (!entry) throw new Error('This browser-uploaded video is no longer available. Select it again in Team Video.');
      if (!live) return;
      setLocalMedia(saved);
      const file = entry.blob instanceof File ? entry.blob : new File([entry.blob], entry.name || selectedJob.file_name || 'held-video.mp4', { type: entry.type || entry.blob.type || 'video/mp4' });
      objectUrl = URL.createObjectURL(file);
      setMediaFile(file); setMediaUrl(objectUrl);
    };
    const loadDriveFile = () => fetch(apiRequestUrl(`/api/intake/drive/jobs/${encodeURIComponent(selectedJob.id)}/media`), { headers: { Authorization: `Bearer ${token}` } })
      .then(async (response) => {
        if (!response.ok) { const body = await response.json().catch(() => ({})); throw new Error(body.error || 'Could not load the stopped video.'); }
        return response.blob();
      })
      .then((blob) => {
        if (!live) return;
        const file = new File([blob], selectedJob.file_name || 'held-video.mp4', { type: blob.type || selectedJob.mime_type || 'video/mp4' });
        objectUrl = URL.createObjectURL(file);
        setMediaFile(file); setMediaUrl(objectUrl);
      }).catch((e) => { if (live) setError(e.message || 'Could not load the video.'); });
    if (selectedJob.source === 'browser') void loadBrowserFile().catch((e) => { if (live) setError(e.message || 'Could not load the video.'); });
    else loadDriveFile();
    return () => { live = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [selectedId, selectedJob?.id, selectedJob?.source, token, userId]);

  const toggleConnection = (id) => setConnectionIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  const updateCaption = (platform, field, value) => setCaptions((current) => ({ ...current, [platform]: { ...current[platform], [field]: value } }));

  const generate = async () => {
    if (!mediaFile || !selectedBrand || !selectedPlatforms.length) return setError('Load the video, select the suspected brand, and choose destinations first.');
    setBusy('generate'); setError(''); setNotice('');
    try {
      const generated = await requestCaptions(token, {
        brief: `Review and write concise, accurate captions for this held video. Suggested brand: ${selectedBrand.name}.`,
        brand: selectedBrand.name, brandId: selectedBrand.id,
        files: [{ raw: mediaFile, name: mediaFile.name, type: mediaFile.type }],
        analysis: 'analyze', teamVideo: true, platforms: selectedPlatforms,
        tone: 'auto', emoji: 'medium', length: 'medium',
      });
      setCaptions(mapResponse(generated));
      setNotice(generated.brandCheck?.verdict === 'match'
        ? `AI rechecked this video against ${selectedBrand.name}. Edit the captions if needed, then choose Send.`
        : 'Captions generated. Brand evidence remains uncertain; verify the video and selected brand before choosing Send.');
    } catch (e) {
      const suggestions = e.data?.brandSuggestions;
      if (Array.isArray(suggestions) && suggestions.length) {
        setBrands((current) => [...new Map([...suggestions, ...current].map((brand) => [brand.id, brand])).values()]);
        setNotice(`The AI could not confirm ${selectedBrand.name}. Possible alternatives based on the video: ${suggestions.map((brand) => `${brand.name} (${Math.round((Number(brand.confidence) || 0) * 100)}%)`).join(', ')}. Select a candidate and regenerate.`);
      }
      setError(e.message || 'Caption generation failed. You can still write captions manually.');
    }
    finally { setBusy(''); }
  };

  const decide = async (action) => {
    if (!selectedJob || busy) return;
    if (action === 'send' && (!selectedBrand || !connectionIds.length)) return setError('Choose a brand and at least one destination before sending.');
    setBusy(action); setError(''); setNotice('');
    try {
      if (selectedJob.source === 'browser') {
        const current = JSON.parse(localStorage.getItem(`driftpost-team-video-jobs:${userId}`) || '[]');
        if (action === 'stop') {
          localStorage.setItem(`driftpost-team-video-jobs:${userId}`, JSON.stringify(current.map((job) => job.id === selectedJob.id ? { ...job, status: 'stopped', message: 'Stopped from the brand-safety review inbox. This video was not published.' } : job)));
          setNotice('Stopped. This video will not be published.');
          setJobs((items) => items.filter((job) => job.id !== selectedJob.id));
          setSelectedId('');
          return;
        }
        if (!selectedBrand || !selectedConnections.length || !mediaFile || !localMedia) throw new Error('This browser job is missing its video or selected brand/account data.');
        for (const platform of selectedPlatforms) {
          const text = platform === 'instagram' ? captions.instagram.caption : platform === 'facebook' ? captions.facebook.message : platform === 'youtube' ? captions.youtube.description : captions.x.text;
          if (!String(text || '').trim()) throw new Error(`Add a ${platform} caption before sending.`);
          if (platform === 'instagram' && captions.instagram.caption.length > 2200) throw new Error('Instagram captions must be 2,200 characters or fewer.');
          if (platform === 'x' && Array.from(captions.x.text).length > 280) throw new Error('X captions must be 280 characters or fewer.');
          if (platform === 'youtube' && !String(captions.youtube.title || '').trim()) throw new Error('Add a YouTube title before sending to YouTube.');
        }
        const group = { id: selectedJob.id, name: `Reviewed video · ${selectedBrand.name}`, accountIds: selectedConnections.map((item) => item.id), platforms: selectedPlatforms, workflow: 'team_video' };
        const cfg = { instagram: { story: false, collabs: '', collabsEnabled: false }, facebook: {}, youtube: {}, x: {} };
        await writeVault(`driftpost-stage2-media:${userId}`, localMedia);
        const restored = await readVault(`driftpost-stage2-media:${userId}`);
        if (!restored?.files?.some((entry) => entry.blob instanceof Blob)) throw new Error('Could not restore the video for publishing. Free browser storage and retry.');
        localStorage.setItem(`driftpost-team-workflow:${userId}`, 'true');
        localStorage.setItem(`driftpost-team-selection:${userId}`, JSON.stringify({ brandKey: selectedBrand.id, brandLabel: selectedBrand.name, group }));
        localStorage.setItem(`driftpost-stage2-crosspost:${userId}`, JSON.stringify(false));
        localStorage.setItem(`driftpost-stage2-brief:${userId}`, JSON.stringify(`Reviewed and approved for ${selectedBrand.name}.`));
        localStorage.setItem(`driftpost-stage2-analysis:${userId}`, JSON.stringify('analyze'));
        localStorage.setItem(`driftpost-stage2-tone:${userId}`, JSON.stringify('auto'));
        localStorage.setItem(`driftpost-stage2-emoji:${userId}`, JSON.stringify('medium'));
        localStorage.setItem(`driftpost-stage2-length:${userId}`, JSON.stringify('medium'));
        localStorage.setItem(`driftpost-team-warning:${userId}`, JSON.stringify('Video was explicitly approved in the brand-safety review inbox.'));
        saveCaptionDraft(userId, readStageSelection(userId), captions);
        localStorage.setItem(`driftpost-stage3-cfg:${userId}`, JSON.stringify(cfg));
        localStorage.setItem(`driftpost-stage3-accounts:${userId}`, JSON.stringify({}));
        localStorage.setItem(`driftpost-stage3-reviewed:${userId}`, JSON.stringify(Object.fromEntries(selectedPlatforms.map((platform) => [platform, true]))));
        sessionStorage.setItem(`driftpost-team-auto-publish:${userId}`, group.id);
        localStorage.setItem(`driftpost-team-video-jobs:${userId}`, JSON.stringify(current.map((job) => job.id === selectedJob.id ? { ...job, status: 'publishing', message: 'Explicitly approved and handed to Stage 3 for publishing.', brand: selectedBrand.name, brandKey: selectedBrand.id, accountIds: group.accountIds, platforms: group.platforms } : job)));
        setNotice('Approved. Opening the validated publishing flow…');
        onOpenStageThree?.();
        return;
      }
      const result = await api(`/api/intake/drive/jobs/${encodeURIComponent(selectedJob.id)}/review`, token, {
        method: 'POST',
        body: JSON.stringify({ action, brand_id: brandId, connection_ids: connectionIds, captions }),
      });
      setNotice(action === 'send' ? 'Approved and queued for publishing. It will leave this review inbox.' : 'Stopped. This video will not be published.');
      setSelectedId('');
      await refresh();
      if (result?.status) setJobs((current) => current.filter((job) => job.id !== selectedJob.id));
    } catch (e) { setError(e.message || `Could not ${action} this video.`); }
    finally { setBusy(''); }
  };

  return <div className="ws team-video-review-page">
    <WorkspaceNav page="team-video-review" onNavigate={onNavigate} email={session.user?.email} onSignOut={onSignOut} />
    <main className="team-review-main">
      <header className="team-review-heading"><span>BRAND SAFETY INBOX</span><h1>Stopped videos</h1><p>AI-held Drive and browser-upload videos stay unpublished until you choose a brand and destination. Review the evidence, edit copy, then send or stop.</p><button type="button" className="team-review-refresh" onClick={() => refresh().catch((e) => setError(e.message))}>Refresh inbox</button></header>
      {error && <p className="team-review-error" role="alert">{error}</p>}
      {notice && <p className="team-review-notice" role="status">{notice}</p>}
      {loading ? <p className="team-video-empty">Loading stopped videos…</p> : <div className="team-review-layout">
        <aside className="team-review-list" aria-label="Stopped videos">
          {!jobs.length && <p className="team-video-empty">No videos are waiting for a brand decision.</p>}
          {jobs.map((job) => <button type="button" key={job.id} className={`team-review-job${selectedId === job.id ? ' active' : ''}`} onClick={() => setSelectedId(job.id)}>
            <b>{job.file_name}</b><small>{job.account_name} · {new Date(job.updated_at || job.created_at).toLocaleString()}</small>
            {(job.result?.brand_reviews || []).map((review) => <small className="team-review-reason" key={review.brand_id}>{review.brand_name}: {review.reason}</small>)}
            {(job.result?.suggested_brands || []).length > 0 && <small>AI alternatives: {job.result.suggested_brands.map((item) => item.name).join(', ')}</small>}
          </button>)}
        </aside>
        <section className="team-review-detail" aria-label="Video review detail">
          {!selectedJob ? <div className="team-review-empty"><b>Select a stopped video</b><span>Its AI stop reason, video, brand options and destination controls will appear here.</span></div> : <>
            <div className="team-review-title"><div><span>STOPPED · NOT PUBLISHED</span><h2>{selectedJob.file_name}</h2></div><button type="button" className="team-review-stop" onClick={() => decide('stop')} disabled={!!busy}>{busy === 'stop' ? 'Stopping…' : 'Stop'}</button></div>
            <div className="team-review-reasons">{(selectedJob.result?.brand_reviews || []).map((item) => <p key={item.brand_id}><b>{item.brand_name}</b> · {item.verdict} ({Math.round((Number(item.confidence) || 0) * 100)}%): {item.reason}</p>)}{selectedJob.error && <p>{selectedJob.error}</p>}</div>
            {mediaUrl ? <video className="team-review-video" controls playsInline preload="metadata" src={mediaUrl} /> : <p className="team-video-empty">Loading video…</p>}
            <label className="team-review-field"><span>Brand to publish as</span><select value={brandId} onChange={(event) => { setBrandId(event.target.value); setCaptions(emptyCaptions()); }}><option value="">Choose a saved brand</option>{brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}{(selectedJob.result?.suggested_brands || []).some((item) => item.id === brand.id) ? ' · AI suggested' : ''}</option>)}</select></label>
            <fieldset className="team-review-accounts"><legend>Destination accounts</legend>{PLATFORMS.flatMap((platform) => {
              const accounts = connections.filter((item) => item.platform === platform.id);
              if (!accounts.length) return [];
              return [<div key={platform.id}><b>{platform.name}</b>{accounts.map((account) => <label key={account.id}><input type="checkbox" checked={connectionIds.includes(account.id)} onChange={() => toggleConnection(account.id)} />{account.account_name || platform.name}</label>)}</div>];
            })}</fieldset>
            <div className="team-review-caption-head"><div><h3>Captions</h3><p>Generate for the chosen brand or edit each destination directly.</p></div><button type="button" onClick={generate} disabled={busy === 'generate' || !mediaFile || !brandId || !connectionIds.length}>{busy === 'generate' ? 'Analyzing…' : 'Generate with AI'}</button></div>
            {selectedPlatforms.map((platform) => <div className="team-review-caption" key={platform}><b>{PLATFORMS.find((item) => item.id === platform)?.name || platform}</b>{platform === 'youtube' && <input aria-label="YouTube title" maxLength={100} placeholder="Video title" value={captions.youtube.title} onChange={(event) => updateCaption('youtube', 'title', event.target.value)} />}<textarea aria-label={`${platform} caption`} rows={4} maxLength={platform === 'instagram' ? 2200 : platform === 'x' ? 280 : undefined} placeholder={`Write the ${platform} caption…`} value={platform === 'instagram' ? captions.instagram.caption : platform === 'facebook' ? captions.facebook.message : platform === 'youtube' ? captions.youtube.description : captions.x.text} onChange={(event) => updateCaption(platform, platform === 'instagram' ? 'caption' : platform === 'facebook' ? 'message' : platform === 'youtube' ? 'description' : 'text', event.target.value)} /></div>)}
            <div className="team-review-actions"><button type="button" className="team-review-send" onClick={() => decide('send')} disabled={!!busy || !mediaFile}>{busy === 'send' ? 'Queueing…' : 'Send'}</button><button type="button" className="team-review-stop" onClick={() => decide('stop')} disabled={!!busy}>Stop — do not publish</button></div>
          </>}
        </section>
      </div>}
    </main>
  </div>;
}
