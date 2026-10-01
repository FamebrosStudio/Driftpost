import React, { useEffect, useMemo, useState } from 'react';
import { api, submitCampaign } from '../lib.js';

const MAX_VIDEO = 400 * 1024 * 1024;
const dateTimeValue = (day) => {
  const d = new Date(`${day}T12:00:00`);
  if (day === new Date().toLocaleDateString('en-CA')) d.setTime(Date.now() + 60 * 60 * 1000);
  d.setSeconds(0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const localNow = () => {
  const d = new Date(Date.now() + 60 * 1000);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const platformLabel = (platform) => ({ instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube', x: 'X' })[platform] || platform;

function fileError(account, files) {
  if (files.length > (account.platform === 'x' ? 4 : 10)) return `${platformLabel(account.platform)} allows fewer files per post.`;
  if (files.some((file) => !file.type.startsWith('image/') && !file.type.startsWith('video/'))) return 'Use image or video files.';
  if (files.some((file) => file.type.startsWith('video/') && file.size > MAX_VIDEO)) return 'Videos must be 400 MB or smaller.';
  if (account.platform === 'instagram' && files.some((file) => file.type.startsWith('image/') && (file.type !== 'image/jpeg' || file.size > 8 * 1024 * 1024))) return 'Instagram images must be JPEG and 8 MB or smaller.';
  if (account.platform !== 'instagram' && files.some((file) => file.type.startsWith('image/') && file.size > 10 * 1024 * 1024)) return 'Images must be 10 MB or smaller.';
  if (files.length > 1 && files.some((file) => file.type.startsWith('video/')) && ['instagram', 'facebook'].includes(account.platform)) return 'Instagram and Facebook carousels support photos only; use one video instead.';
  if (account.platform === 'youtube' && (files.length !== 1 || !files[0]?.type.startsWith('video/'))) return 'YouTube needs exactly one video per selected channel.';
  if (account.platform === 'instagram' && !files.length) return 'Instagram needs a photo or video.';
  return '';
}

export default function CampaignComposer({ session, accounts, day, onClose, onSaved }) {
  const [selectedIds, setSelectedIds] = useState([]);
  const [mediaById, setMediaById] = useState({});
  const [caption, setCaption] = useState('');
  const [title, setTitle] = useState('');
  const [name, setName] = useState('');
  const [scheduledAt, setScheduledAt] = useState(() => dateTimeValue(day));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [jobs, setJobs] = useState([]);
  const [campaignId, setCampaignId] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const selected = useMemo(() => selectedIds.map((id) => accounts.find((account) => account.id === id)).filter(Boolean), [selectedIds, accounts]);
  const minDateTime = localNow();

  useEffect(() => {
    if (!submitted && !campaignId) setScheduledAt(dateTimeValue(day));
  }, [day, submitted, campaignId]);

  useEffect(() => {
    if (!campaignId) return undefined;
    let active = true;
    let timer;
    const refresh = async () => {
      try {
        const data = await api(`/api/schedules/campaign/${campaignId}`, session.access_token);
        if (!active) return;
        setJobs(data.schedules || []);
        const current = data.schedules || [];
        if (current.length && current.every((post) => ['published', 'failed', 'cancelled'].includes(post.status))) {
          setBusy(false);
          const successes = current.filter((post) => post.status === 'published').length;
          setNotice(`${successes} of ${current.length} posts published.`);
          return;
        }
      } catch (e) {
        if (active) setError(e.message || 'Could not refresh campaign progress.');
      }
      if (active) timer = setTimeout(refresh, 5000);
    };
    timer = setTimeout(refresh, 1200);
    return () => { active = false; clearTimeout(timer); };
  }, [campaignId, session.access_token]);

  const toggle = (id) => {
    setSelectedIds((old) => old.includes(id) ? old.filter((value) => value !== id) : [...old, id]);
    setMediaById((old) => ({ ...old, [id]: old[id] || [] }));
  };
  const setFiles = (account, fileList) => {
    const files = Array.from(fileList || []);
    const message = fileError(account, files);
    setMediaById((old) => ({ ...old, [account.id]: files }));
    setError(message);
  };
  const submit = async (when) => {
    setError(''); setNotice('');
    if (!selected.length) return setError('Select at least one connected account.');
    if (selected.length > 25) return setError('A campaign can include up to 25 accounts.');
    if (selected.reduce((total, account) => total + (mediaById[account.id]?.length || 0), 0) > 60) return setError('A campaign can include up to 60 media files total.');
    if (!caption.trim()) return setError('Write the caption that will be shared across all selected accounts.');
    if (selected.some((account) => fileError(account, mediaById[account.id] || []))) return setError('Add valid media for each selected account and review the media requirements.');
    if (selected.some((account) => account.platform === 'x') && Array.from(caption.trim()).length > 280) return setError('X captions must be 280 characters or fewer.');
    if (selected.some((account) => account.platform === 'instagram') && caption.trim().length > 2200) return setError('Instagram captions must be 2,200 characters or fewer.');
    if (selected.some((account) => account.platform === 'youtube') && !title.trim()) return setError('YouTube needs a title.');
    if (when && new Date(when).getTime() < Date.now() + 60_000) return setError('Choose a scheduled time at least one minute from now.');
    setBusy(true);
    try {
      const targets = selected.map((connection) => ({ connection, files: mediaById[connection.id] || [] }));
      const data = await submitCampaign(session.access_token, { targets, caption: caption.trim(), title: title.trim(), name: name.trim(), when, publishNow: !when });
      if (when) {
        setNotice(`Scheduled ${data.schedules?.length || selected.length} posts for ${new Date(when).toLocaleString()}.`);
        setSubmitted(true);
        onSaved?.();
        setBusy(false);
      } else {
        setCampaignId(data.campaign_id);
        setJobs(data.schedules || []);
        setNotice(`Campaign queued: ${selected.length} account${selected.length === 1 ? '' : 's'}. Posts publish one by one.`);
        onSaved?.();
      }
    } catch (e) {
      setBusy(false);
      setError(e.message || 'Could not submit the campaign.');
    }
  };
  const locked = busy || !!campaignId || submitted;

  return <section className="ws-panel ws-campaign" aria-labelledby="campaign-title">
    <div className="ws-panel-head"><div><span className="ws-eyebrow">One caption, account-specific media</span><h2 id="campaign-title">Create a campaign</h2></div><button type="button" className="ws-secondary" onClick={onClose}>Close</button></div>
    <p className="ws-campaign-intro">Select any connected accounts, drop each account’s own design or video onto its card, write one shared caption, then publish now or schedule them together.</p>
    {!accounts.length ? <div className="ws-inline-state">No connected accounts found. Connect a social account first.</div> : <>
      <div className="ws-campaign-accounts" role="group" aria-label="Connected accounts">
        {accounts.map((account) => <label key={account.id} className={`ws-campaign-account ${selectedIds.includes(account.id) ? 'selected' : ''}`}>
          <input type="checkbox" checked={selectedIds.includes(account.id)} onChange={() => toggle(account.id)} />
          <span><b>{account.account_name || account.name || platformLabel(account.platform)}</b><small>{platformLabel(account.platform)}</small></span>
        </label>)}
      </div>
      {selected.length > 0 && <div className="ws-campaign-media">
        <h3>Media for each account <small>Drag files into a card or browse. Instagram photos need JPEG.</small></h3>
        {selected.map((account) => <label key={account.id} className="ws-campaign-drop" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); setFiles(account, event.dataTransfer.files); }}>
          <span><b>{account.account_name || account.name || platformLabel(account.platform)}</b><small>{platformLabel(account.platform)} · {mediaById[account.id]?.length ? mediaById[account.id].map((file) => file.name).join(', ') : 'Drop media here or choose files'}</small></span>
          <input type="file" accept="image/*,video/*" multiple={account.platform !== 'youtube'} onChange={(event) => setFiles(account, event.target.files)} />
        </label>)}
      </div>}
      {selected.some((account) => account.platform === 'youtube') && <label className="ws-campaign-field"><span>YouTube title</span><input maxLength={100} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Shared video title" /></label>}
      <label className="ws-campaign-field"><span>Campaign name <small>Optional, for your team</small></span><input maxLength={120} value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Diwali 2026" /></label>
      <label className="ws-campaign-field"><span>Shared caption</span><textarea rows={5} value={caption} onChange={(event) => setCaption(event.target.value)} placeholder="This caption will be used for every selected account." /></label>
      <label className="ws-campaign-field"><span>Schedule date and time</span><input type="datetime-local" min={minDateTime} value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} /></label>
      {notice && <p className="ws-inline-state" role="status">{notice}</p>}
      {error && <p className="ws-inline-state ws-campaign-error" role="alert">{error}</p>}
      {jobs.length > 0 && <div className="ws-campaign-progress" aria-live="polite">{jobs.map((post) => <div key={post.id}><b>{platformLabel(post.platform)}</b><span>{post.status}{post.error ? `: ${post.error}` : post.result_url ? ': published' : ''}</span></div>)}</div>}
      <div className="ws-campaign-actions"><button className="ws-secondary" type="button" disabled={locked || !selected.length} onClick={() => submit('')}>{busy && !campaignId ? 'Starting…' : 'Post now'}</button><button className="ws-primary" type="button" disabled={locked || !selected.length || !scheduledAt} onClick={() => submit(scheduledAt)}>Schedule campaign</button></div>
    </>}
  </section>;
}
