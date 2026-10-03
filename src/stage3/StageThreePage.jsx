import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { api, apiUrl, groupBrands, PLATFORMS, resetPostState, schedulePost, fetchWithAuth } from '../lib.js';
import { readVault, updateVault, vaultFiles } from '../stage2/mediaVault.js';
import { requestCaptions, mapResponse, approveCaption } from '../stage2/ai.js';
import { composeOutput } from '../stage2/PlatformOutputCard.jsx';
import { photoToVideo } from './photoVideo.js';
import { instagramMediaFiles, facebookMediaFiles } from './instagramMedia.js';
import { parseInstagramCollaborators } from './instagramCollaborators.js';
import { logCaptions, logPost } from '../history/log.js';
import ProgressStepper from './ProgressStepper.jsx';
import PlatformTabs from './PlatformTabs.jsx';
import Workspace from './Workspace.jsx';
import MediaPreview from './MediaPreview.jsx';
import EpidemicCatalog from '../music/EpidemicCatalog.jsx';
import ScheduleModal from './ScheduleModal.jsx';
import './stage3.css';
import { WorkspaceNav } from '../workspace/Workspace.jsx';
import { hasAiAccess } from '../ai-access.js';

function load(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ?? fallback;
  } catch { return fallback; }
}
function save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}
const mediaSignature = (items) => JSON.stringify(items.map((f) => ({
  name: f.name || f.raw?.name || '',
  size: f.raw?.size || 0,
  modified: f.raw?.lastModified || 0,
  type: f.type || f.raw?.type || '',
})));
const scopedKey = (key, userId) => `${key}:${userId}`;

const DEFAULT_CFG = {
  instagram: { shareFb: false, story: false, alt: '', topics: '', partner: '', collabs: '' },
  facebook: { link: '', syndIg: false, cta: '', age: '' },
  youtube: { privacy: 'private', category: '', kids: '' },
  x: { pollOn: false, opts: ['', '', '', ''], mins: '1440', reply: 'everyone' },
};
const NAMES = { instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube', x: 'X' };

export default function StageThreePage({ session, onBack, onSignOut, onNavigate, onDone, onBackgroundProgress }) {
  const userId = session.user.id;
  const canUseAi = hasAiAccess(session);
  const [connections, setConnections] = useState([]);
  const [files, setFiles] = useState([]);
  const [thumb, setThumb] = useState(null);
  const [coverMap, setCoverMap] = useState({ instagram: null, facebook: null });
  const [outputs, setOutputs] = useState(() => load(scopedKey('driftpost-stage2-outputs', userId), {}));
  const [cfg, setCfg] = useState(() => load(scopedKey('driftpost-stage3-cfg', userId), {}));
   const [overrides, setOverrides] = useState(() => load(scopedKey('driftpost-stage3-accounts', userId), {}));
   const pinnedBrandAccounts = load('driftpost-stage1-brand-accounts', {});
   // Pre-upload technique: media is pushed to Supabase while the
   // user is reviewing captions, so "Post" skips the file transfer
   // entirely and the server just downloads once for Facebook.
   const [cloudProgress, setCloudProgress] = useState(null);
   const [cloudDone, setCloudDone] = useState(false);
  const [reviewed, setReviewed] = useState(() => load(scopedKey('driftpost-stage3-reviewed', userId), {}));
  const [tab, setTab] = useState('');
  const [results, setResults] = useState({});
  const [busy, setBusy] = useState({});
  const publishSlots = useRef({ active: 0, waiters: [] });
  const detachedPublish = useRef(false);
  const batchProgressRef = useRef(null);
  const [batchQueue, setBatchQueue] = useState(null);
  const [regen, setRegen] = useState('');
  const [brief] = useState(() => load(scopedKey('driftpost-stage2-brief', userId), ''));
  const [analysisMode] = useState(() => load(scopedKey('driftpost-stage2-analysis', userId), 'fast'));
  const [success, setSuccess] = useState(null);
  const [schedOpen, setSchedOpen] = useState(false);
  const [schedBusy, setSchedBusy] = useState(false);
  const [encoding, setEncoding] = useState(false);
  const [schedMsg, setSchedMsg] = useState('');
  // The modal stays open when a schedule is rejected, so the reason has to be
  // shown inside it - not only on the bar behind it.
  const [schedErr, setSchedErr] = useState('');
  const [approvalLinks, setApprovalLinks] = useState([]);
  const [pubMsg, setPubMsg] = useState('');
  const [connsError, setConnsError] = useState('');
  const [connsTick, setConnsTick] = useState(0);
  // Same-tick double clicks slip past state guards (state updates async), so
  // every fire-once action also claims a sync ref — no double posts, no
  // double schedules, ever.
  const firing = useRef(new Set());
  const claim = (k) => { if (firing.current.has(k)) return false; firing.current.add(k); return true; };
  const release = (k) => { firing.current.delete(k); };

  useEffect(() => { document.title = 'Stage 3 · Driftpost'; }, []);
  useEffect(() => {
    let live = true;
    setConnsError('');
    api('/api/connections', session.access_token)
      .then((d) => { if (live) setConnections(d.connections || []); })
      .catch((e) => { if (live) setConnsError(e.message || 'Could not load your accounts.'); });
    return () => { live = false; };
  }, [session, connsTick]);

   const mediaKey = `driftpost-stage2-media:${session.user.id}`;
   const cloudCacheKey = `driftpost-media-uploads:${session.user.id}`;
   useEffect(() => {
     (async () => {
       const vault = await readVault(mediaKey);
       const list = vaultFiles(vault);
       if (list.length) setFiles(list);
       if (vault?.thumb?.blob instanceof Blob) {
         const b = vault.thumb.blob;
         const raw = b instanceof File ? b : new File([b], vault.thumb.name || 'cover.jpg', { type: b.type || 'image/jpeg' });
         setThumb({ raw, name: vault.thumb.name || raw.name });
       }
       const restoredCovers = {};
       for (const platform of ['instagram', 'facebook']) {
         const saved = vault?.coverMap?.[platform];
         if (!(saved?.blob instanceof Blob)) continue;
         const raw = saved.blob instanceof File ? saved.blob : new File([saved.blob], saved.name || `${platform}-cover.jpg`, { type: saved.blob.type || 'image/jpeg' });
         restoredCovers[platform] = { raw, name: saved.name || raw.name };
       }
       setCoverMap((old) => ({ ...old, ...restoredCovers }));
     })();
   }, [mediaKey]);

   // Pre-upload media to Supabase while the user reviews captions.
   // Stored in localStorage so "Post" can skip the file transfer.
    useEffect(() => {
      (async () => {
        if (!files.length) return;
        // Photos now get smaller, platform-specific renditions at publish
        // time, so pre-uploading the originals would waste storage and then
        // send the same bytes again. Keep the fast pre-upload path for video.
        if (files.some((f) => (f.type || f.raw?.type || '').startsWith('image/'))) {
          try { localStorage.removeItem(cloudCacheKey); } catch {}
          if (cloudDone) setCloudDone(false);
          setCloudProgress(null);
          return;
        }
        if (cloudDone) return;
        const prev = load(cloudCacheKey, null);
        const curKey = mediaSignature(files);
        if (prev?.filesKey === curKey && prev?.files?.length === files.length && prev.files.every((f) => f.publicUrl)) {
          setCloudDone(true);
          return;
        }
        try { localStorage.removeItem(cloudCacheKey); } catch {}
        const out = [];
        setCloudProgress({ done: 0, total: files.length });
        // Send each file as multipart and ask the server to upload to
        // Supabase Storage using the service key. This bypasses
        // browser CORS restrictions that would otherwise block a
        // direct client-side POST to Supabase Storage.
        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          try {
            const body = new FormData();
            body.append('file', f.raw, f.name || `upload-${Date.now()}`);
            const res = await api('/api/storage/upload', session.access_token, {
              method: 'POST',
              body,
            });
            if (!res.results?.[0]?.publicUrl) throw new Error('server upload failed');
            out.push({ name: f.name || res.results[0].name, publicUrl: res.results[0].publicUrl, mimetype: f.type || '' });
          } catch (e) { /* keep going; the normal upload path will recover */ }
          setCloudProgress({ done: i + 1, total: files.length });
        }
        if (out.length === files.length) {
          save(cloudCacheKey, { files: out, filesKey: curKey });
          setCloudDone(true);
        }
      })();
    }, [files, cloudDone, cloudCacheKey]);

  // Stage 1 + 2 context drives everything.
  const s1 = useMemo(() => ({
    type: load('driftpost-stage1-type', ''),
    brandKey: load('driftpost-stage1-brand', ''),
    platforms: load('driftpost-stage1-platforms', []),
    groups: load('driftpost-groups', []),
    groupId: load('driftpost-stage1-group', ''),
    crosspost: load('driftpost-stage2-crosspost', false),
    tone: load(scopedKey('driftpost-stage2-tone', userId), 'auto'),
    emoji: load(scopedKey('driftpost-stage2-emoji', userId), 'medium'),
    length: load(scopedKey('driftpost-stage2-length', userId), 'medium'),
  }), []);
  const brands = useMemo(() => groupBrands(connections), [connections]);
  const brand = brands.find((b) => b.key === s1.brandKey) || null;
  const connById = useMemo(() => Object.fromEntries(connections.map((c) => [c.id, c])), [connections]);
  const platsOf = (ids) => [...new Set((ids || []).map((id) => connById[id]?.platform).filter(Boolean))];
  // A group's stored platform selection (g.platforms) narrows its member
  // platforms. Groups saved before this feature carry no selection and
  // behave as before (all member platforms).
  const groupPlats = (g) => {
    const member = platsOf(g.accountIds);
    const sel = Array.isArray(g.platforms) && g.platforms.length ? g.platforms : member;
    return sel.filter((p) => member.includes(p));
  };

  const basePlatforms = useMemo(() => {
    const order = PLATFORMS.map((p) => p.id);
    let list = [];
    if (s1.type === 'common_brand' && brand) list = Object.keys(brand.map || {});
    else if (s1.type === 'platform_selection') list = s1.platforms || [];
    else if (s1.type === 'create_groups') list = (s1.groups || []).flatMap((g) => groupPlats(g));
    else if (s1.type === 'existing_groups') {
      const g = (s1.groups || []).find((x) => x.id === s1.groupId);
      list = g ? groupPlats(g) : [];
    }
    return order.filter((pid) => list.includes(pid));
  }, [s1, brand, connById]);
  // Group flows post the same content to EVERY member account — never one
  // account. Everything below keys off this flag; brand/platform flows are
  // untouched.
  const isGroupFlow = s1.type === 'existing_groups' || s1.type === 'create_groups';
  const groupIds = useMemo(() => {
    if (s1.type === 'existing_groups') {
      const g = (s1.groups || []).find((x) => x.id === s1.groupId);
      return [...new Set(g?.accountIds || [])];
    }
    if (s1.type === 'create_groups') return [...new Set((s1.groups || []).flatMap((g) => g.accountIds || []))];
    return [];
  }, [s1]);
  // Member account ids on one platform, in group order.
  const groupMemberIds = (pid) => [...new Set(groupIds)].filter((id) => connById[id]?.platform === pid);

  const cfgFor = (pid) => ({ ...(DEFAULT_CFG[pid] || {}), ...(cfg[pid] || {}) });
  // Mirroring covers its destination. Keep that destination out of the
  // Stage 3 tabs so users cannot accidentally publish a second copy.
  const mirrorTarget = (() => {
    if (!basePlatforms.includes('instagram') || !basePlatforms.includes('facebook')) return '';
    if (s1.crosspost || cfgFor('instagram').shareFb) return 'facebook';
    if (cfgFor('facebook').syndIg) return 'instagram';
    return '';
  })();
  const platforms = basePlatforms.filter((pid) => pid !== mirrorTarget);
  const brandLabel = s1.type === 'common_brand' ? brand?.label || '' : '';

  useEffect(() => {
    if (!platforms.includes(tab)) setTab(platforms[0] || '');
  }, [platforms, tab]);

  // Group flows only ever see group members: the dropdown/default can never
  // point at an unrelated account. Other flows behave exactly as before.
  const accountsFor = (pid) => isGroupFlow
    ? groupMemberIds(pid).map((id) => connById[id]).filter(Boolean)
    : connections.filter((c) => c.platform === pid);
   const accountFor = (pid) => {
    if (isGroupFlow) {
      const ids = groupMemberIds(pid);
      const o = overrides[pid];
      if (o && ids.includes(o)) return o;
      return ids[0] || '';
    }
    // common_brand keeps the exact accounts pinned when the brand
    // was chosen, so the same account is used regardless of later
    // connection reshuffling in groupBrands().
    const p = pinnedBrandAccounts[pid];
    if (p && connById[p]) return p;
    const o = overrides[pid];
    if (o && connById[o]?.platform === pid) return o;
    if (s1.type === 'common_brand' && brand?.map?.[pid] && connById[brand.map[pid]]) return brand.map[pid];
    return connections.find((c) => c.platform === pid)?.id || '';
  };

  // Instagram collaborator lookups run through one connected account. Use the
  // one this post publishes from so the suggested accounts match that audience.
  const instagramLookupId = (() => {
    const list = connections.filter((c) => c.platform === 'instagram');
    const chosen = accountFor('instagram');
    return (chosen && list.find((c) => c.id === chosen)?.id) || list[0]?.id || '';
  })();

  const greyed = () => false;
  // Group fan-out still includes every selected account on the hidden side.
  const coveredPids = (pid) => {
    const list = [pid];
    if (pid === 'instagram' && mirrorTarget === 'facebook') list.push('facebook');
    if (pid === 'facebook' && mirrorTarget === 'instagram') list.push('instagram');
    return list;
  };
  const greyReason = () => '';
  const effective = platforms.filter((pid) => !greyed(pid));

  const statusOf = (pid) => {
    const r = results[pid];
    if (r?.state === 'completed') return 'posted';
    if (r?.state === 'scheduled') return 'scheduled';
    if (r?.state === 'failed') return 'failed';
    return reviewed[pid] ? 'reviewed' : '';
  };
  const reviewedCount = effective.filter((pid) => reviewed[pid] || results[pid]?.state === 'completed').length;

  const onValues = (pid, v) => setOutputs((o) => { const n = { ...o, [pid]: v }; save(scopedKey('driftpost-stage2-outputs', userId), n); return n; });
  // One card's validity, mirroring the Workspace checks — Publish All and
  // Schedule refuse invalid cards instead of failing mid-flight.
  // allowGreyed: a greyed-out card is still validated when another card's
  // mirror covers it (its members get direct posts).
  const invalidReason = (pid, { allowGreyed = false } = {}) => {
    const v = outputs[pid] || {};
    const c = cfgFor(pid);
    if (!allowGreyed && greyed(pid)) return 'skipped by cross-post — turn the mirror off to post it directly';
    if (isGroupFlow ? !groupMemberIds(pid).length : !accountFor(pid)) return 'no account — pick one first';
    const mirroredPlatform = pid === 'instagram' && mirrorTarget === 'facebook'
      ? 'facebook'
      : pid === 'facebook' && mirrorTarget === 'instagram' ? 'instagram' : '';
    if (mirroredPlatform && (isGroupFlow ? !groupMemberIds(mirroredPlatform).length : !accountFor(mirroredPlatform))) {
      return `connect or select a ${NAMES[mirroredPlatform]} account to receive the cross-post`;
    }
    if (pid === 'x') {
      if (!v.text?.trim()) return 'write the post text first';
      if (Array.from(v.text || '').length > 280) return 'too long — shorten to 280 characters';
      if (c.pollOn && files.length > 0) return 'polls can’t carry photos — remove media in Stage 2';
      if (c.pollOn && !(c.opts?.[0]?.trim() && c.opts?.[1]?.trim())) return 'a poll needs at least 2 answers';
    }
    if (pid === 'facebook' && c.cta && !c.link?.trim()) return 'a button needs a website link above';
    if (pid === 'facebook' && !v.message?.trim() && !c.link?.trim() && !files.length) return 'add post text, a website link, or media';
    if (pid === 'instagram' && !files.some((f) => /^(image|video)\//.test(f.type))) return 'Instagram needs a photo or video';
    if (pid === 'instagram' && Array.from(composeOutput(pid, v)).length > 2200) return 'caption plus hashtags exceeds Instagram’s 2,200 character limit';
    if (pid === 'instagram' && parseInstagramCollaborators(c.collabs).error) return parseInstagramCollaborators(c.collabs).error;
    if (pid === 'youtube' && !files.some((f) => f.type.startsWith('video/')) && !files.length) return 'YouTube needs a video file, or a photo to convert into a Short';
    if (pid === 'youtube' && files.length > 1) return 'YouTube accepts one video per post';
    if (pid === 'youtube' && !v.title?.trim()) return 'add a title before posting to YouTube';
    if (pid === 'youtube' && (v.title || '').length > 100) return 'YouTube titles must be 100 characters or less';
    return '';
  };
  const mirrorErrorFor = (pid) => {
    const target = pid === 'instagram' && mirrorTarget === 'facebook'
      ? 'facebook'
      : pid === 'facebook' && mirrorTarget === 'instagram' ? 'instagram' : '';
    if (!target) return '';
    if (isGroupFlow ? !groupMemberIds(target).length : !accountFor(target)) return `no ${NAMES[target]} account is selected`;
    if (target === 'instagram' && !files.some((f) => /^(image|video)\//.test(f.type))) return 'Instagram needs a photo or video';
    if (target === 'instagram' && Array.from(mainText('facebook')).length > 2200) return 'the Instagram caption exceeds 2,200 characters';
    if (target === 'instagram' && parseInstagramCollaborators(cfgFor('instagram').collabs).error) return parseInstagramCollaborators(cfgFor('instagram').collabs).error;
    return '';
  };
  const onCfg = (pid, patch) => setCfg((c) => {
    const n = { ...c, [pid]: { ...cfgFor(pid), ...patch } };
    if (pid === 'instagram' && patch.shareFb) n.facebook = { ...cfgFor('facebook'), syndIg: false };
    if (pid === 'facebook' && patch.syndIg) n.instagram = { ...cfgFor('instagram'), shareFb: false };
    save(scopedKey('driftpost-stage3-cfg', userId), n);
    return n;
  });
  const onAccount = (pid, id) => setOverrides((o) => { const n = { ...o, [pid]: id }; save(scopedKey('driftpost-stage3-accounts', userId), n); return n; });
  const onThumb = (t) => {
    setThumb(t);
    updateVault(mediaKey, (prev) => ({
        ...(prev || {}),
        files: (prev?.files || []),
        thumb: t?.raw instanceof Blob ? { name: t.name, blob: t.raw } : null,
      }));
  };
  const onPlatformCover = (platform, t) => {
    setCoverMap((old) => ({ ...old, [platform]: t }));
    updateVault(mediaKey, (prev) => {
      const stored = { ...(prev?.coverMap || {}) };
      stored[platform] = t?.raw instanceof Blob ? { name: t.name, blob: t.raw } : null;
      return { ...(prev || {}), files: prev?.files || [], coverMap: stored };
    });
  };
  const onMusicApplied = async (file) => {
    const nextFiles = [{ raw: file, name: file.name, size: `${(file.size / 1024 / 1024).toFixed(1)} MB`, type: file.type }];
    setFiles(nextFiles);
    localStorage.removeItem(cloudCacheKey);
    setReviewed({});
    save(scopedKey('driftpost-stage3-reviewed', userId), {});
    await updateVault(mediaKey, (previous) => ({
      ...(previous || {}),
      files: [{ name: file.name, type: file.type, blob: file }],
    }));
  };
  // Reviewing a card is the approval signal: the server keeps this caption as a
  // reference so the next generation for the same brand writes closer to it.
  const onReviewed = (pid) => {
    if (detachedPublish.current) return;
    if (canUseAi) approveCaption(session.access_token, { brand: brandLabel, platform: pid, caption: composeOutput(pid, outputs[pid] || {}) }).catch(() => {});
    setReviewed((r) => { const n = { ...r, [pid]: true }; save(scopedKey('driftpost-stage3-reviewed', userId), n); return n; });
  };

  const regenOne = async (pid) => {
    if (!canUseAi || busy[pid] || regen || (!brief.trim() && !(analysisMode === 'analyze' && files.length))) return;
    setRegen(pid);
    try {
      const data = await requestCaptions(session.access_token, {
        brief, brand: brandLabel, files,
        tone: s1.tone, emoji: s1.emoji, length: s1.length,
        analysis: analysisMode,
        only: pid,
      });
      const mapped = mapResponse(data);
      onValues(pid, mapped[pid]);
      logCaptions({ userId, brand: brandLabel, entries: [{ platform: pid, text: composeOutput(pid, mapped[pid]) }] });
    } catch {}
    setRegen('');
  };

  const mainText = (pid) => {
    const v = outputs[pid] || {};
    if (pid === 'instagram') return composeOutput(pid, v) || brief;
    if (pid === 'facebook') return v.message || brief;
    if (pid === 'youtube') return v.description || brief;
    return v.text || brief;
  };

  // One canonical body per platform: the instant publish and the scheduler
  // both send this, so a scheduled post is byte-identical to a manual one.
  const bodyFor = (pid, { skipCrossPost = false } = {}) => {
    const c = cfgFor(pid);
    const v = outputs[pid] || {};
    const body = {
      platform: pid,
      connection_id: accountFor(pid),
      text: mainText(pid),
      title: v.title || '',
      privacy: c.privacy || 'private',
      yt_title: v.title || '',
      yt_description: v.description || '',
      yt_tags: v.tags || '',
      yt_privacy: c.privacy || 'private',
      yt_category: c.category || '',
      yt_kids: c.kids || '',
      ig_caption: composeOutput('instagram', v),
      ig_share_fb: (mirrorTarget === 'facebook' && pid === 'instagram') ? '1' : '',
      ig_post_story: c.story ? '1' : '',
      ig_alt: c.alt || '',
      ig_topics: c.topics || '',
      ig_partner: c.partner || '',
      ig_collabs: parseInstagramCollaborators(cfgFor('instagram').collabs).usernames.join(','),
      fb_connection_id: accountFor('facebook'),
      fb_message: mirrorTarget === 'facebook' && pid === 'instagram'
        ? mainText('instagram')
        : (outputs.facebook || {}).message || '',
      fb_link: c.link || '',
      fb_synd_ig: (mirrorTarget === 'instagram' && pid === 'facebook') ? '1' : '',
      ig_connection_id: accountFor('instagram'),
      fb_cta: c.cta || '',
      fb_age: c.age || '',
      x_text: v.text || '',
      x_reply: c.reply || 'everyone',
      x_poll_options: JSON.stringify(c.pollOn ? (c.opts || []) : []),
      x_poll_minutes: c.mins || '1440',
    };
    if (skipCrossPost) body.skip_crosspost = '1';
    return body;
  };

   const buildForm = async (pid, { connectionId = null, skipCrossPost = false, mediaOverride = null } = {}) => {
     const body = bodyFor(pid, { skipCrossPost });
     if (connectionId) body.connection_id = connectionId;
     const uploaded = load(cloudCacheKey, null);
     const usePreuploaded = uploaded?.filesKey === mediaSignature(files)
       && uploaded?.files?.length === files.length
       && uploaded.files.every((f) => f.publicUrl)
       && !files.some((f) => (f.type || f.raw?.type || '').startsWith('image/'));
     const form = new FormData();
     for (const [k, v] of Object.entries(body)) form.append(k, v);
     const sourceMedia = mediaOverride || files;
     const igMedia = (pid === 'instagram' || (pid === 'facebook' && mirrorTarget === 'instagram'))
       ? await instagramMediaFiles(sourceMedia)
       : null;
     const fbMedia = (pid === 'facebook' || (pid === 'instagram' && mirrorTarget === 'facebook'))
       ? await facebookMediaFiles(sourceMedia)
       : null;
     if (usePreuploaded && !mediaOverride && pid === 'facebook') {
       body.hasPreuploadedMedia = '1';
       form.append('hasPreuploadedMedia', '1');
       uploaded.files.forEach((f, i) => {
         form.append('mediaUrl' + i, f.publicUrl);
         form.append('mediaName' + i, f.name);
         form.append('mediaType' + i, f.mimetype || '');
       });
     } else {
       // mediaOverride replaces the selected files (used for photo -> video).
       const media = pid === 'instagram' ? (igMedia || sourceMedia) : pid === 'facebook' ? (fbMedia || sourceMedia) : sourceMedia;
       for (const f of media.slice(0, 10)) { if (f?.raw) form.append('media', f.raw); }
     }
     if (pid === 'facebook' && mirrorTarget === 'instagram' && igMedia) {
       for (const f of igMedia.slice(0, 10)) {
         if (f?.raw && f.type?.startsWith('image/')) form.append('instagram_media', f.raw, f.name);
       }
     }
     if (pid === 'instagram' && mirrorTarget === 'facebook' && fbMedia) {
       for (const f of fbMedia.slice(0, 10)) {
         if (f?.raw && f.type?.startsWith('image/')) form.append('facebook_media', f.raw, f.name);
       }
     }
     if (pid === 'youtube' && thumb?.raw) form.append('thumbnail', thumb.raw, thumb.name);
     const destinations = [pid];
     if (pid === 'instagram' && mirrorTarget === 'facebook') destinations.push('facebook');
     if (pid === 'facebook' && mirrorTarget === 'instagram') destinations.push('instagram');
     for (const platform of destinations) {
       const cover = coverMap[platform];
       if (platform !== 'youtube' && cover?.raw) form.append(`cover_${platform}`, cover.raw, cover.name);
     }
     return form;
   };

  // Limit simultaneous browser-side transformations and file uploads. The
  // slot is released as soon as the server accepts a job; polling never holds
  // it, so every account can enter the server queue without waiting for a
  // previous platform to finish.
  const withPublishSlot = async (task) => {
    const slots = publishSlots.current;
    if (slots.active < 2 && slots.waiters.length === 0) slots.active++;
    else await new Promise((resolve) => slots.waiters.push(resolve));
    try { return await task(); }
    finally {
      const next = slots.waiters.shift();
      if (next) next();
      else slots.active--;
    }
  };

  // Publishing different platforms is intentionally concurrent. Always merge
  // a result by key so a slower callback cannot overwrite another platform's
  // newer result with the stale `results` snapshot captured when it started.
  const commitPublishResult = (out, key, value) => {
    out[key] = value;
    setResults((current) => ({ ...current, [key]: value }));
  };

  // Post to ONE connection and poll the job. Returns the post URL.
  // When connectionId is given, the form carries exactly that account.
  // The POST itself auto-refreshes a dead login token; polls inherit it.
  const runToAccount = async (pid, connectionId, out, key, { skipCrossPost = false, mediaOverride = null, onProgress = null, onSubmitted = null, onPublishProgress = null, onPublishFinished = null } = {}) => {
    const report = (value) => {
      commitPublishResult(out, key, value);
      onProgress?.(value);
      onPublishProgress?.({ key, platform: pid, connectionId, account: connById[connectionId]?.account_name || NAMES[pid] || 'account', ...value });
    };
    report({ state: 'uploading', progress: 5, message: 'Preparing post…' });
    let submissionSettled = false;
    let acceptedJob = false;
    let completionReported = false;
    const finishAcceptedJob = (succeeded) => {
      if (!acceptedJob || completionReported) return;
      completionReported = true;
      onPublishFinished?.({ accepted: true, succeeded, platform: pid, connectionId });
    };
    const markSubmitted = (accepted) => {
      if (submissionSettled) return;
      submissionSettled = true;
      acceptedJob = accepted;
      onSubmitted?.({ accepted, platform: pid, connectionId });
    };
    let res; let data; let refreshedToken;
    try {
      ({ res, data, refreshedToken } = await withPublishSlot(async () => {
        const form = await buildForm(pid, { connectionId, skipCrossPost, mediaOverride });
        if (connectionId) form.set('connection_id', connectionId);
        const hasPre = form.has('hasPreuploadedMedia');
        return fetchWithAuth(`${apiUrl}/api/publish`, session.access_token, {
          method: 'POST',
          body: form,
          // Limit simultaneous browser uploads, then let every accepted job
          // poll independently while the server's bounded worker queue runs.
          onUploadProgress: (f) => {
            const pct = Math.round(1 + f * 14);
            report({ ...(out[key] || {}), state: 'uploading', progress: pct, message: hasPre ? `Preparing media… ${pct}%` : `Uploading ${pct}%…` });
          },
        });
      }));
      if (!res.ok) {
        markSubmitted(false);
        throw new Error(data.error || 'Publish failed');
      }
      if (!data?.job?.id) {
        markSubmitted(false);
        throw new Error('The server accepted the upload but did not return a publish job ID. Check History before retrying.');
      }
      markSubmitted(true);
    } catch (error) {
      markSubmitted(false);
      throw error;
    }
    const pollToken = refreshedToken || session.access_token;
    const jobId = data.job.id;
    // A stuck job must never lock the card forever — but big videos need
    // real time (upload + platform processing), so video posts get 12
    // minutes instead of 5 before failing visibly.
    // Match the server's four-hour watchdog because a large batch can queue.
    const pollCap = 4 * 60 * 60 * 1000;
    const t0 = Date.now();
    let pollFailures = 0;
    let pollDelay = 3000;
    for (;;) {
      if (Date.now() - t0 > pollCap) {
        finishAcceptedJob(false);
        throw new Error('Publish timed out — check History, it may still have posted.');
      }
      await new Promise((r) => setTimeout(r, pollDelay));
      let j;
      try {
        j = await api(`/api/jobs/${jobId}`, pollToken);
        pollFailures = 0;
      } catch (error) {
        // The publish request has already been accepted. A transient Render
        // 503 can drop CORS headers from status polls, so reconnect to this job
        // instead of marking a post that may be live as failed or reposting it.
        const temporary = [429, 502, 503, 504].includes(error?.status)
          || /server is unreachable|server is waking up|retrying shortly|failed to fetch|network request failed|load failed/i.test(error?.message || '');
        if (!temporary) {
          finishAcceptedJob(false);
          throw error;
        }
        pollFailures += 1;
        const pause = Math.max(3000, Math.min(60000, error?.retryAfterMs || 1500 * (2 ** Math.min(pollFailures, 5))));
        await new Promise((r) => setTimeout(r, pause));
        continue;
      }
      const jobProgress = Number(j.job.progress);
      report({ state: j.job.state, progress: Number.isFinite(jobProgress) ? jobProgress : 50, url: j.job.url, message: j.job.message });
      // Queued jobs share the API polling budget; check them less often until
      // a worker starts, then return to responsive three-second progress.
      pollDelay = j.job.state === 'queued' ? 20000 : 3000;
      if (j.job.state === 'completed') {
        finishAcceptedJob(true);
        logPost({ platform: pid, text: mainText(pid), url: j.job.url, postId: j.job.postId, connectionId: j.job.connectionId || connectionId, publishedPosts: j.job.publishedPosts });
        return j.job.url;
      }
      if (j.job.state === 'failed') {
        finishAcceptedJob(false);
        throw new Error(j.job.message);
      }
    }
  };

  // Single-account path (brand / platform flows): unchanged behaviour.
  const runOne = async (pid, out, { key = null, skipCrossPost = false, mediaOverride = null, onSubmitted = null, onPublishProgress = null, onPublishFinished = null } = {}) => {
    const url = await runToAccount(pid, accountFor(pid), out, key || pid, { skipCrossPost, mediaOverride, onSubmitted, onPublishProgress, onPublishFinished });
    onReviewed(pid);
    return url;
  };

  // Group path: the same content goes to EVERY member account on the
  // platform — plus every mirrored (greyed-out) platform's members, each a
  // direct post with mirrors stripped so nothing double-posts. Per-account
  // links land in results[pid].urls.
  const runGroup = async (pid, out, { mediaOverride = null, onSubmitted = null, onPublishProgress = null, onPublishFinished = null } = {}) => {
    const cov = coveredPids(pid);
    const plan = [...new Set(cov.flatMap((q) => groupMemberIds(q)))].map((id) => ({ q: connById[id]?.platform, id }))
      .filter(({ q }) => q);
    const names = plan.map(({ q, id }) => connById[id]?.account_name || NAMES[q] || 'account');
    const accountResults = new Array(plan.length);
    const accountProgress = new Array(plan.length);
    const publishAccount = async (target, i) => {
        try {
          const url = await runToAccount(target.q, target.id, out, `${pid}:${target.id}`, {
            skipCrossPost: true,
            mediaOverride,
            onSubmitted,
            onPublishProgress,
            onPublishFinished,
            onProgress: (status) => {
              accountProgress[i] = status;
              const completed = accountResults.filter(Boolean).length;
              const weightedProgress = accountProgress.reduce((sum, item, index) => {
                if (accountResults[index]) return sum + 100;
                return sum + Math.max(0, Number(item?.progress) || 0);
              }, 0);
              const current = accountProgress[i];
              commitPublishResult(out, pid, {
                state: current?.state === 'uploading' ? 'uploading' : 'publishing',
                progress: Math.max(3, Math.min(95, Math.round(weightedProgress / plan.length))),
                message: `${completed}/${plan.length} accounts complete · ${names[i]}: ${current?.message || 'Publishing…'}`,
              });
            },
          });
          accountResults[i] = { account: names[i], url };
          accountProgress[i] = { state: 'completed', progress: 100, message: 'Posted' };
          const completed = accountResults.filter(Boolean).length;
          const weightedProgress = accountProgress.reduce((sum, item) => sum + (Number(item?.progress) || 0), 0);
          commitPublishResult(out, pid, {
            state: completed === plan.length ? 'publishing' : 'publishing',
            progress: Math.max(3, Math.min(99, Math.round(weightedProgress / plan.length))),
            message: `${completed}/${plan.length} accounts posted · ${completed < plan.length ? 'continuing…' : 'finalizing…'}`,
          });
        } catch (e) {
          accountResults[i] = { account: names[i], error: e.message || 'failed' };
          accountProgress[i] = { state: 'failed', progress: 100, message: 'Failed' };
          const completed = accountResults.filter(Boolean).length;
          commitPublishResult(out, pid, {
            state: 'publishing',
            progress: Math.max(3, Math.min(99, Math.round(accountProgress.reduce((sum, item) => sum + (Number(item?.progress) || 0), 0) / plan.length))),
            message: `${completed}/${plan.length} accounts finished · continuing…`,
          });
        }
    };
    // Submit every account immediately. The per-request upload semaphore above
    // bounds browser work, while all accepted jobs poll independently; the
    // server's own worker queue limits actual provider publishing concurrency.
    await Promise.all(plan.map((target, i) => publishAccount(target, i)));
    const urls = accountResults.filter((item) => item.url).map(({ account, url }) => ({ account, url }));
    const failures = accountResults.filter((item) => item.error).map(({ account, error }) => `${account}: ${error}`);
    if (!plan.length) throw new Error('No accounts to post to.');
    if (!urls.length) {
      commitPublishResult(out, pid, { state: 'failed', message: failures.join(' · ') || 'Publish failed' });
      throw new Error(out[pid].message);
    }
    // Partial success is NOT completed: Publish All and the success banner
    // only fire when every account posted, so a missed account can be
    // retried instead of silently celebrated.
    const partial = failures.length > 0;
    const total = plan.length;
    commitPublishResult(out, pid, {
      state: partial ? 'failed' : 'completed',
      urls,
      url: urls[0]?.url,
      partial,
      failures,
      message: partial
        ? `Posted to ${urls.length}/${total} — failed: ${failures.join(' · ')}`
        : (total > 1 ? `Posted to ${total} accounts ✓` : ''),
    });
    if (!partial) onReviewed(pid);
    return urls;
  };

  const publishOne = async (pid) => {
    if (busy[pid] || greyed(pid) || !claim(`post:${pid}`)) return;
    if (isGroupFlow && !groupMemberIds(pid).length) { release(`post:${pid}`); return; }
    if (!isGroupFlow && !accountFor(pid)) { release(`post:${pid}`); return; }
    const mirrorPid = pid === 'instagram' && mirrorTarget === 'facebook'
      ? 'facebook'
      : pid === 'facebook' && mirrorTarget === 'instagram' ? 'instagram' : '';
    if (mirrorPid && (isGroupFlow ? !groupMemberIds(mirrorPid).length : !accountFor(mirrorPid))) {
      release(`post:${pid}`);
      setResults((r) => ({ ...r, [pid]: { state: 'failed', message: `Connect or select a ${NAMES[mirrorPid]} account to receive the cross-post.` } }));
      return;
    }
    if (mirrorPid) {
      const mirrorError = mirrorErrorFor(pid);
      if (mirrorError) {
        release(`post:${pid}`);
        setResults((r) => ({ ...r, [pid]: { state: 'failed', message: `Fix the ${NAMES[mirrorPid]} cross-post first: ${mirrorError}.` } }));
        return;
      }
    }
    setBusy((b) => ({ ...b, [pid]: true }));
    const out = { ...results };
    try {
      if (isGroupFlow) await runGroup(pid, out);
      else await runOne(pid, out);
    } catch (e) {
      if (out[pid]?.state !== 'failed') {
        commitPublishResult(out, pid, { state: 'failed', message: e.message });
      }
    } finally {
      release(`post:${pid}`);
      setBusy((b) => ({ ...b, [pid]: false }));
    }
  };

  // YouTube takes a video, never a bare photo, so encode the still first and
  // publish that. The user's photos are untouched in Stage 2.
  const publishPhotoAsVideo = async (pid) => {
    if (busy[pid] || greyed(pid) || !claim(`photo:${pid}`)) return;
    if (isGroupFlow && !groupMemberIds(pid).length) { release(`photo:${pid}`); return; }
    if (!isGroupFlow && !accountFor(pid)) { release(`photo:${pid}`); return; }
    const photo = files.find((f) => f?.raw && f.type.startsWith('image/'))?.raw;
    if (!photo) { setResults((r) => ({ ...r, [pid]: { state: 'failed', message: 'No photo selected — pick one in Stage 2.' } })); release(`photo:${pid}`); return; }
    setBusy((b) => ({ ...b, [pid]: true }));
    setEncoding(true);
    const out = { ...results };
    try {
      const clip = await photoToVideo(photo);
      // buildForm/schedulePost read entry.raw — wrap the encoded File.
      const wrapped = [{ raw: clip, name: clip.name, type: clip.type }];
      if (isGroupFlow) await runGroup(pid, out, { mediaOverride: wrapped });
      else await runOne(pid, out, { mediaOverride: wrapped });
    } catch (e) {
      if (out[pid]?.state !== 'failed') {
        commitPublishResult(out, pid, { state: 'failed', message: e.message });
      }
    } finally {
      release(`photo:${pid}`);
      setBusy((b) => ({ ...b, [pid]: false }));
      setEncoding(false);
    }
  };

  const publishAll = async () => {
    const targets = effective.filter((pid) => (isGroupFlow ? groupMemberIds(pid).length > 0 : accountFor(pid)));
    setPubMsg('');
    // Never die silently: every early exit explains itself on the button bar.
    if (!targets.length) {
      setPubMsg(connsError || !connections.length
        ? 'No accounts ready — accounts are still loading or failed to load. Wait a few seconds, then retry.'
        : 'No accounts selected for these platforms — check Stage 1.');
      return;
    }
    if (targets.some((pid) => busy[pid]) || !claim('all')) {
      setPubMsg('Already posting — wait for it to finish.');
      return;
    }
    const requestCount = (pid) => isGroupFlow
      ? new Set(coveredPids(pid).flatMap((q) => groupMemberIds(q))).size
      : 1;
    const totalRequests = targets.reduce((sum, pid) => sum + requestCount(pid), 0);
    const batchId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const initialBatch = { id: batchId, accepted: 0, settled: 0, total: totalRequests, inProgress: 0, published: 0, failed: 0, accounts: {} };
    batchProgressRef.current = initialBatch;
    setBatchQueue(initialBatch);
    const updateBatch = (change) => {
      const current = batchProgressRef.current;
      if (!current || current.id !== batchId) return;
      const next = typeof change === 'function' ? change(current) : { ...current, ...change };
      batchProgressRef.current = next;
      if (!detachedPublish.current) setBatchQueue(next);
      else onBackgroundProgress?.(next);
    };
    const onSubmitted = ({ accepted, platform, connectionId }) => updateBatch((current) => ({
      ...current,
      accepted: current.accepted + (accepted ? 1 : 0),
      settled: current.settled + 1,
      inProgress: current.inProgress + (accepted ? 1 : 0),
      failed: current.failed + (accepted ? 0 : 1),
      accounts: {
        ...current.accounts,
        [`${platform}:${connectionId || platform}`]: {
          ...(current.accounts[`${platform}:${connectionId || platform}`] || {}),
          platform,
          connectionId,
          account: connById[connectionId]?.account_name || NAMES[platform] || 'account',
          state: accepted ? 'queued' : 'failed',
          progress: accepted ? 0 : 100,
          message: accepted ? 'Accepted by Driftpost' : 'Could not queue this post',
        },
      },
    }));
    const onPublishProgress = (progress) => updateBatch((current) => {
      const accountKey = `${progress.platform}:${progress.connectionId || progress.platform}`;
      return {
        ...current,
        accounts: {
          ...current.accounts,
          [accountKey]: { ...(current.accounts[accountKey] || {}), ...progress },
        },
      };
    });
    const onPublishFinished = ({ accepted, succeeded, platform, connectionId }) => {
      if (!accepted) return;
      updateBatch((current) => {
        const accountKey = `${platform}:${connectionId || platform}`;
        return {
          ...current,
          inProgress: Math.max(0, current.inProgress - 1),
          published: current.published + (succeeded ? 1 : 0),
          failed: current.failed + (succeeded ? 0 : 1),
          accounts: {
            ...current.accounts,
            [accountKey]: {
              ...(current.accounts[accountKey] || {}),
              state: succeeded ? 'completed' : 'failed',
              progress: 100,
              message: succeeded ? 'Published' : 'Publishing failed; check History',
            },
          },
        };
      });
    };
    const settleWithoutRequest = (count) => updateBatch((current) => ({
      ...current,
      settled: current.settled + count,
      failed: current.failed + count,
      accounts: {
        ...current.accounts,
        [`validation:${current.settled}`]: { account: 'Post validation', state: 'failed', progress: 100, message: 'Fix the indicated card before retrying' },
      },
    }));
    // Light every target card so the run is visible even before first progress.
    setBusy((b) => { const n = { ...b }; targets.forEach((p) => { n[p] = true; }); return n; });
    const out = { ...results };
    // YouTube takes video only: with photos attached, encode once and reuse
    // the clip for every YouTube account instead of failing each one.
    let clipWrapped = null;
    if (targets.includes('youtube') && files.length && !files.some((f) => f.type.startsWith('video/'))) {
      const photo = files.find((f) => f?.raw && f.type.startsWith('image/'))?.raw;
      if (!photo) {
        commitPublishResult(out, 'youtube', { state: 'failed', message: 'No photo selected — pick one in Stage 2.' });
      } else {
        setEncoding(true);
        try {
          const clip = await photoToVideo(photo);
          clipWrapped = [{ raw: clip, name: clip.name, type: clip.type }];
        } catch (e) {
          commitPublishResult(out, 'youtube', { state: 'failed', message: e.message });
        } finally {
          setEncoding(false);
        }
      }
    }
    try {
      await Promise.all(targets.map(async (pid) => {
        // Invalid cards fail up front with the reason on the card — never a
        // silent mid-flight failure after siblings already posted. Covered
        // (greyed-out) platforms riding along are validated too.
        const cov = coveredPids(pid);
        const bad = cov.map((q) => (q === pid ? invalidReason(q) : mirrorErrorFor(pid))).find(Boolean);
        if (bad) {
          commitPublishResult(out, pid, { state: 'failed', message: `Fix this card first: ${bad}` });
          settleWithoutRequest(requestCount(pid));
          return;
        }
        if (pid === 'youtube' && !clipWrapped && files.length && !files.some((f) => f.type.startsWith('video/'))) {
          settleWithoutRequest(requestCount(pid));
          return;
        }
        const mo = (pid === 'youtube' && clipWrapped) ? clipWrapped : undefined;
        try {
          if (isGroupFlow) await runGroup(pid, out, { mediaOverride: mo, onSubmitted, onPublishProgress, onPublishFinished });
          else await runOne(pid, out, {
            skipCrossPost: isGroupFlow || !(
              (pid === 'instagram' && mirrorTarget === 'facebook') ||
              (pid === 'facebook' && mirrorTarget === 'instagram')
            ),
            mediaOverride: mo,
            onSubmitted,
            onPublishProgress,
            onPublishFinished,
          });
        } catch (e) {
          if (out[pid]?.state !== 'failed') {
            commitPublishResult(out, pid, { state: 'failed', message: e.message });
          }
        }
      }));
      const posted = targets
        .filter((pid) => out[pid]?.state === 'completed')
        .map((pid) => ({ pid, urls: out[pid].urls || (out[pid].url ? [{ account: '', url: out[pid].url }] : []) }));
      if (posted.length && posted.length === targets.length) setSuccess(posted);
      else if (!posted.length) setPubMsg('Nothing posted — see the reason on each card.');
    } finally {
      release('all');
      setBusy((b) => { const n = { ...b }; targets.forEach((p) => { delete n[p]; }); return n; });
    }
  };

  const doSchedule = async (pid, whenIso, repeat = {}, bulkRows = [], requestApproval = false) => {
    if (schedBusy || !claim(`sched:${pid}`)) return;
    setSchedErr('');
    let scheduledCount = 0;
    let plannedCount = 0;
    // Same validity as instant Post — an unsendable payload must fail here,
    // not silently at fire time. Covered platforms ride along, validated too.
    const cov = coveredPids(pid);
    const bad = cov.map((q) => (q === pid ? invalidReason(q) : mirrorErrorFor(pid))).find(Boolean);
    if (bad) {
      release(`sched:${pid}`);
      setSchedMsg(`Fix the ${NAMES[pid]} card first: ${bad}`);
      setSchedErr(`Fix the ${NAMES[pid]} card first: ${bad}`);
      return;
    }
    setSchedBusy(true);
    setApprovalLinks([]);
    try {
      // YouTube takes video only: with photos attached, encode the still to
      // a 6s clip first (same as "post as a 6s Short") so scheduling works.
      let schedFiles = files;
      if (pid === 'youtube' && files.length && !files.some((f) => f.type.startsWith('video/'))) {
        const photo = files.find((f) => f?.raw && f.type.startsWith('image/'))?.raw;
        if (!photo) throw new Error('No photo selected — pick one in Stage 2.');
        setSchedMsg('Making video from your photo…');
        try {
          const clip = await photoToVideo(photo);
          schedFiles = [{ raw: clip, name: clip.name, type: clip.type }];
        } finally {
          setSchedMsg('');
        }
      }
      // Group flows queue one schedule per member account — including
      // mirrored (greyed-out) platforms' members, each a direct post;
      // other flows keep the single-schedule behaviour.
      const pairs = isGroupFlow
        ? cov.flatMap((q) => groupMemberIds(q).map((id) => ({ q, id })))
        : [{ q: pid, id: accountFor(pid) }];
      if (!pairs.length || pairs.some(({ id }) => !id)) throw new Error('Pick an account for that platform first.');
      const entries = bulkRows.length ? bulkRows : [{ when: whenIso, text: '' }];
      if (entries.length * pairs.length > 10) throw new Error('This batch would create more than 10 schedules. Reduce the CSV rows or schedule fewer group accounts at a time.');
      plannedCount = entries.length * pairs.length;
      if (pid === 'x' && entries.some((entry) => String(entry.text || '').length > 280)) throw new Error('X captions must be 280 characters or fewer. Shorten the CSV text and import again.');
      const prepared = [];
      const reviewLinks = [];
      for (const { q, id } of pairs) {
        const skipCrossPost = isGroupFlow || !(
          (pid === 'instagram' && mirrorTarget === 'facebook') ||
          (pid === 'facebook' && mirrorTarget === 'instagram')
        );
        const instagramFiles = q === 'facebook' && mirrorTarget === 'instagram'
          ? (await instagramMediaFiles(schedFiles)).filter((f) => f.type?.startsWith('image/'))
          : [];
        const facebookFiles = q === 'instagram' && mirrorTarget === 'facebook'
          ? (await facebookMediaFiles(schedFiles)).filter((f) => f.type?.startsWith('image/'))
          : [];
        const platformFiles = q === 'instagram'
          ? await instagramMediaFiles(schedFiles)
          : q === 'facebook' ? await facebookMediaFiles(schedFiles) : schedFiles;
        prepared.push({ q, id, skipCrossPost, instagramFiles, facebookFiles, platformFiles });
      }
      for (const entry of entries) {
        for (const item of prepared) {
          const { q, id, skipCrossPost, instagramFiles, facebookFiles, platformFiles } = item;
          const postBody = { ...bodyFor(q, { skipCrossPost }), connection_id: id };
          if (requestApproval) postBody.approval_status = 'pending';
          if (entry.text) {
            const caption = String(entry.text).trim();
            postBody.text = caption;
            if (q === 'youtube') postBody.yt_description = caption;
            else if (q === 'instagram') postBody.ig_caption = caption;
            else if (q === 'facebook') postBody.fb_message = caption;
            else if (q === 'x') postBody.x_text = caption;
          }
          const schedule = await schedulePost(session.access_token, {
            platform: q,
            connectionId: id,
            when: entry.when || whenIso,
            repeatEveryDays: repeat.repeatEveryDays || 0,
            repeatRemaining: repeat.repeatRemaining || 0,
            body: postBody,
            files: platformFiles,
            instagramFiles,
            facebookFiles,
            thumb: q === 'youtube' ? thumb : null,
            instagramCover: (q === 'instagram' || (q === 'facebook' && mirrorTarget === 'instagram')) ? coverMap.instagram : null,
            facebookCover: (q === 'facebook' || (q === 'instagram' && mirrorTarget === 'facebook')) ? coverMap.facebook : null,
          });
          if (requestApproval && schedule?.id) reviewLinks.push(`${window.location.origin}/approve/${schedule.id}`);
          scheduledCount++;
        }
      }
      setSchedOpen(false);
      setApprovalLinks(reviewLinks);
      const repeatLabel = repeat.repeatEveryDays ? `, repeating ${repeat.repeatRemaining} more times` : '';
      const whenLabel = bulkRows.length ? `${bulkRows.length} posts` : new Date(whenIso).toLocaleString();
      const batchLabel = bulkRows.length ? ` (${bulkRows.length} CSV posts)` : '';
      setResults((r) => ({ ...r, [pid]: { state: 'scheduled', message: `${whenLabel} scheduled${repeatLabel}.` } }));
      setSchedMsg(`${NAMES[pid]}${batchLabel} ${requestApproval ? 'queued for approval' : 'scheduled'}${bulkRows.length ? '' : ` for ${whenLabel}`}${repeatLabel}. Manage or cancel in History.`);
    } catch (e) {
      setSchedMsg(scheduledCount ? `Scheduled ${scheduledCount} of ${plannedCount}. ${e.message || 'The batch stopped after this error.'}` : (e.message || 'Could not schedule the post'));
      setSchedErr(scheduledCount ? `Scheduled ${scheduledCount} of ${plannedCount}. ${e.message || 'The batch stopped.'} Do not resubmit the whole batch; check History first.` : (e.message || 'Could not schedule the post'));
    } finally {
      release(`sched:${pid}`);
      setSchedBusy(false);
    }
  };

  const startNew = async () => {
    await resetPostState(session.user.id);
    onDone();
  };

  const continueInBackground = async () => {
    if (!batchQueue || batchQueue.settled < batchQueue.total || batchQueue.accepted < 1) return;
    // All accepted jobs now own their uploaded files server-side. Unmounting
    // this draft only drops its local monitor; it does not cancel the jobs.
    detachedPublish.current = true;
    await resetPostState(session.user.id);
    onDone({ backgroundPublish: batchProgressRef.current || batchQueue });
  };

  const allReviewed = effective.length > 0 && reviewedCount === effective.length;

  return (
    <div className="stage3">
      {onNavigate && <WorkspaceNav page="create" onNavigate={onNavigate} email={session.user?.email} onSignOut={onSignOut} />}
      <div className="stage3-in">
        <div className="s3-top">
          <button type="button" className="s3-back" onClick={onBack}>← Stage 2</button>
        </div>
        <header className="s3-head">
          <span className="s3-badge">Stage 3 of 3</span>
          <h1>Review &amp; Finalize Your Content</h1>
          <p>Review your platform content before publishing.</p>
        </header>
        <ProgressStepper current={3} />
        {connsError && !connections.length && (
          <div className="s3-work">
            <p className="s3-err" style={{ margin: 0 }}>{connsError} Nothing can post until accounts load.</p>
            <div className="s3-acts"><button type="button" onClick={() => setConnsTick((t) => t + 1)}>Retry loading accounts</button></div>
          </div>
        )}

        {!platforms.length ? (
          <div className="s3-work">
            <p className="s3-err" style={{ margin: 0 }}>No platforms from Stage 1 — go back and finish the earlier stages first.</p>
            <div className="s3-acts"><button type="button" onClick={onBack}>← Back to Stage 2</button></div>
          </div>
        ) : success ? (
          <div className="s3-done">
            <h2>Posted everywhere ✓</h2>
            <p>Every selected platform is live. The workspace is still here if you want to check — start fresh whenever.</p>
            <div className="s3-done-links">
              {success.map((s) => (
                <span key={s.pid}>{NAMES[s.pid]}{' '}
                  {(s.urls || []).filter((u) => u.url).length > 1
                    ? s.urls.filter((u) => u.url).map((u, i) => (
                      <span key={i}>{u.account ? `${u.account} ` : ''}<a href={u.url} target="_blank" rel="noreferrer">· View post</a>{i < s.urls.filter((u) => u.url).length - 1 ? ' ' : ''}</span>
                    ))
                    : s.urls?.[0]?.url
                      ? <a href={s.urls[0].url} target="_blank" rel="noreferrer">· View post</a>
                      : '· posted'}
                </span>
              ))}
            </div>
            <button type="button" className="s3-new" onClick={startNew}>Start new post →</button>
          </div>
        ) : (
          <>
            <PlatformTabs platforms={platforms} tab={tab} setTab={setTab} statusOf={statusOf} greyed={greyed} />
            {tab && (
              <div key={tab} className="s3-cols" style={{ marginTop: 14 }}>
                <div><MediaPreview files={files} /><EpidemicCatalog token={session.access_token} files={files} onApply={onMusicApplied} /></div>
                <Workspace
                  pid={tab}
                  accounts={accountsFor(tab)}
                  accountId={accountFor(tab)}
                  onAccount={onAccount}
                  // Group flows post to every member account: show the fixed
                  // member list instead of a single-account dropdown. Covered
                  // (greyed-out) platforms' members ride along, labelled.
                  accountList={isGroupFlow ? [...accountsFor(tab).map((c) => c.account_name), ...coveredPids(tab).filter((q) => q !== tab).flatMap((q) => accountsFor(q).map((c) => `${c.account_name} (${NAMES[q]})`))] : null}
                  values={outputs[tab] || {}}
                  onValues={onValues}
                  cfg={cfgFor(tab)}
                  onCfg={onCfg}
                  files={files}
                  thumb={tab === 'youtube' ? thumb : coverMap[tab]}
                  onThumb={tab === 'youtube'
                    ? onThumb
                    : (cover) => onPlatformCover(tab, cover)}
                  instagramAccounts={connections.filter((connection) => connection.platform === 'instagram')}
                  instagramLookupId={instagramLookupId}
                  token={session.access_token}
                  mirrorPlatform={tab === 'instagram' && mirrorTarget === 'facebook' ? 'facebook' : tab === 'facebook' && mirrorTarget === 'instagram' ? 'instagram' : ''}
                  mirrorCover={tab === 'instagram' && mirrorTarget === 'facebook' ? coverMap.facebook : tab === 'facebook' && mirrorTarget === 'instagram' ? coverMap.instagram : null}
                  onMirrorCover={(cover) => onPlatformCover(tab === 'instagram' ? 'facebook' : 'instagram', cover)}
                  greyed={greyed(tab)}
                  greyReason={greyReason(tab)}
                  reviewed={!!reviewed[tab]}
                  onReviewed={onReviewed}
                  result={results[tab]}
                  posting={!!busy[tab]}
                  regenning={regen === tab}
                  regenBusy={!!regen || Object.values(busy).some(Boolean)}
                  onPost={publishOne}
                  onPostPhotoAsVideo={publishPhotoAsVideo}
                  encoding={encoding}
                  hideInstagramCrosspost={!!s1.crosspost}
                  showInstagramCollaborators={tab === 'facebook' && mirrorTarget === 'instagram'}
                  instagramCollaborators={cfgFor('instagram').collabs || ''}
                  onInstagramCollaborators={(value) => onCfg('instagram', { collabs: value })}
                  onRegen={canUseAi ? regenOne : undefined}
                  onSchedule={(pid) => { setTab(pid); setSchedOpen(true); }}
                />
              </div>
            )}
            <div className="s3-pub">
              <div className="s3-pub-row">
                <div className="s3-pub-track"><i style={{ width: `${effective.length ? (reviewedCount / effective.length) * 100 : 0}%` }} /></div>
                <span className="s3-pub-count">{reviewedCount}/{effective.length} reviewed</span>
              </div>
              <button
                type="button"
                className="s3-postall"
                onClick={publishAll}
                disabled={!effective.length || !allReviewed || Object.values(busy).some(Boolean)}
                title={!allReviewed ? 'Click Reviewed on every platform first' : 'Post to all reviewed platforms'}
              >
                {!effective.length ? 'Nothing to post' : allReviewed ? `Post to all (${effective.map((p) => NAMES[p]).join(', ')})` : `Review remaining platforms (${reviewedCount}/${effective.length})`}
              </button>
              <button
                type="button"
                className="s3-schedall"
                onClick={() => setSchedOpen(true)}
                disabled={!effective.length || !allReviewed || Object.values(busy).some(Boolean)}
                title="Queue this post to publish automatically"
              >
                Schedule instead
              </button>
              {schedMsg && <p className="s3-bar-msg">{schedMsg}</p>}
              {!!approvalLinks.length && <div className="s3-review-links"><b>Share review link{approvalLinks.length === 1 ? '' : 's'}:</b>{approvalLinks.map((link, i) => <a key={link} href={link} target="_blank" rel="noreferrer">{approvalLinks.length === 1 ? link : `Review post ${i + 1}`}</a>)}</div>}
              {pubMsg && <p className="s3-bar-msg">{pubMsg}</p>}
              {batchQueue && <p className="s3-bar-msg" role="status">{batchQueue.accepted} of {batchQueue.total} account posts accepted into the background queue.</p>}
              {batchQueue && batchQueue.settled >= batchQueue.total && batchQueue.accepted > 0 && (
                <button type="button" className="s3-continue-bg" onClick={continueInBackground}>
                  Continue in background · start a new post →
                </button>
              )}
              {!allReviewed && effective.length > 0 && !schedMsg && !pubMsg && (
                <p className="s3-pub-hint">Open each tab and press Reviewed ✓ — posting unlocks when all are seen.</p>
              )}
            </div>
          </>
        )}
      </div>
      {schedOpen && (
        <ScheduleModal
          platforms={effective}
          platform={tab}
          accountFor={accountFor}
          invalidFor={invalidReason}
          busy={schedBusy}
          serverError={schedErr}
          onClose={() => setSchedOpen(false)}
          onSchedule={doSchedule}
        />
      )}
    </div>
  );
}
