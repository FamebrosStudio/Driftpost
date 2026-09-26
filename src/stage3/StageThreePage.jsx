import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { api, apiUrl, groupBrands, PLATFORMS, resetPostState, schedulePost, fetchWithAuth } from '../lib.js';
import { readVault, writeVault, vaultFiles } from '../stage2/mediaVault.js';
import { requestCaptions, mapResponse, approveCaption } from '../stage2/ai.js';
import { composeOutput } from '../stage2/PlatformOutputCard.jsx';
import { photoToVideo } from './photoVideo.js';
import { logCaptions, logPost } from '../history/log.js';
import ProgressStepper from './ProgressStepper.jsx';
import PlatformTabs from './PlatformTabs.jsx';
import Workspace from './Workspace.jsx';
import MediaPreview from './MediaPreview.jsx';
import ScheduleModal from './ScheduleModal.jsx';
import './stage3.css';

function load(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ?? fallback;
  } catch { return fallback; }
}
function save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

const DEFAULT_CFG = {
  instagram: { size: 'portrait', shareFb: false, story: false, alt: '', topics: '', partner: '', collabs: '' },
  facebook: { link: '', syndIg: false, cta: '', age: '' },
  youtube: { privacy: 'private', category: '', kids: '' },
  x: { pollOn: false, opts: ['', '', '', ''], mins: '1440', reply: 'everyone' },
};
const NAMES = { instagram: 'Instagram', facebook: 'Facebook', youtube: 'YouTube', x: 'X' };

export default function StageThreePage({ session, onBack, onSignOut, onHistory, onDone }) {
  const [connections, setConnections] = useState([]);
  const [files, setFiles] = useState([]);
  const [thumb, setThumb] = useState(null);
  const [outputs, setOutputs] = useState(() => load('driftpost-stage2-outputs', {}));
  const [cfg, setCfg] = useState(() => load('driftpost-stage3-cfg', {}));
  const [overrides, setOverrides] = useState(() => load('driftpost-stage3-accounts', {}));
  const [reviewed, setReviewed] = useState(() => load('driftpost-stage3-reviewed', {}));
  const [tab, setTab] = useState('');
  const [results, setResults] = useState({});
  const [busy, setBusy] = useState({});
  const [regen, setRegen] = useState('');
  const [brief] = useState(() => load('driftpost-stage2-brief', ''));
  const [success, setSuccess] = useState(null);
  const [schedOpen, setSchedOpen] = useState(false);
  const [schedBusy, setSchedBusy] = useState(false);
  const [encoding, setEncoding] = useState(false);
  const [schedMsg, setSchedMsg] = useState('');
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
    })();
  }, [mediaKey]);

  // Stage 1 + 2 context drives everything.
  const s1 = useMemo(() => ({
    type: load('driftpost-stage1-type', ''),
    brandKey: load('driftpost-stage1-brand', ''),
    platforms: load('driftpost-stage1-platforms', []),
    groups: load('driftpost-groups', []),
    groupId: load('driftpost-stage1-group', ''),
    crosspost: load('driftpost-stage2-crosspost', false),
    tone: load('driftpost-stage2-tone', 'auto'),
    emoji: load('driftpost-stage2-emoji', 'medium'),
    length: load('driftpost-stage2-length', 'medium'),
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
      return g?.accountIds || [];
    }
    if (s1.type === 'create_groups') return (s1.groups || []).flatMap((g) => g.accountIds || []);
    return [];
  }, [s1]);
  // Member account ids on one platform, in group order.
  const groupMemberIds = (pid) => groupIds.filter((id) => connById[id]?.platform === pid);

  // Stage 2 cross-post already routes Facebook through Instagram — except in
  // group flows, where every member account gets its own direct post (a
  // mirror would only reach one Facebook account and the rest would be
  // missed, or double-post where direct posts also run).
  const platforms = (s1.crosspost && !isGroupFlow && basePlatforms.includes('instagram') && basePlatforms.includes('facebook'))
    ? basePlatforms.filter((pid) => pid !== 'facebook')
    : basePlatforms;
  const brandLabel = s1.type === 'common_brand' ? brand?.label || '' : '';

  useEffect(() => {
    if (!platforms.includes(tab)) setTab(platforms[0] || '');
  }, [platforms, tab]);

  const cfgFor = (pid) => ({ ...(DEFAULT_CFG[pid] || {}), ...(cfg[pid] || {}) });
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
    const o = overrides[pid];
    if (o && connById[o]?.platform === pid) return o;
    if (s1.type === 'common_brand' && brand?.map?.[pid] && connById[brand.map[pid]]) return brand.map[pid];
    return connections.find((c) => c.platform === pid)?.id || '';
  };

  // Cross-post mutual exclusion: posting IG→FB and FB→IG together would
  // double-post, so the other side greys out and leaves publish-all.
  // In group flows the greyed tab is COVERED: group fan-out posts its
  // member accounts directly (mirrors stripped), so nothing is skipped.
  const greyed = (pid) => {
    if (pid === 'facebook' && platforms.includes('instagram') && cfgFor('instagram').shareFb) return true;
    if (pid === 'instagram' && platforms.includes('facebook') && cfgFor('facebook').syndIg) return true;
    return false;
  };
  // Platforms one Post button covers: itself + a mirrored platform whose
  // tab is greyed out. Only IG↔FB mirrors exist.
  const coveredPids = (pid) => {
    const list = [pid];
    if (pid === 'instagram' && platforms.includes('facebook') && cfgFor('instagram').shareFb) list.push('facebook');
    if (pid === 'facebook' && platforms.includes('instagram') && cfgFor('facebook').syndIg) list.push('instagram');
    return list;
  };
  const greyReason = (pid) => (pid === 'facebook'
    ? 'Skipped — Instagram auto-shares here. Turn that off to post Facebook directly.'
    : 'Skipped — Facebook auto-shares here. Turn that off to post Instagram directly.');
  const effective = platforms.filter((pid) => !greyed(pid));

  const statusOf = (pid) => {
    const r = results[pid];
    if (r?.state === 'completed') return 'posted';
    if (r?.state === 'scheduled') return 'scheduled';
    if (r?.state === 'failed') return 'failed';
    return reviewed[pid] ? 'reviewed' : '';
  };
  const reviewedCount = effective.filter((pid) => reviewed[pid] || results[pid]?.state === 'completed').length;

  const onValues = (pid, v) => setOutputs((o) => { const n = { ...o, [pid]: v }; save('driftpost-stage2-outputs', n); return n; });
  // One card's validity, mirroring the Workspace checks — Publish All and
  // Schedule refuse invalid cards instead of failing mid-flight.
  // allowGreyed: a greyed-out card is still validated when another card's
  // mirror covers it (its members get direct posts).
  const invalidReason = (pid, { allowGreyed = false } = {}) => {
    const v = outputs[pid] || {};
    const c = cfgFor(pid);
    if (!allowGreyed && greyed(pid)) return 'skipped by cross-post — turn the mirror off to post it directly';
    if (isGroupFlow ? !groupMemberIds(pid).length : !accountFor(pid)) return 'no account — pick one first';
    if (pid === 'x') {
      if (Array.from(v.text || '').length > 280) return 'too long — shorten to 280 characters';
      if (c.pollOn && files.length > 0) return 'polls can’t carry photos — remove media in Stage 2';
      if (c.pollOn && !(c.opts?.[0]?.trim() && c.opts?.[1]?.trim())) return 'a poll needs at least 2 answers';
    }
    if (pid === 'facebook' && c.cta && !c.link?.trim()) return 'a button needs a website link above';
    return '';
  };
  const onCfg = (pid, patch) => setCfg((c) => { const n = { ...c, [pid]: { ...cfgFor(pid), ...patch } }; save('driftpost-stage3-cfg', n); return n; });
  const onAccount = (pid, id) => setOverrides((o) => { const n = { ...o, [pid]: id }; save('driftpost-stage3-accounts', n); return n; });
  const onThumb = (t) => {
    setThumb(t);
    (async () => {
      const prev = await readVault(mediaKey);
      writeVault(mediaKey, {
        files: (prev?.files || []),
        thumb: t?.raw instanceof Blob ? { name: t.name, blob: t.raw } : null,
      });
    })();
  };
  // Reviewing a card is the approval signal: the server keeps this caption as a
  // reference so the next generation for the same brand writes closer to it.
  const onReviewed = (pid) => {
    approveCaption(session.access_token, { brand: brandLabel, platform: pid });
    setReviewed((r) => { const n = { ...r, [pid]: true }; save('driftpost-stage3-reviewed', n); return n; });
  };

  const regenOne = async (pid) => {
    if (busy[pid] || regen || !brief.trim()) return;
    setRegen(pid);
    try {
      const data = await requestCaptions(session.access_token, {
        brief, brand: brandLabel, files,
        tone: s1.tone, emoji: s1.emoji, length: s1.length,
        only: pid,
      });
      const mapped = mapResponse(data);
      onValues(pid, mapped[pid]);
      logCaptions({ brand: brandLabel, entries: [{ platform: pid, text: composeOutput(pid, mapped[pid]) }] });
    } catch {}
    setRegen('');
  };

  const mainText = (pid) => {
    const v = outputs[pid] || {};
    if (pid === 'instagram') return v.caption || brief;
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
      ig_caption: v.caption || '',
      ig_size: 'portrait',
      ig_share_fb: ((s1.crosspost || c.shareFb) && pid === 'instagram') ? '1' : '',
      ig_post_story: c.story ? '1' : '',
      ig_alt: c.alt || '',
      ig_topics: c.topics || '',
      ig_partner: c.partner || '',
      ig_collabs: c.collabs || '',
      fb_connection_id: accountFor('facebook'),
      fb_message: (outputs.facebook || {}).message || '',
      fb_link: c.link || '',
      fb_synd_ig: (pid === 'facebook' && c.syndIg) ? '1' : '',
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

  const buildForm = (pid, { connectionId = null, skipCrossPost = false, mediaOverride = null } = {}) => {
    const body = bodyFor(pid, { skipCrossPost });
    if (connectionId) body.connection_id = connectionId;
    const form = new FormData();
    for (const [k, v] of Object.entries(body)) form.append(k, v);
    // mediaOverride replaces the selected files (used for photo -> video).
    const media = mediaOverride || files;
    for (const f of media.slice(0, 10)) { if (f?.raw) form.append('media', f.raw); }
    if (pid === 'youtube' && thumb?.raw) form.append('thumbnail', thumb.raw);
    return form;
  };

  // Post to ONE connection and poll the job. Returns the post URL.
  // When connectionId is given, the form carries exactly that account.
  // The POST itself auto-refreshes a dead login token; polls inherit it.
  const runToAccount = async (pid, connectionId, out, key, { skipCrossPost = false, mediaOverride = null } = {}) => {
    out[key] = { state: 'uploading', progress: 5 };
    setResults({ ...out });
    const form = buildForm(pid, { connectionId, skipCrossPost, mediaOverride });
    if (connectionId) form.set('connection_id', connectionId);
    const { res, data, refreshedToken } = await fetchWithAuth(`${apiUrl}/api/publish`, session.access_token, {
      method: 'POST',
      body: form,
      // Upload bytes drive the live bar (first 15%); server polls take over after.
      onUploadProgress: (f) => {
        const pct = Math.round(1 + f * 14);
        out[key] = { ...(out[key] || {}), state: 'uploading', progress: pct, message: `Uploading ${pct}%…` };
        setResults({ ...out });
      },
    });
    const pollToken = refreshedToken || session.access_token;
    if (!res.ok) throw new Error(data.error || 'Publish failed');
    const jobId = data.job.id;
    // A stuck job must never lock the card forever — but big videos need
    // real time (upload + platform processing), so video posts get 12
    // minutes instead of 5 before failing visibly.
    const hasVideo = files.some((f) => f.type.startsWith('video/'));
    const pollCap = hasVideo ? 12 * 60 * 1000 : 5 * 60 * 1000;
    const t0 = Date.now();
    for (;;) {
      if (Date.now() - t0 > pollCap) throw new Error('Publish timed out — check History, it may still have posted.');
      await new Promise((r) => setTimeout(r, 1500));
      const j = await api(`/api/jobs/${jobId}`, pollToken);
      out[key] = { state: j.job.state, progress: j.job.progress || 50, url: j.job.url, message: j.job.message };
      setResults({ ...out });
      if (j.job.state === 'completed') {
        logPost({ platform: pid, text: mainText(pid), url: j.job.url });
        return j.job.url;
      }
      if (j.job.state === 'failed') throw new Error(j.job.message);
    }
  };

  // Single-account path (brand / platform flows): unchanged behaviour.
  const runOne = async (pid, out, { key = null, skipCrossPost = false, mediaOverride = null } = {}) => {
    const url = await runToAccount(pid, accountFor(pid), out, key || pid, { skipCrossPost, mediaOverride });
    onReviewed(pid);
    return url;
  };

  // Group path: the same content goes to EVERY member account on the
  // platform — plus every mirrored (greyed-out) platform's members, each a
  // direct post with mirrors stripped so nothing double-posts. Per-account
  // links land in results[pid].urls.
  const runGroup = async (pid, out, { mediaOverride = null } = {}) => {
    const cov = coveredPids(pid);
    const plan = cov.flatMap((q) => groupMemberIds(q).map((id) => ({ q, id })));
    const names = plan.map(({ q, id }) => connById[id]?.account_name || NAMES[q] || 'account');
    const urls = [];
    const failures = [];
    for (let i = 0; i < plan.length; i++) {
      if (plan.length > 1) {
        out[pid] = { ...(out[pid] || {}), state: 'uploading', progress: 5, message: `Posting ${i + 1}/${plan.length}…` };
        setResults({ ...out });
      }
      try {
        const url = await runToAccount(plan[i].q, plan[i].id, out, pid, { skipCrossPost: true, mediaOverride });
        urls.push({ account: names[i], url });
      } catch (e) {
        failures.push(`${names[i]}: ${e.message || 'failed'}`);
      }
    }
    if (!plan.length) throw new Error('No accounts to post to.');
    if (!urls.length) {
      out[pid] = { state: 'failed', message: failures.join(' · ') || 'Publish failed' };
      setResults({ ...out });
      throw new Error(out[pid].message);
    }
    // Partial success is NOT completed: Publish All and the success banner
    // only fire when every account posted, so a missed account can be
    // retried instead of silently celebrated.
    const partial = failures.length > 0;
    const total = plan.length;
    out[pid] = {
      state: partial ? 'failed' : 'completed',
      urls,
      url: urls[0]?.url,
      partial,
      failures,
      message: partial
        ? `Posted to ${urls.length}/${total} — failed: ${failures.join(' · ')}`
        : (total > 1 ? `Posted to ${total} accounts ✓` : ''),
    };
    setResults({ ...out });
    if (!partial) onReviewed(pid);
    return urls;
  };

  const publishOne = async (pid) => {
    if (busy[pid] || greyed(pid) || !claim(`post:${pid}`)) return;
    if (isGroupFlow && !groupMemberIds(pid).length) { release(`post:${pid}`); return; }
    if (!isGroupFlow && !accountFor(pid)) { release(`post:${pid}`); return; }
    // A covered (greyed-out) platform rides along — refuse if ITS card is broken too.
    if (isGroupFlow) {
      const badCov = coveredPids(pid).filter((q) => q !== pid)
        .map((q) => invalidReason(q, { allowGreyed: true })).find(Boolean);
      if (badCov) {
        release(`post:${pid}`);
        setResults((r) => ({ ...r, [pid]: { state: 'failed', message: `Fix the covered card first: ${badCov}` } }));
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
        out[pid] = { state: 'failed', message: e.message };
        setResults({ ...out });
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
        out[pid] = { state: 'failed', message: e.message };
        setResults({ ...out });
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
    // Light every target card so the run is visible even before first progress.
    setBusy((b) => { const n = { ...b }; targets.forEach((p) => { n[p] = true; }); return n; });
    const out = { ...results };
    // Direct posts only (mirrors stripped) — unless global cross-post routes
    // Facebook through Instagram, which must keep its share flag. Group
    // flows always strip: every member gets a direct post.
    const strip = !(s1.crosspost && !isGroupFlow && targets.includes('instagram'));
    // YouTube takes video only: with photos attached, encode once and reuse
    // the clip for every YouTube account instead of failing each one.
    let clipWrapped = null;
    if (targets.includes('youtube') && files.length && !files.some((f) => f.type.startsWith('video/'))) {
      const photo = files.find((f) => f?.raw && f.type.startsWith('image/'))?.raw;
      if (!photo) {
        out.youtube = { state: 'failed', message: 'No photo selected — pick one in Stage 2.' };
        setResults({ ...out });
      } else {
        setEncoding(true);
        try {
          const clip = await photoToVideo(photo);
          clipWrapped = [{ raw: clip, name: clip.name, type: clip.type }];
        } catch (e) {
          out.youtube = { state: 'failed', message: e.message };
          setResults({ ...out });
        } finally {
          setEncoding(false);
        }
      }
    }
    try {
      for (const pid of targets) {
        // Invalid cards fail up front with the reason on the card — never a
        // silent mid-flight failure after siblings already posted. Covered
        // (greyed-out) platforms riding along are validated too.
        const cov = isGroupFlow ? coveredPids(pid) : [pid];
        const bad = cov.map((q) => (q === pid ? invalidReason(q) : invalidReason(q, { allowGreyed: true }))).find(Boolean);
        if (bad) {
          out[pid] = { state: 'failed', message: `Fix this card first: ${bad}` };
          setResults({ ...out });
          continue;
        }
        if (pid === 'youtube' && !clipWrapped && files.length && !files.some((f) => f.type.startsWith('video/'))) continue;
        const mo = (pid === 'youtube' && clipWrapped) ? clipWrapped : undefined;
        try {
          if (isGroupFlow) await runGroup(pid, out, { mediaOverride: mo });
          else await runOne(pid, out, { skipCrossPost: strip, mediaOverride: mo });
        } catch (e) {
          if (out[pid]?.state !== 'failed') {
            out[pid] = { state: 'failed', message: e.message };
            setResults({ ...out });
          }
        }
      }
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

  const doSchedule = async (pid, whenIso) => {
    if (schedBusy || !claim(`sched:${pid}`)) return;
    // Same validity as instant Post — an unsendable payload must fail here,
    // not silently at fire time. Covered platforms ride along, validated too.
    const cov = isGroupFlow ? coveredPids(pid) : [pid];
    const bad = cov.map((q) => (q === pid ? invalidReason(q) : invalidReason(q, { allowGreyed: true }))).find(Boolean);
    if (bad) {
      release(`sched:${pid}`);
      setSchedMsg(`Fix the ${NAMES[pid]} card first: ${bad}`);
      return;
    }
    setSchedBusy(true);
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
      const when = new Date(whenIso).toLocaleString();
      for (const { q, id } of pairs) {
        const strip = isGroupFlow ? true : !(s1.crosspost && pid === 'instagram');
        await schedulePost(session.access_token, {
          platform: q,
          connectionId: id,
          when: whenIso,
          body: { ...bodyFor(q, { skipCrossPost: strip }), connection_id: id },
          files: schedFiles,
          thumb: q === 'youtube' ? thumb : null,
        });
      }
      setSchedOpen(false);
      setResults((r) => ({ ...r, [pid]: { state: 'scheduled', message: pairs.length > 1 ? `Scheduled — ${pairs.length} accounts publish automatically.` : 'Scheduled — it will publish automatically.' } }));
      setSchedMsg(pairs.length > 1
        ? `${NAMES[pid]} ×${pairs.length} scheduled for ${when}. Manage or cancel in History.`
        : `${NAMES[pid]} scheduled for ${when}. Manage or cancel it in History.`);
    } catch (e) {
      setSchedMsg(e.message || 'Could not schedule the post');
    } finally {
      release(`sched:${pid}`);
      setSchedBusy(false);
    }
  };

  const startNew = async () => {
    await resetPostState(session.user.id);
    onDone();
  };

  const allReviewed = effective.length > 0 && reviewedCount === effective.length;

  return (
    <div className="stage3">
      <div className="stage3-in">
        <div className="s3-top">
          <button type="button" className="s3-back" onClick={onBack}>← Stage 2</button>
          <span className="s3-top-right">
            <button type="button" className="s3-signout" onClick={onHistory}>History</button>
            <button type="button" className="s3-signout" onClick={onSignOut}>Sign out</button>
          </span>
        </div>
        <header className="s3-head">
          <span className="s3-badge">Stage 3 of 3</span>
          <h1>Review &amp; Finalize Your Content</h1>
          <p>Your AI-generated content is ready. Review each platform before publishing.</p>
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
                <div><MediaPreview files={files} /></div>
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
                  thumb={thumb}
                  onThumb={onThumb}
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
                  onRegen={regenOne}
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
              {pubMsg && <p className="s3-bar-msg">{pubMsg}</p>}
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
          onClose={() => setSchedOpen(false)}
          onSchedule={doSchedule}
        />
      )}
    </div>
  );
}
