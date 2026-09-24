import React, { useEffect, useMemo, useRef, useState } from 'react';
import { apiUrl, api, PLATFORMS, isActiveBrand, groupBrands, TRIO_BRANDS, findTrioBrands } from './lib.js';
import BrandIcon from './brand.jsx';
import { getSupabase } from './session.js';

// --- Tiny IndexedDB media vault (localStorage can't hold binary) ---
// Survives refresh: attached photos/video + YouTube cover are restored
// byte-for-byte after reload. Per-user keys, same-origin only.
function idbOpen() {
  return new Promise((resolve, reject) => {
    try {
      const req = indexedDB.open('driftpost', 1);
      req.onupgradeneeded = () => { req.result.createObjectStore('media'); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (e) { reject(e); }
  });
}
async function idbSet(key, value) {
  try {
    const db = await idbOpen();
    await new Promise((res, rej) => {
      const tx = db.transaction('media', 'readwrite');
      tx.objectStore('media').put(value, key);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
    db.close();
  } catch {}
}
async function idbGet(key) {
  try {
    const db = await idbOpen();
    const value = await new Promise((res, rej) => {
      const tx = db.transaction('media', 'readonly');
      const rq = tx.objectStore('media').get(key);
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
    db.close();
    return value ?? null;
  } catch { return null; }
}

const THEMES = [
  { id: 'auto', label: 'Auto (follows PC)' },
  { id: 'dark', label: 'Black' },
  { id: 'light', label: 'White' },
];

function useTheme() {
  const [mode, setMode] = useState(() => {
    const s = localStorage.getItem('driftpost-theme');
    return ['auto', 'light', 'dark'].includes(s) ? s : 'auto';
  });
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const apply = () => {
      const eff = mode === 'auto' ? (mq.matches ? 'light' : 'dark') : mode;
      document.documentElement.dataset.theme = eff;
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', eff === 'light' ? '#ffffff' : '#000000');
    };
    apply();
    mq.addEventListener?.('change', apply);
    try { localStorage.setItem('driftpost-theme', mode); } catch {}
    return () => mq.removeEventListener?.('change', apply);
  }, [mode]);
  return [mode, setMode];
}

function useLocalSet(key) {
  const [set, setSet] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(key) || '[]')); }
    catch { return new Set(); }
  });
  const save = (next) => { setSet(next); localStorage.setItem(key, JSON.stringify([...next])); };
  const add = (id) => save(new Set([...set, id]));
  const remove = (id) => { const n = new Set(set); n.delete(id); save(n); };
  return [set, add, remove];
}

const isEffectiveActive = (conn, manual) => manual.has(conn.id) || isActiveBrand(conn.account_name);

function DotsMenu({ active, hidden, onToggleActive, onToggleHidden }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="dots">
      <button className="mini" onClick={() => setOpen((o) => !o)}>⋯</button>
      {open && <>
        <span className="dd-backdrop" onClick={() => setOpen(false)} />
        <span className="dots-menu">
          <button onClick={() => { onToggleActive(); setOpen(false); }}>{active ? '★ Unmark Active' : '☆ Mark Active'}</button>
          <button onClick={() => { onToggleHidden(); setOpen(false); }}>{hidden ? 'Unhide' : 'Hide'}</button>
        </span>
      </>}
    </span>
  );
}

function BrandPicker({ brands, brandKey, onPick, isActive }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const current = brands.find((b) => b.key === brandKey);
  const list = brands.filter((b) => !q.trim() || b.label.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className={open ? 'dd open' : 'dd'}>
      <button className="dd-btn" onClick={() => setOpen((o) => !o)}>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{current ? current.label : 'Pick a brand…'}</span>
        <small>{brands.length} brands</small>
        <span className="chev">▾</span>
      </button>
      {open && <>
        <div className="dd-backdrop" onClick={() => setOpen(false)} />
        <div className="dd-menu">
          <input className="dd-search" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type to filter…" />
          {list.map((b) => (
            <button key={b.key} className={b.key === brandKey ? 'dd-item sel' : 'dd-item'} onClick={() => { onPick(b.key); setOpen(false); setQ(''); }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.label}</span>
              {(isActive ? isActive(b) : isActiveBrand(b.label)) && <span className="star">★ active</span>}
            </button>
          ))}
          {!list.length && <div className="banner" style={{ margin: 4 }}>No brand matches.</div>}
        </div>
      </>}
    </div>
  );
}

function Tip({ text }) {
  return (
    <span className="tip" tabIndex={0} aria-label={text}>?
      <span className="tip-bubble">{text}</span>
    </span>
  );
}

function StepsHeader({ step, setStep, ready }) {
  const steps = [
    { n: 1, t: 'Brand', d: 'Who is this for?' },
    { n: 2, t: 'Content', d: 'Photo + words' },
    { n: 3, t: 'Review & Post', d: 'Check + publish' },
  ];
  return (
    <div className="steps">
      {steps.map((s) => {
        const done = step > s.n;
        const cur = step === s.n;
        const locked = s.n === 3 && !ready;
        return (
          <button
            key={s.n}
            disabled={locked && !cur}
            onClick={() => { if (!locked) setStep(s.n); }}
            className={cur ? 'step cur' : done ? 'step done' : 'step'}
            title={locked ? 'Add a photo/video and some text first' : s.d}
          >
            <span className="step-n">{done ? '✓' : s.n}</span>
            <span className="step-t"><b>{s.t}</b><small>{s.d}</small></span>
          </button>
        );
      })}
    </div>
  );
}

function Composer({ session, connections, reload }) {
  const persistKey = `driftpost-composer:${session.user.id}`;
  const saved = (() => {
    try { return JSON.parse(localStorage.getItem(persistKey) || '{}'); }
    catch { return {}; }
  })();
  const [hidden] = useLocalSet(`driftpost-hidden:${session.user.id}`);
  const [manualActive] = useLocalSet(`driftpost-active:${session.user.id}`);
  const vis = useMemo(() => connections.filter((c) => !hidden.has(c.id)), [connections, hidden]);
  const brands = useMemo(() => groupBrands(vis), [vis]);
  const brandActive = (b) => isActiveBrand(b.label) || Object.values(b.map).some((id) => manualActive.has(id));
  const [brandKey, setBrandKey] = useState(saved.brandKey || '');
  const [step, setStep] = useState([1, 2, 3].includes(saved.step) ? saved.step : 1);
  const [tab, setTab] = useState(saved.tab || 'youtube');
  const [showAdv, setShowAdv] = useState(saved.showAdv || {});
  const [over, setOver] = useState(saved.over || {});
  const [files, setFiles] = useState([]);
  const [thumb, setThumb] = useState(null);
  const [trioMode, setTrioMode] = useState(!!saved.trioMode);
  const [ytConverting, setYtConverting] = useState(false);
  const [caption, setCaption] = useState(saved.caption || '');
  const [yt, setYt] = useState(saved.yt || { title: '', description: '', tags: '', privacy: 'private', category: '', kids: '', license: '', embed: '', stats: '', notify: 'on' });
  const [ig, setIg] = useState(saved.ig || { caption: '', alt: '', topics: '', partner: '', collabs: '', location: '', shareFb: false });
  const [fb, setFb] = useState(saved.fb || { message: '', link: '', syndIg: false, age: '', cta: '', linkName: '', linkCaption: '', linkDesc: '', linkPic: '', unpublished: false });
  const [x, setX] = useState(saved.x || { text: '', reply: 'everyone', pollOn: false, opts: ['', '', '', ''], mins: '1440' });
  const [busy, setBusy] = useState({});
  const [enabled, setEnabled] = useState(saved.enabled || { youtube: true, instagram: true, facebook: true, x: true });
  const [aiBrief, setAiBrief] = useState(saved.aiBrief || '');
  const [aiBusy, setAiBusy] = useState(false);
  const [aiMsg, setAiMsg] = useState(saved.aiMsg || '');
  const [copyMsg, setCopyMsg] = useState('');
  const [results, setResults] = useState(saved.results || {});
  // AI style controls live up here (before the persist effect below) —
  // the persist dep array reads them on every render, so declaring them
  // later would throw "Cannot access before initialization" (TDZ).
  const [aiTrends, setAiTrends] = useState(false);
  const [aiTone, setAiTone] = useState(saved.aiTone || 'auto');
  const [aiEmoji, setAiEmoji] = useState(saved.aiEmoji || 'high');
  const [aiLength, setAiLength] = useState(saved.aiLength || 'medium');
  const inputRef = useRef();
  const thumbRef = useRef();

  // Strict refresh survival: every keystroke lands in localStorage, media
  // blobs land in IndexedDB, and the console reopens on the same view/step.
  // Results keep their server jobId so in-flight publishes resume polling.
  const persistResults = {};
  try {
    for (const [k, r] of Object.entries(results || {})) {
      if (r && typeof r === 'object') {
        persistResults[k] = { state: r.state, progress: r.progress, url: r.url, message: r.message, warning: r.warning, jobId: r.jobId };
      }
    }
  } catch {}
  useEffect(() => {
    try {
      localStorage.setItem(persistKey, JSON.stringify({
        brandKey, step, tab, caption, yt, ig, fb, x, enabled,
        aiBrief, aiTone, aiEmoji, aiLength, over,
        trioMode, showAdv, aiMsg, results: persistResults,
      }));
    } catch {}
  }, [persistKey, brandKey, step, tab, caption, yt, ig, fb, x, enabled, aiBrief, aiTone, aiEmoji, aiLength, over, trioMode, showAdv, aiMsg, results]);

  // Media vault: restore attached files + cover after a refresh, and save
  // them on every change (File/Blob objects survive in IndexedDB).
  const mediaKey = `driftpost-media:${session.user.id}`;
  const mediaRestoredRef = useRef(false);
  useEffect(() => {
    if (mediaRestoredRef.current) return;
    mediaRestoredRef.current = true;
    (async () => {
      const vault = await idbGet(mediaKey);
      if (vault?.files?.length && !files.length) {
        const restored = vault.files
          .filter((f) => f.blob instanceof Blob)
          .map((f) => {
            const raw = f.blob instanceof File ? f.blob : new File([f.blob], f.name || 'media', { type: f.type || 'image/jpeg' });
            return { raw, name: f.name || raw.name, size: `${(raw.size / 1024 / 1024).toFixed(1)} MB`, type: raw.type };
          });
        if (restored.length) setFiles(restored);
      }
      if (vault?.thumb?.blob instanceof Blob && !thumb) {
        const b = vault.thumb.blob;
        const raw = b instanceof File ? b : new File([b], vault.thumb.name || 'cover.jpg', { type: b.type || 'image/jpeg' });
        setThumb({ raw, name: vault.thumb.name || raw.name });
      }
    })();
  }, []);
  useEffect(() => {
    idbSet(mediaKey, {
      files: files.map((f) => ({ name: f.name, type: f.type, blob: f.raw })).filter((f) => f.blob instanceof Blob),
      thumb: thumb?.raw instanceof Blob ? { name: thumb.name, blob: thumb.raw } : null,
    });
  }, [mediaKey, files, thumb]);

  useEffect(() => {
    if (brands.length && !brands.some((b) => b.key === brandKey)) {
      setBrandKey((brands.find((b) => brandActive(b)) || brands[0]).key);
    }
  }, [brands, brandKey]);

  const brand = brands.find((b) => b.key === brandKey) || null;
  const trio = useMemo(() => findTrioBrands(brands), [brands]);
  const listFor = (pid) => vis.filter((c) => c.platform === pid);
  const pickFor = (brandObj, pid) => over[`${brandObj?.key}:${pid}`] || brandObj?.map[pid] || '';
  const pick = (pid) => pickFor(brand, pid);
  const setPick = (pid, id) => setOver((m) => ({ ...m, [`${brand?.key}:${pid}`]: id }));

  // Carousel files (2-10 photos = 1 carousel post on IG/FB, up to 4 on X).
  const file = files[0] || null;
  const isCarousel = files.length >= 2 && files.every((f) => f.type.startsWith('image/'));
  const hasVideo = files.some((f) => f.type.startsWith('video/'));
  const mediaUrl = useMemo(
    () => (file?.raw && file.type.startsWith('image/') ? URL.createObjectURL(file.raw) : null),
    [file]
  );
  const mediaVideoUrl = useMemo(
    () => (file?.raw && file.type.startsWith('video/') ? URL.createObjectURL(file.raw) : null),
    [file]
  );

  const pickFiles = (list) => {
    const arr = [...list].filter((f) => f && /^(image|video)\//.test(f.type)).slice(0, 10);
    setFiles(arr.map((f) => ({ raw: f, name: f.name, size: `${(f.size / 1024 / 1024).toFixed(1)} MB`, type: f.type })));
  };
  const removeFileAt = (idx) => setFiles((fs) => fs.filter((_, i) => i !== idx));

  // YouTube has no photo/Community-post API: convert an attached photo into a
  // 6-second 1080x1920 video in-browser (Ken Burns zoom) so it posts as a Short.
  const convertPhotoForYouTube = async () => {
    const img = files.find((f) => f.type.startsWith('image/'));
    if (!img || ytConverting) return;
    setYtConverting(true);
    try {
      const bitmap = await createImageBitmap(img.raw);
      const W = 1080; const H = 1920;
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      const ctx = canvas.getContext('2d');
      const stream = canvas.captureStream(30);
      const rec = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9') ? 'video/webm;codecs=vp9' : 'video/webm', videoBitsPerSecond: 5_000_000 });
      const chunks = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      const done = new Promise((res) => { rec.onstop = res; });
      rec.start(200);
      const scale = Math.max(W / bitmap.width, H / bitmap.height);
      const dw = bitmap.width * scale; const dh = bitmap.height * scale;
      const t0 = performance.now(); const DUR = 6000;
      await new Promise((resolve) => {
        const draw = (now) => {
          const t = Math.min(1, (now - t0) / DUR);
          const zoom = 1 + t * 0.12;
          ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
          const w = dw * zoom; const h = dh * zoom;
          ctx.drawImage(bitmap, (W - w) / 2, (H - h) / 2, w, h);
          if (t < 1) requestAnimationFrame(draw);
          else resolve();
        };
        requestAnimationFrame(draw);
      });
      rec.stop();
      await done;
      const blob = new Blob(chunks, { type: 'video/webm' });
      const conv = new File([blob], img.name.replace(/\.[a-z]+$/i, '') + '-short.webm', { type: 'video/webm' });
      setFiles((fs) => {
        const rest = fs.filter((f) => !f.type.startsWith('image/'));
        return [...rest, { raw: conv, name: conv.name, size: `${(conv.size / 1024 / 1024).toFixed(1)} MB`, type: conv.type }];
      });
    } catch (e) { alert(`Convert failed: ${e.message}`); }
    setYtConverting(false);
  };

  const xLen = Array.from((x.text || caption).trim()).length;

  const buildForm = (platform, { connectionId = null, skipCrossPost = false } = {}) => {
    const form = new FormData();
    form.append('platform', platform);
    form.append('connection_id', connectionId || pick(platform));
    form.append('text', caption);
    form.append('title', yt.title);
    form.append('privacy', yt.privacy);
    form.append('yt_title', yt.title);
    form.append('yt_description', yt.description);
    form.append('yt_tags', yt.tags);
    form.append('yt_privacy', yt.privacy);
    form.append('yt_category', yt.category);
    form.append('yt_kids', yt.kids);
    form.append('yt_license', yt.license);
    form.append('yt_embed', yt.embed);
    form.append('yt_stats', yt.stats);
    form.append('yt_notify', yt.notify);
    form.append('ig_caption', ig.caption);
    form.append('ig_alt', ig.alt);
    form.append('ig_topics', ig.topics);
    form.append('ig_partner', ig.partner);
    form.append('ig_collabs', ig.collabs);
    form.append('ig_location', ig.location);
    form.append('ig_share_fb', ig.shareFb ? '1' : '');
    form.append('fb_connection_id', pick('facebook'));
    form.append('fb_message', fb.message);
    form.append('fb_link', fb.link);
    form.append('fb_synd_ig', fb.syndIg ? '1' : '');
    form.append('ig_connection_id', pick('instagram'));
    form.append('fb_age', fb.age);
    form.append('fb_cta', fb.cta);
    form.append('fb_link_name', fb.linkName);
    form.append('fb_link_caption', fb.linkCaption);
    form.append('fb_link_desc', fb.linkDesc);
    form.append('fb_link_pic', fb.linkPic);
    form.append('fb_unpublished', fb.unpublished ? '1' : '');
    form.append('x_text', x.text);
    form.append('x_reply', x.reply);
    form.append('x_poll_options', JSON.stringify(x.pollOn ? x.opts : []));
    form.append('x_poll_minutes', x.mins);
    if (skipCrossPost) form.append('skip_crosspost', '1');
    for (const f of files.slice(0, 10)) { if (f?.raw) form.append('media', f.raw); }
    if (platform === 'youtube' && thumb?.raw) form.append('thumbnail', thumb.raw);
    return form;
  };

  const runOne = async (platform, out, { connectionId = null, key = null, skipCrossPost = false } = {}) => {
    const k = key || platform;
    out[k] = { state: 'uploading', progress: 5, jobId: null };
    setResults({ ...out });
    const res = await fetch(`${apiUrl}/api/publish`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` },
      body: buildForm(platform, { connectionId, skipCrossPost }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Publish failed');
    const jobId = data.job.id;
    out[k] = { state: 'uploading', progress: 5, jobId };
    setResults({ ...out });
    for (;;) {
      await new Promise((r) => setTimeout(r, 1500));
      const j = await api(`/api/jobs/${jobId}`, session.access_token);
      out[k] = { state: j.job.state, progress: j.job.progress || 50, url: j.job.url, message: j.job.message, warning: j.job.warning, jobId };
      setResults({ ...out });
      if (j.job.state === 'completed') return;
      if (j.job.state === 'failed') throw new Error(j.job.message);
    }
  };

  // Refresh during an upload: re-attach to every in-flight server job and
  // keep polling it, so progress + the final post link are never lost.
  const resumedRef = useRef(false);
  useEffect(() => {
    if (resumedRef.current) return;
    resumedRef.current = true;
    const pending = Object.entries(results || {}).filter(([, r]) => r?.jobId && !['completed', 'failed'].includes(r.state));
    if (!pending.length) return;
    (async () => {
      for (const [k, r] of pending) {
        try {
          for (;;) {
            await new Promise((res) => setTimeout(res, 1500));
            const j = await api(`/api/jobs/${r.jobId}`, session.access_token);
            setResults((prev) => ({ ...prev, [k]: { ...prev[k], state: j.job.state, progress: j.job.progress || 50, url: j.job.url, message: j.job.message, warning: j.job.warning, jobId: r.jobId } }));
            if (j.job.state === 'completed' || j.job.state === 'failed') break;
          }
        } catch {
          setResults((prev) => ({ ...prev, [k]: { ...prev[k], state: 'failed', message: 'Upload was interrupted by the refresh and the job is gone — please repost.', jobId: null } }));
        }
      }
      reload();
    })();
  }, []);

  const publishOne = async (platform) => {
    if (busy[platform]) return;
    if (!pick(platform)) {
      setResults((r) => ({ ...r, [platform]: { state: 'failed', message: 'No account for this brand — pick one in the phone.' } }));
      return;
    }
    setBusy((b) => ({ ...b, [platform]: true }));
    const out = { ...results };
    try { await runOne(platform, out); }
    catch (e) { out[platform] = { state: 'failed', message: e.message }; setResults({ ...out }); }
    setBusy((b) => ({ ...b, [platform]: false }));
    reload();
  };

  const publishAll = async () => {
    // "Post to all" always strips IG<->FB mirrors (skip_crosspost=1):
    // direct IG + direct FB already cover both, mirrors would double-post.
    const targets = PLATFORMS.map((p) => p.id).filter((pid) => pick(pid) && enabled[pid]);
    if (!targets.length) return;
    const out = { ...results };
    for (const platform of targets) {
      try { await runOne(platform, out, { skipCrossPost: true }); }
      catch (e) { out[platform] = { state: 'failed', message: e.message }; setResults({ ...out }); }
    }
    reload();
  };

  const publishTrio = async () => {
    // One click: same media+caption to IG + FB + YT for all 3 jeweller brands.
    // Mirrors stripped (direct posts only) so Facebook never gets doubles.
    if (!trio.length) return;
    const plats = ['instagram', 'facebook', 'youtube'].filter((pid) => enabled[pid]);
    if (!plats.length) return;
    setBusy((b) => ({ ...b, trio: true }));
    const out = { ...results };
    for (const { name, brand: tb } of trio) {
      for (const platform of plats) {
        const cid = pickFor(tb, platform);
        const k = `trio:${name}:${platform}`;
        if (!cid) { out[k] = { state: 'failed', message: `No ${platform} account matched for ${name}` }; setResults({ ...out }); continue; }
        if (platform === 'youtube' && !hasVideo) {
          out[k] = { state: 'failed', message: 'YouTube needs a video (photo cannot post via API — use Convert first)' };
          setResults({ ...out }); continue;
        }
        try { await runOne(platform, out, { connectionId: cid, key: k, skipCrossPost: true }); }
        catch (e) { out[k] = { state: 'failed', message: e.message }; setResults({ ...out }); }
      }
    }
    setBusy((b) => ({ ...b, trio: false }));
    reload();
  };

  const applyCaptionEverywhere = () => {
    setIg((v) => ({ ...v, caption }));
    setFb((v) => ({ ...v, message: caption }));
    setX((v) => ({ ...v, text: caption.slice(0, 280) }));
    setYt((v) => ({ ...v, description: caption }));
  };

  const [aiBreakdown, setAiBreakdown] = useState(null);
  const [aiSecs, setAiSecs] = useState(0);
  const [lessonBusy, setLessonBusy] = useState(false);
  useEffect(() => {
    if (!aiBusy) { setAiSecs(0); return; }
    setAiSecs(0);
    const t = setInterval(() => setAiSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [aiBusy]);
  const writeWithAi = async () => {
    if (aiBusy || !aiBrief.trim()) return;
    setAiBusy(true); setAiMsg(''); setAiBreakdown(null);
    const t0 = Date.now();
    try {
      const data = await api('/api/ai/captions', session.access_token, {
        method: 'POST',
          body: JSON.stringify({
            summary: aiBrief,
            brand: trioMode && trio.length ? trio[0].brand.label : brand?.label || '',
            asset_description: files.length ? `${files.length} x ${files[0].type}${isCarousel ? ' (carousel)' : ''}` : '',
            goal: 'enquiries',
            trends: aiTrends,
            tone: aiTone,
            emoji: aiEmoji,
            length: aiLength,
          }),
      });
      const c = data.captions || data;
      setYt((v) => ({ ...v, title: c.youtube.title || v.title, description: c.youtube.description || v.description, tags: c.youtube.tags.join(', ') || v.tags }));
      setIg((v) => ({ ...v, caption: c.instagram.caption || v.caption }));
      setCaption((prev) => prev || c.instagram.caption || '');
      setFb((v) => ({ ...v, message: c.facebook.message || v.message }));
      setX((v) => ({ ...v, text: c.x.text.slice(0, 280) || v.text }));
      const tags = [...(c.youtube.tags || []), ...(c.instagram.hashtags || [])].filter(Boolean);
      if (tags.length) setYt((v) => ({ ...v, tags: v.tags || tags.slice(0, 8).join(', ') }));
      const secs = ((Date.now() - t0) / 1000).toFixed(1);
      setAiMsg(`${data.cached ? `Instant (${secs}s, cached) — ` : `Done in ${secs}s — `}${data.isNewBrand ? `New brand '${data.fromMemory.replace(' (new brand filed)', '')}' filed — it will keep learning. ` : data.fromMemory ? `Using ${data.fromMemory} memory — ` : ''}4 different captions written (YT search / IG discovery / FB social / X punchy)${data.trends ? ' with live SEO' : ''} — review each phone, then publish.`);
      if (data.breakdown) setAiBreakdown(data.breakdown);
    } catch (e) {
      setAiMsg(e.message);
    }
    setAiBusy(false);
  };

  const secState = (pid) => {
    const r = results[pid];
    if (!r) return 'Ready';
    if (r.state === 'completed') return 'Done';
    if (r.state === 'failed') return 'Failed';
    return `${r.progress || 5}%`;
  };

  const contentReady = !!(files.length || caption.trim() || yt.title.trim() || x.text.trim());
  const toggleAdv = (k) => setShowAdv((m) => ({ ...m, [k]: !m[k] }));
  const aiButtonLabel = aiBusy ? `Writing… ${aiSecs}s — same request is cached for 30 min` : '✨ Write captions';

  return (
    <div className="composer">
      <StepsHeader step={step} setStep={setStep} ready={contentReady} />

      {step === 1 && (
      <div className="step-panel">
        <div className="card step-card">
          <span className="scope-badge everywhere">Step 1 · Who is this for?</span>
          <h3>Pick a brand</h3>
          <p className="sub">One brand = one client. We auto-match their accounts on all 4 platforms.</p>
          <BrandPicker brands={brands} brandKey={brandKey} isActive={(b) => brandActive(b)} onPick={(k) => { setBrandKey(k); setResults({}); }} />
          {!brands.length && <div className="banner" style={{ marginTop: 12 }}>No accounts yet. Go to Accounts → Connect YouTube / Facebook / Instagram / X first.</div>}
        </div>

        <div className="card step-card">
          <span className="scope-badge everywhere">Where to post?</span>
          <h3>Choose platforms</h3>
          <p className="sub">Only ticked platforms will post. Unticked ones are skipped.</p>
          <div className="plat-pick">
            {PLATFORMS.map((p) => {
              const list = listFor(p.id);
              const chosen = pick(p.id);
              return (
                <div key={p.id} className={enabled[p.id] && chosen ? 'plat-row on' : 'plat-row'}>
                  <button
                    className={enabled[p.id] ? 'plat-check on' : 'plat-check'}
                    onClick={() => setEnabled((m) => ({ ...m, [p.id]: !m[p.id] }))}
                    aria-label={`Toggle ${p.name}`}
                  >{enabled[p.id] ? '✓' : ''}</button>
                  <span className="plat-ic"><BrandIcon id={p.id} size={18} /></span>
                  <span className="plat-meta"><b>{p.name}</b><small>{chosen ? list.find((c) => c.id === chosen)?.account_name : `No account — ${list.length} connected`}</small></span>
                  <select value={chosen} onChange={(e) => setPick(p.id, e.target.value)} aria-label={`${p.name} account`}>
                    {!chosen && <option value="">Pick account…</option>}
                    {list.map((c) => <option key={c.id} value={c.id}>{c.account_name}</option>)}
                  </select>
                </div>
              );
            })}
          </div>
          <div className="step-nav">
            <span />
            <button className="skew-btn grad" onClick={() => setStep(2)} disabled={!brand}><span>Next: add content →</span></button>
          </div>
        </div>
        {trio.length >= 2 && (
        <div className="card step-card" style={{ marginTop: 12, border: '1px solid #c9a227' }}>
          <span className="scope-badge everywhere">💎 Jewellers trio</span>
          <h3>Post to 3 brands at once?</h3>
          <p className="sub">One click → Instagram + Facebook + YouTube for {trio.map((t) => t.name).join(' · ')}. Same photo(s) + caption to all 3.</p>
          <label className="ck"><input type="checkbox" checked={trioMode} onChange={(e) => setTrioMode(e.target.checked)} /><svg viewBox="0 0 64 64"><path className="path" d="M8 33 L26 51 L56 13" /></svg><span>Enable trio mode (Step 3 shows one “Post trio” button)</span></label>
          {!trioMode && <p className="sub" style={{ marginTop: 6 }}>Found: {trio.map((t) => `${t.name} → ${t.brand.label}`).join(' | ')}</p>}
        </div>
        )}
      </div>
      )}

      {step === 2 && (
      <div className="step-panel">
      <div className="share-row stepped">
        <div className="card step-card">
          <span className="scope-badge everywhere">Used everywhere</span>
          <h3>1 · Photo or video <Tip text="Up to 10 photos = 1 carousel post on Instagram/Facebook (up to 4 on X). YouTube needs a video — photos cannot post to YouTube via the API." /></h3>
          <p className="sub">Add once — it appears on every platform. {isCarousel ? `Carousel: ${files.length} photos → 1 post.` : ''}</p>
          <input ref={inputRef} type="file" accept="image/*,video/*" multiple hidden onChange={(e) => { pickFiles(e.target.files); e.target.value = ''; }} />
          {!files.length ? (
            <div className="drop big" onClick={() => inputRef.current.click()}><b>＋ Add photos or video</b>Click to browse · up to 10 photos (carousel) or 1 video</div>
          ) : (
            <div>
              {mediaUrl && <img className="media-preview" src={mediaUrl} alt="Shared media preview" onClick={() => window.open(mediaUrl, '_blank')} title="Click to view full size" />}
              {mediaVideoUrl && (
                <video className="media-preview" src={mediaVideoUrl} controls preload="metadata" title="Video preview" />
              )}
              {files.map((f, i) => (
                <div key={i} className="file-row"><div><b>{i + 1}. {f.name}</b><small>{f.size} · {f.type}</small></div><button onClick={() => removeFileAt(i)}>Remove</button></div>
              ))}
              <div className="file-row"><span /><button onClick={() => inputRef.current.click()}>＋ Add more ({files.length}/10)</button><button onClick={() => setFiles([])}>Clear all</button></div>
              {isCarousel && <div className="banner" style={{ marginTop: 8 }}>Carousel: {files.length} photos will post as ONE carousel on Instagram + Facebook{files.length > 4 ? ' (X takes first 4)' : ' + X'}.</div>}
              {hasVideo && files.length > 1 && <div className="sec-err">Mixed video + multiple files: carousel needs photos only. Keep 1 video, or remove the video for a photo carousel.</div>}
            </div>
          )}
        </div>
        <div className="card step-card">
          <span className="scope-badge everywhere">Used everywhere</span>
          <h3>2 · Write once <Tip text="This text is copied into YouTube description, Instagram caption, Facebook message and X post. You can still edit each platform separately in the next step." /></h3>
          <p className="sub">Write here, tweak per platform later. <button className="link" onClick={applyCaptionEverywhere}>Copy to all now</button></p>
          <label className="field" style={{ marginBottom: 0 }}><span>Your message <i>{caption.length}/2200</i></span><textarea value={caption} maxLength={2200} onChange={(e) => setCaption(e.target.value)} placeholder="e.g. Diwali offer at Velvet Salon — 20% off bridal packages this week…" /></label>
        </div>
        <div className="card step-card ai">
          <span className="scope-badge ai-badge">Optional helper</span>
          <h3>✨ AI writer</h3>
          <p className="sub">Stuck? Type a short summary — 4 different captions (YT / IG / FB / X).</p>
          <label className="field" style={{ marginBottom: 0 }}><span>What is this post about? <i>brand + motive + conditions wins</i></span><textarea value={aiBrief} maxLength={500} onChange={(e) => setAiBrief(e.target.value)} placeholder="e.g. Velvet Salon has a new offer: 20% off for everyone who comes before 4pm" style={{ minHeight: 70 }} /></label>
          <label className="ck" style={{ marginTop: 8 }}><input type="checkbox" checked={aiTrends} onChange={(e) => setAiTrends(e.target.checked)} /><svg viewBox="0 0 64 64"><path className="path" d="M8 33 L26 51 L56 13" /></svg><span>🔥 Live SEO trends (slower, costs more)</span></label>
          <div className="row2" style={{ marginTop: 8 }}>
            <label className="field-mini"><span>Tone</span>
              <select value={aiTone} onChange={(e) => setAiTone(e.target.value)}>
                <option value="auto">Auto (brand default)</option>
                <option value="excited">🔥 Excited</option>
                <option value="warm">🤗 Warm</option>
                <option value="professional">💼 Professional</option>
                <option value="funny">😂 Funny</option>
              </select>
            </label>
            <label className="field-mini"><span>Emojis</span>
              <select value={aiEmoji} onChange={(e) => setAiEmoji(e.target.value)}>
                <option value="low">Few (1-2)</option>
                <option value="medium">Medium (3-5)</option>
                <option value="high">Lots (5-8)</option>
                <option value="max">MAX 🎉 (8-12)</option>
              </select>
            </label>
          </div>
          <div className="row2" style={{ marginTop: 8 }}>
            <label className="field-mini"><span>Length</span>
              <select value={aiLength} onChange={(e) => setAiLength(e.target.value)}>
                <option value="short">Short & punchy</option>
                <option value="medium">Medium (classic)</option>
                <option value="detailed">Detailed story</option>
              </select>
            </label>
            <span />
          </div>
          {aiMsg && <div className={/different captions written|Saved to/i.test(aiMsg) ? 'banner' : 'alert err'} style={{ marginTop: 10 }}>{aiMsg}</div>}
          {aiBreakdown && (
            <div className="ai-chips" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8, fontSize: 11 }}>
              <span className="status-pill">{aiBreakdown.weak ? '⚠️ thin prompt' : '✓ understood'}</span>
              <span className="status-pill">🏷 {aiBreakdown.brand}</span>
              <span className="status-pill">🎯 {aiBreakdown.motive}</span>
              <span className="status-pill">⏰ {aiBreakdown.when}</span>
              <span className="status-pill">✍️ {String(aiBreakdown.type).split(':')[0]}</span>
            </div>
          )}
          <button className="skew-btn grad" style={{ width: '100%', marginTop: 10 }} disabled={aiBusy || !aiBrief.trim()} onClick={writeWithAi}><span>{aiButtonLabel}</span></button>
          <button className="skew-btn ghost" style={{ width: '100%', marginTop: 8 }} disabled={lessonBusy || (!ig.caption && !caption)} onClick={async () => {
            if (lessonBusy || !brand?.label) return;
            setLessonBusy(true); setAiMsg('');
            try {
              const d = await api('/api/ai/learn', session.access_token, { method: 'POST',
                body: JSON.stringify({ brand: brand.label, finalCaption: ig.caption || caption, asset_description: files.length ? `${files.length} x ${files[0].type}` : aiBrief }) });
              setAiMsg(`Saved to ${d.saved} memory (${d.count} lessons) — next captions copy this style.`);
            } catch (e) { setAiMsg(e.message); }
            setLessonBusy(false);
          }}><span>{lessonBusy ? 'Saving…' : '📥 Caption good? Save as brand lesson'}</span></button>
          {aiBusy && <div className="progress-loader" style={{ marginTop: 10 }}><div className="progress" /></div>}
        </div>
      </div>
        <div className="step-nav">
          <button className="skew-btn ghost" onClick={() => setStep(1)}><span>← Back</span></button>
          <button className="skew-btn grad" onClick={() => setStep(3)}><span>Next: review & post →</span></button>
        </div>
      </div>
      )}

      {step === 3 && (
      <div className="step-panel">
      <div className="brandbar tight">
        <BrandPicker brands={brands} brandKey={brandKey} isActive={(b) => brandActive(b)} onPick={(k) => { setBrandKey(k); setResults({}); }} />
        <button className="skew-btn grad pub-all" onClick={publishAll} disabled={Object.values(busy).some(Boolean)}><span>🚀 Post to all ticked{isCarousel ? ` (carousel x${files.length})` : ''}</span></button>
      </div>
      {trioMode && trio.length >= 2 && (
        <div className="card" style={{ border: '1px solid #c9a227', marginBottom: 10 }}>
          <span className="scope-badge everywhere">💎 Jewellers trio · IG + FB + YT × {trio.length} brands</span>
          <p className="sub" style={{ margin: '6px 0' }}>{trio.map((t) => t.name).join(' · ')} — same media + caption to all. Facebook doubles prevented automatically (direct posts only).</p>
          <button className="skew-btn grad" style={{ width: '100%' }} onClick={publishTrio} disabled={!!busy.trio || Object.values(busy).some(Boolean)}><span>{busy.trio ? 'Posting trio…' : `💎 Post trio now (${trio.length * ['instagram', 'facebook', 'youtube'].filter((p) => enabled[p]).length} posts)`}</span></button>
          <div style={{ marginTop: 8 }}>
            {trio.flatMap(({ name, brand: tb }) => ['instagram', 'facebook', 'youtube'].map((plat) => {
              const k = `trio:${name}:${plat}`;
              const r = results[k];
              if (!r) return null;
              return <div key={k} className={r.state === 'failed' ? 'sec-err' : 'banner'} style={{ marginTop: 4 }}>{name} → {plat}: {r.state}{r.message ? ` — ${r.message}` : ''} {r.url ? <a href={r.url} target="_blank" rel="noreferrer">View →</a> : null}</div>;
            }))}
          </div>
        </div>
      )}
      {(ig.shareFb || fb.syndIg) && enabled.instagram && enabled.facebook && (
        <div className="banner" style={{ marginBottom: 10 }}>⚠️ Double-post guard: “Post to all” ignores the ☑️ cross-post ticks and posts IG + FB directly (1 post each). Single-platform “Post to …” still honours the tick. Keep both ticks OFF unless you publish one platform at a time.</div>
      )}
      <div className="ptabs" role="tablist">
        {PLATFORMS.map((p) => {
          const r = results[p.id];
          const dot = r?.state === 'completed' ? '✓' : r?.state === 'failed' ? '!' : busy[p.id] ? '…' : '';
          return (
            <button key={p.id} role="tab" aria-selected={tab === p.id} className={tab === p.id ? 'ptab on' : 'ptab'} onClick={() => setTab(p.id)}>
              <BrandIcon id={p.id} size={15} /> {p.name}
              {dot && <span className={r?.state === 'failed' ? 'pdot fail' : 'pdot'}>{dot}</span>}
              {!pick(p.id) && <span className="pdot warn">no acct</span>}
            </button>
          );
        })}
      </div>
      <div className="phones single" key={brandKey + tab}>
        {PLATFORMS.filter((p) => p.id === tab).map((p, idx) => {
          const pid = p.id;
          const list = listFor(pid);
          const chosen = pick(pid);
          const r = results[pid];
          const HINTS = { youtube: 'Video only + title (photos need Convert)', instagram: isCarousel ? `Carousel x${files.length} photos` : 'Photo(s), reel or carousel', facebook: isCarousel ? `Carousel x${files.length} photos` : 'Text, photo(s) or video', x: files.length > 4 ? 'Max 4 photos (first 4 used)' : 'Max 280 characters, up to 4 photos' };
          return (
            <div key={pid} className={chosen ? 'phone' : 'phone off'}>
              <div className="phone-head"><span className="idx">0{idx + 1}</span><span className="p-icon"><BrandIcon id={pid} size={15} /></span><span><b>{p.name}</b><small>{list.length} account{list.length === 1 ? '' : 's'} · {HINTS[pid]}</small></span><span className="led" /></div>
              <div className="phone-screen">
                <label className="field-mini"><span>Account</span>
                  <select value={chosen} onChange={(e) => setPick(pid, e.target.value)}>
                    {!chosen && <option value="">— pick —</option>}
                    {list.map((c) => <option key={c.id} value={c.id}>{c.account_name}</option>)}
                  </select>
                </label>

                <div className="media-thumb" onClick={() => { setStep(2); setTimeout(() => inputRef.current?.click(), 50); }}>
                  {mediaUrl ? <img src={mediaUrl} alt="Shared media" /> : file ? <span>{files.length > 1 ? `${files.length} photos (carousel) — ${file.name}` : <>{file.name}<br />{file.size}</>}</span> : <span>Media</span>}
                </div>

                {pid === 'youtube' && <>
                  <span className="scope-badge only">Only YouTube — videos only (posts as Video; vertical &lt;60s auto-becomes a Short)</span>
                  {files.length > 0 && !hasVideo && (
                    <div className="sec-err">📷 Photos can't post to YouTube via the API (no Community-post endpoint). Convert to a 6s vertical video, then post as a Short — or attach a video in Step 2.<br /><button className="mini" style={{ marginTop: 6 }} disabled={ytConverting} onClick={convertPhotoForYouTube}>{ytConverting ? 'Converting…' : '🎬 Convert photo to 6s video for YouTube'}</button></div>
                  )}
                  {files.length > 1 && hasVideo && <div className="sec-err">YouTube takes 1 video per post — keep a single video for this card (carousel posts to IG/FB/X only).</div>}
                  <label className="field-mini"><span>Video title · {yt.title.length}/100 <Tip text="Required. This is the headline people see on YouTube." /></span><input value={yt.title} maxLength={100} onChange={(e) => setYt({ ...yt, title: e.target.value })} placeholder="e.g. Bridal glow-up at Velvet Salon" /></label>
                  <label className="field-mini"><span>About this video <Tip text="Shown under your video. If empty, we use your message from Step 2." /></span><textarea value={yt.description} onChange={(e) => setYt({ ...yt, description: e.target.value })} placeholder="Uses your Step 2 message if left empty" /></label>
                  <label className="field-mini"><span>Search words · comma separated <Tip text="Helps people find your video. Example: salon, bridal, mumbai." /></span><input value={yt.tags} onChange={(e) => setYt({ ...yt, tags: e.target.value })} placeholder="salon, bridal, mumbai" /></label>
                  <div className="row2">
                    <label className="field-mini"><span>Who can watch? <Tip text="Private = only you. Unlisted = anyone with link. Public = everyone on YouTube." /></span>
                      <select value={yt.privacy} onChange={(e) => setYt({ ...yt, privacy: e.target.value })}>
                        <option value="private">🔒 Private (only me)</option>
                        <option value="unlisted">🔗 Unlisted (link only)</option>
                        <option value="public">🌍 Public (everyone)</option>
                      </select>
                    </label>
                    <label className="field-mini"><span>Cover image <Tip text="The thumbnail people click on. JPG or PNG." /></span>
                      <button className="mini wide" onClick={() => thumbRef.current.click()}>{thumb ? '✓ Cover added' : '＋ Add cover'}</button>
                      <input ref={thumbRef} type="file" accept="image/jpeg,image/png" hidden onChange={(e) => { const f = e.target.files[0]; if (f) setThumb({ raw: f, name: f.name }); }} />
                    </label>
                  </div>
                  <button className={showAdv['yt'] ? 'adv-toggle open' : 'adv-toggle'} onClick={() => toggleAdv('yt')}>{showAdv['yt'] ? '▾ Hide extra YouTube options' : '▸ Extra YouTube options (kids, category…)'}</button>
                  {showAdv['yt'] && (
                  <div className="adv-box">
                  <div className="row2">
                    <label className="field-mini"><span>Video type <Tip text="Pick what fits best. Helps YouTube suggest your video." /></span>
                      <select value={yt.category} onChange={(e) => setYt({ ...yt, category: e.target.value })}>
                        <option value="">Auto (recommended)</option>
                        <option value="26">How-to & Style</option>
                        <option value="22">People & Blogs</option>
                        <option value="24">Entertainment</option>
                        <option value="10">Music</option>
                        <option value="20">Gaming</option>
                        <option value="27">Education</option>
                        <option value="28">Science & Tech</option>
                        <option value="19">Travel & Events</option>
                        <option value="17">Sports</option>
                        <option value="23">Comedy</option>
                      </select>
                    </label>
                    <label className="field-mini"><span>Is it made for kids? <Tip text="YouTube law: say Yes if the video is for children under 13." /></span>
                      <select value={yt.kids} onChange={(e) => setYt({ ...yt, kids: e.target.value })}>
                        <option value="">Not sure</option>
                        <option value="yes">Yes, for kids</option>
                        <option value="no">No, not for kids</option>
                      </select>
                    </label>
                  </div>
                  <div className="row2">
                    <label className="field-mini"><span>Allow others to share? <Tip text="Allow = other websites can show your video." /></span>
                      <select value={yt.embed} onChange={(e) => setYt({ ...yt, embed: e.target.value })}>
                        <option value="">Yes, allow sharing</option>
                        <option value="yes">Yes, allow</option>
                        <option value="no">No, YouTube only</option>
                      </select>
                    </label>
                    <label className="field-mini"><span>Tell subscribers? <Tip text="On = followers get a notification. Off = quiet upload." /></span>
                      <select value={yt.notify} onChange={(e) => setYt({ ...yt, notify: e.target.value })}>
                        <option value="on">Yes, notify them</option>
                        <option value="off">No, keep quiet</option>
                      </select>
                    </label>
                  </div>
                  </div>
                  )}
                </>}

                {pid === 'instagram' && <>
                  <span className="scope-badge only">Only Instagram{isCarousel ? ` — carousel x${files.length}` : ''}</span>
                  {isCarousel && <div className="banner" style={{ margin: 0 }}>These {files.length} photos post as ONE carousel swipe post.</div>}
                  <label className="field-mini"><span>Caption · {(ig.caption || caption).length}/2200 <Tip text="Text under your photo/reel. If empty, we use your Step 2 message." /></span><textarea value={ig.caption} onChange={(e) => setIg({ ...ig, caption: e.target.value })} placeholder="Uses your Step 2 message if left empty" /></label>
                  <label className="ck"><input type="checkbox" checked={ig.shareFb} onChange={(e) => setIg({ ...ig, shareFb: e.target.checked })} /><svg viewBox="0 0 64 64"><path className="path" d="M8 33 L26 51 L56 13" /></svg><span>Also post this on Facebook (single-post only — OFF when using “Post to all”)</span></label>
                  <button className={showAdv['ig'] ? 'adv-toggle open' : 'adv-toggle'} onClick={() => toggleAdv('ig')}>{showAdv['ig'] ? '▾ Hide extra Instagram options' : '▸ Extra options (tags, partners…)'}</button>
                  {showAdv['ig'] && (
                  <div className="adv-box">
                    <label className="field-mini"><span>Topics · up to 3 <Tip text="Simple words like fitness, bridal. Helps new people discover you." /></span><input value={ig.topics} onChange={(e) => setIg({ ...ig, topics: e.target.value })} placeholder="e.g. bridal, mumbai" /></label>
                    <label className="field-mini"><span>Tag a business partner <Tip text="If a brand paid for this post, type their @name here." /></span><input value={ig.partner} onChange={(e) => setIg({ ...ig, partner: e.target.value })} placeholder="e.g. lakmeindia (no @ needed)" /></label>
                    <label className="field-mini"><span>Invite co-authors · up to 3 <Tip text="Other accounts shown as authors alongside you." /></span><input value={ig.collabs} onChange={(e) => setIg({ ...ig, collabs: e.target.value })} placeholder="e.g. makeup_artist, photographer" /></label>
                    <label className="field-mini"><span>Describe for blind users <Tip text="One sentence describing the photo. Read aloud by screen readers." /></span><input value={ig.alt} maxLength={500} onChange={(e) => setIg({ ...ig, alt: e.target.value })} placeholder="e.g. Bride smiling with red lehenga" /></label>
                  </div>
                  )}
                </>}

                {pid === 'facebook' && <>
                  <span className="scope-badge only">Only Facebook{isCarousel ? ` — carousel x${files.length}` : ''}</span>
                  {isCarousel && <div className="banner" style={{ margin: 0 }}>These {files.length} photos post as ONE multi-photo post (not {files.length} separate posts).</div>}
                  <label className="field-mini"><span>What to say? <Tip text="Text shown above your photo/video. If empty, we use your Step 2 message." /></span><textarea value={fb.message} onChange={(e) => setFb({ ...fb, message: e.target.value })} placeholder="Uses your Step 2 message if left empty" /></label>
                  <label className="field-mini"><span>Website link · optional <Tip text="e.g. your booking page. Leave empty for photo/video only." /></span><input value={fb.link} onChange={(e) => setFb({ ...fb, link: e.target.value })} placeholder="https://your-website.com/offer" /></label>
                  <label className="ck"><input type="checkbox" checked={fb.syndIg} onChange={(e) => setFb({ ...fb, syndIg: e.target.checked })} /><svg viewBox="0 0 64 64"><path className="path" d="M8 33 L26 51 L56 13" /></svg><span>Also post this on Instagram (single-post only — OFF when using “Post to all”)</span></label>
                  <button className={showAdv['fb'] ? 'adv-toggle open' : 'adv-toggle'} onClick={() => toggleAdv('fb')}>{showAdv['fb'] ? '▾ Hide extra Facebook options' : '▸ Extra options (button, age, ads…)'}</button>
                  {showAdv['fb'] && (
                  <div className="adv-box">
                    <label className="field-mini"><span>Add a button · needs a link above <Tip text="Shows Shop now / Learn more under your post." /></span>
                      <select value={fb.cta} onChange={(e) => setFb({ ...fb, cta: e.target.value })}>
                        <option value="">No button</option>
                        <option value="LEARN_MORE">Learn more</option>
                        <option value="SHOP_NOW">Shop now</option>
                        <option value="SIGN_UP">Sign up</option>
                        <option value="MESSAGE_PAGE">Send message</option>
                      </select>
                    </label>
                    <label className="field-mini"><span>Who can see it? <Tip text="Hide from young viewers if needed. Everyone = no limit." /></span>
                      <select value={fb.age} onChange={(e) => setFb({ ...fb, age: e.target.value })}>
                        <option value="">Everyone</option>
                        <option value="13">13 and older</option>
                        <option value="18">18 and older</option>
                        <option value="21">21 and older</option>
                        <option value="25">25 and older</option>
                      </select>
                    </label>
                    <label className="ck"><input type="checkbox" checked={fb.unpublished} onChange={(e) => setFb({ ...fb, unpublished: e.target.checked })} /><svg viewBox="0 0 64 64"><path className="path" d="M8 33 L26 51 L56 13" /></svg><span>Hide from page — ads only <Tip text="Advanced: post exists but visitors won't see it on your page. Only used for ads." /></span></label>
                    <label className="field-mini"><span>Link headline · optional <Tip text="Custom title shown on the link box. Leave empty to use the website's own title." /></span><input value={fb.linkName} onChange={(e) => setFb({ ...fb, linkName: e.target.value })} placeholder="Leave empty = auto" /></label>
                    <label className="field-mini"><span>Link description · optional</span><input value={fb.linkDesc} onChange={(e) => setFb({ ...fb, linkDesc: e.target.value })} placeholder="Leave empty = auto" /></label>
                  </div>
                  )}
                </>}

                {pid === 'x' && <>
                  <span className="scope-badge only">Only X</span>
                  <label className="field-mini"><span>Your post · {xLen}/280 <Tip text="Short and sharp works best. If empty, we use your Step 2 message (cut to 280)." /></span><textarea value={x.text} maxLength={400} onChange={(e) => setX({ ...x, text: e.target.value })} placeholder="Uses your Step 2 message if left empty" /></label>
                  {xLen > 280 && <div className="sec-err">Too long — {xLen - 280} characters over. Shorten it.</div>}
                  <label className="ck"><input type="checkbox" checked={x.pollOn} onChange={(e) => setX({ ...x, pollOn: e.target.checked })} /><svg viewBox="0 0 64 64"><path className="path" d="M8 33 L26 51 L56 13" /></svg><span>Ask a question (poll) instead</span></label>
                  {x.pollOn && <>
                    {[0, 1].map((i) => (
                      <label key={i} className="field-mini"><span>Answer {i + 1} · required</span><input value={x.opts[i]} maxLength={25} onChange={(e) => { const o = [...x.opts]; o[i] = e.target.value; setX({ ...x, opts: o }); }} placeholder="e.g. Yes" /></label>
                    ))}
                    {[2, 3].map((i) => (
                      <label key={i} className="field-mini"><span>Answer {i + 1} · optional</span><input value={x.opts[i]} maxLength={25} onChange={(e) => { const o = [...x.opts]; o[i] = e.target.value; setX({ ...x, opts: o }); }} placeholder="Optional" /></label>
                    ))}
                    <label className="field-mini"><span>Keep voting open for</span>
                      <select value={x.mins} onChange={(e) => setX({ ...x, mins: e.target.value })}>
                        <option value="60">1 hour</option>
                        <option value="1440">1 day</option>
                        <option value="10080">7 days</option>
                      </select>
                    </label>
                    {files.length > 0 && <div className="sec-err">Polls can't have a photo. Remove the Step 2 photo(s) to run this poll.</div>}
                  </>}
                  <label className="field-mini"><span>Who can reply? <Tip text="Everyone = open chat. Followed = safer. Mentioned = private." /></span>
                    <select value={x.reply} onChange={(e) => setX({ ...x, reply: e.target.value })}>
                      <option value="everyone">Everyone can reply</option>
                      <option value="following">Only accounts I follow</option>
                      <option value="mentionedUsers">Only people I mention</option>
                    </select>
                  </label>
                </>}

                <div className="status-line">
                  <span className={r?.state === 'failed' ? 'status-pill fail' : r?.state === 'completed' ? 'status-pill ok' : 'status-pill'}>
                    {busy[pid] ? '● Sending…' : r?.state === 'completed' ? '✓ Posted' : r?.state === 'failed' ? '✕ Failed' : '○ Ready to post'}
                  </span>
                  {enabled[pid] ? <span className="status-hint">Included in “Post to all”</span> : <span className="status-hint">Skipped in “Post to all”</span>}
                </div>
                {busy[pid] && <div className="progress-loader"><div className="progress" /></div>}
                {r?.state === 'failed' && <div className="sec-err">{r.message}</div>}
                {r?.warning && r?.state !== 'failed' && <div className="banner" style={{ margin: 0 }}>{r.warning}</div>}
                {r?.url && <a className="phone-link big" href={r.url} target="_blank" rel="noreferrer">View your post →</a>}
                <div className="phone-actions">
                  <label className="ck"><input type="checkbox" checked={!!enabled[pid]} onChange={(e) => setEnabled((m) => ({ ...m, [pid]: e.target.checked }))} /><svg viewBox="0 0 64 64"><path className="path" d="M8 33 L26 51 L56 13" /></svg><span>Include in “post to all”</span></label>
                  <button className="mini" title="Copy this platform's caption" onClick={() => {
                    const texts = { youtube: `${yt.title}\n\n${yt.description || caption}`, instagram: ig.caption || caption, facebook: fb.message || caption, x: x.text || caption };
                    try { navigator.clipboard.writeText(texts[pid] || ''); setCopyMsg('Copied ' + p.name); } catch { setCopyMsg('Copy failed'); }
                    setTimeout(() => setCopyMsg(''), 1500);
                  }}>⧉ Copy{copyMsg ? ` — ${copyMsg}` : ''}</button>
                  <button className="post-btn" disabled={!!busy[pid] || (pid === 'x' && (xLen > 280 || (x.pollOn && !!files.length)))} onClick={() => publishOne(pid)}>{busy[pid] ? 'Posting…' : `Post to ${p.name} →`}</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
        <div className="step-nav">
          <button className="skew-btn ghost" onClick={() => setStep(2)}><span>← Back to content</span></button>
          <span className="step-hint">Posts go live the second you press a button — nothing is scheduled.</span>
        </div>
      </div>
      )}
      <p className="note center">🔒 Direct post only · Your passwords/tokens stay locked in Supabase.</p>
    </div>
  );
}

function Accounts({ session, connections, setConnections }) {
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState('');
  const [search, setSearch] = useState(() => {
    try { return localStorage.getItem(`driftpost-acct-search:${session.user.id}`) || ''; }
    catch { return ''; }
  });
  const [activeOnly, setActiveOnly] = useState(() => {
    try { return localStorage.getItem(`driftpost-acct-filter:${session.user.id}`) === 'active'; }
    catch { return false; }
  });
  const [showHidden, setShowHidden] = useState(() => {
    try { return localStorage.getItem(`driftpost-acct-filter:${session.user.id}`) === 'hidden'; }
    catch { return false; }
  });
  useEffect(() => {
    try { localStorage.setItem(`driftpost-acct-search:${session.user.id}`, search); } catch {}
  }, [search, session.user.id]);
  useEffect(() => {
    try { localStorage.setItem(`driftpost-acct-filter:${session.user.id}`, showHidden ? 'hidden' : activeOnly ? 'active' : 'all'); } catch {}
  }, [showHidden, activeOnly, session.user.id]);
  const [hiddenSet, hideId, unhideId] = useLocalSet(`driftpost-hidden:${session.user.id}`);
  const [manualActive, markActive, unmarkActive] = useLocalSet(`driftpost-active:${session.user.id}`);

  const params = new URLSearchParams(window.location.search);
  useEffect(() => {
    if (params.get('connected')) { setMsg(`${params.get('connected')} connected.`); window.history.replaceState({}, '', window.location.pathname); }
    if (params.get('oauth_error')) { setMsg(`Connection failed: ${params.get('oauth_error')}`); window.history.replaceState({}, '', window.location.pathname); }
  }, []);

  const connect = async (platform) => {
    setBusy(platform); setMsg('');
    try {
      const data = await api(`/api/oauth/${platform}/start`, session.access_token, { method: 'POST' });
      window.location.assign(data.url);
    } catch (e) { setMsg(e.message); setBusy(''); }
  };

  const disconnect = async (id) => {
    setBusy(id);
    try {
      await api(`/api/connections/${id}`, session.access_token, { method: 'DELETE' });
      setConnections((c) => c.filter((x) => x.id !== id));
      setMsg('Disconnected.');
    } catch (e) { setMsg(e.message); }
    setBusy('');
  };

  const q = search.trim().toLowerCase();
  const matchFilters = (c) => {
    if (!showHidden && hiddenSet.has(c.id)) return false;
    if (showHidden && !hiddenSet.has(c.id)) return false;
    if (activeOnly && !isEffectiveActive(c, manualActive)) return false;
    if (q && !c.account_name.toLowerCase().includes(q)) return false;
    return true;
  };
  const visibleCount = connections.filter((c) => !hiddenSet.has(c.id)).length;

  return (
    <div className="card" style={{ maxWidth: 680 }}>
      <h3>Accounts</h3>
      <p className="sub">{visibleCount} visible · {hiddenSet.size} hidden · ★ = your active brands.</p>
      {msg && <div className="banner">{msg}</div>}
      <div className="row2" style={{ marginBottom: 6, alignItems: 'end' }}>
        <div className="messageBox"><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search brands…" /><span className="send">⌕</span></div>
        <label className="field" style={{ margin: 0 }}><span>Filter</span>
          <select value={showHidden ? 'hidden' : activeOnly ? 'active' : 'all'} onChange={(e) => { setShowHidden(e.target.value === 'hidden'); setActiveOnly(e.target.value === 'active'); }}>
            <option value="all">All accounts</option>
            <option value="active">Active brands only</option>
            <option value="hidden">Hidden</option>
          </select>
        </label>
      </div>
      {PLATFORMS.map((p) => {
        const list = connections.filter((c) => c.platform === p.id && matchFilters(c));
        const total = connections.filter((c) => c.platform === p.id).length;
        if (!showHidden && !q && !activeOnly && !list.length && !total) {
          return (
            <div key={p.id} className="list-row">
              <div><b style={{ fontSize: 13 }}>{p.name}</b><small style={{ display: 'block', color: '#6b6b6b' }}>Not connected</small></div>
              <span style={{ marginLeft: 'auto' }} />
              <button className="mini" disabled={!!busy} onClick={() => connect(p.id)}>{busy === p.id ? 'Opening…' : 'Connect'}</button>
            </div>
          );
        }
        if (!list.length) return null;
        return (
          <div key={p.id}>
            <div className="list-row">
              <div><b style={{ fontSize: 13 }}>{p.name}</b><small style={{ display: 'block', color: '#6b6b6b' }}>{list.length}{total !== list.length ? ` of ${total}` : ''} shown</small></div>
              <span style={{ marginLeft: 'auto' }} />
              <button className="mini" disabled={!!busy} onClick={() => connect(p.id)}>{busy === p.id ? 'Opening…' : 'Connect another'}</button>
            </div>
            {list.map((c) => {
              const effActive = isEffectiveActive(c, manualActive);
              const isHidden = hiddenSet.has(c.id);
              return (
              <div key={c.id} className="list-row">
                <span className="avatar">{(c.account_name || '?')[0].toUpperCase()}</span>
                <div><b style={{ fontSize: 13 }}>{c.account_name}</b><small style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#8b949e', marginTop: 2 }}><BrandIcon id={p.id} size={12} />{p.name}</small></div>
                {effActive && <span className="badge ok">★ Active</span>}
                <DotsMenu
                  active={effActive}
                  hidden={isHidden}
                  onToggleActive={() => { manualActive.has(c.id) ? unmarkActive(c.id) : markActive(c.id); }}
                  onToggleHidden={() => { isHidden ? unhideId(c.id) : hideId(c.id); }}
                />
                <button className="mini" disabled={!!busy} onClick={() => disconnect(c.id)}>Disconnect</button>
              </div>
              );
            })}
          </div>
        );
      })}
      <p className="note">Hide removes inactive brands from Compose without disconnecting. YouTube = Google OAuth · IG/FB = Meta · X = x.com.</p>
    </div>
  );
}

const TOUR_STEPS = [
  { t: 'Welcome to Driftpost', d: 'Post for all your brands from one screen. This 30-second tour shows you how — plain and simple.' },
  { t: 'Step 1 · Connect accounts', d: 'Open Accounts and connect YouTube, Facebook, Instagram and X. Each brand owner connects once, then it just works.' },
  { t: 'Step 2 · Pick your brand', d: 'Use the brand menu at the top. Driftpost automatically finds that brand on all 4 platforms. Star your active clients with the ⋯ menu.' },
  { t: 'Step 3 · Add photo and words', d: 'Drop one photo or video and write one caption. It fills every platform for you.' },
  { t: 'Step 4 · Adjust and publish', d: 'Each platform has its own card — YouTube titles, Instagram captions, Facebook links, X polls. Publish one by one, or press Publish all.' },
];

function TourOverlay({ step, setStep, onDone }) {
  const last = step === TOUR_STEPS.length - 1;
  return (
    <div className="tour-backdrop">
      <div className="tour-card">
        <div className="tour-count">Step {step + 1} of {TOUR_STEPS.length}</div>
        <h2>{TOUR_STEPS[step].t}</h2>
        <p>{TOUR_STEPS[step].d}</p>
        <div className="tour-dots">{TOUR_STEPS.map((_, i) => <span key={i} className={i === step ? 'on' : ''} />)}</div>
        <div className="tour-actions">
          {step > 0 && <button className="skew-btn ghost" onClick={() => setStep(step - 1)}><span>← Back</span></button>}
          <button className="skew-btn ghost" onClick={onDone}><span>Skip</span></button>
          <button className="skew-btn grad" onClick={() => (last ? onDone() : setStep(step + 1))}><span>{last ? 'Start posting →' : 'Next →'}</span></button>
        </div>
      </div>
    </div>
  );
}

export default function Console({ session, onSwitchAccount, onSignOut }) {
  // Same page after refresh: the console reopens on Compose or Accounts,
  // whichever the user was on.
  const [view, setView] = useState(() => {
    try {
      return localStorage.getItem(`driftpost-view:${session.user.id}`) === 'accounts' ? 'accounts' : 'create';
    } catch { return 'create'; }
  });
  useEffect(() => {
    try { localStorage.setItem(`driftpost-view:${session.user.id}`, view); } catch {}
  }, [view, session.user.id]);
  const [navOpen, setNavOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [theme, setTheme] = useTheme();
  const [copyMsg, setCopyMsg] = useState('');
  const [connections, setConnections] = useState([]);
  const [tour, setTour] = useState(null); // null | 'ask' | number (step index)

  const reloadConnections = () => api('/api/connections', session.access_token).then((d) => setConnections(d.connections || [])).catch(() => {});

  useEffect(() => { reloadConnections(); }, [session]);

  useEffect(() => {
    if (tour === null && !localStorage.getItem(`driftpost-tour:${session.user.id}`)) {
      setTour('ask');
    }
  }, []);

  const finishTour = () => {
    try { localStorage.setItem(`driftpost-tour:${session.user.id}`, '1'); } catch {}
    setTour(null);
  };

  const counts = useMemo(() => {
    const c = {};
    connections.forEach((x) => { c[x.platform] = (c[x.platform] || 0) + 1; });
    return c;
  }, [connections]);

  useEffect(() => {
    document.title = view === 'accounts' ? 'Accounts · Driftpost' : 'Platforms · Driftpost';
    document.querySelector('meta[name="robots"]')?.setAttribute('content', 'noindex, nofollow');
  }, [view]);

  const signOutTo = async (where) => {
    try { (await getSupabase())?.auth.signOut(); } catch {}
    setUserOpen(false);
    if (where === 'auth') onSwitchAccount();
    else onSignOut();
  };

  if (!['create', 'accounts'].includes(view)) {
    return (
      <div className="shell">
        <div className="page"><div className="card"><h3>404 — lost in the flow</h3><p className="sub">That view does not exist.</p><button className="skew-btn grad" onClick={() => setView('create')}><span>← Back to Platforms</span></button></div></div>
      </div>
    );
  }

  return (
    <div className="shell">
      {tour === 'ask' && (
        <div className="tour-backdrop">
          <div className="tour-card">
            <h2>New here?</h2>
            <p>Take the 30-second tour and posting will feel obvious. Or skip and explore yourself.</p>
            <div className="tour-actions">
              <button className="skew-btn ghost" onClick={finishTour}><span>Continue</span></button>
              <button className="skew-btn grad" onClick={() => setTour(0)}><span>Get the tour →</span></button>
            </div>
          </div>
        </div>
      )}
      {typeof tour === 'number' && <TourOverlay step={tour} setStep={setTour} onDone={finishTour} />}
      <aside className={navOpen ? 'side open' : 'side'}>
        <button className="brand brand-btn" onClick={() => { setView('create'); setNavOpen(false); }} title="Driftpost home"><img className="logo-img logo-d" src="/logo-dark.png" width="1984" height="512" alt="Driftpost" /><img className="logo-img logo-l" src="/logo-light.png" width="1908" height="512" alt="Driftpost" /></button>
        <div className="radio-container">
          <input type="radio" name="side-nav" id="nav-compose" checked={view === 'create'} onChange={() => { setView('create'); setNavOpen(false); }} />
          <label htmlFor="nav-compose">Compose</label>
          <input type="radio" name="side-nav" id="nav-accounts" checked={view === 'accounts'} onChange={() => { setView('accounts'); setNavOpen(false); }} />
          <label htmlFor="nav-accounts">Accounts <em>{connections.length}</em></label>
          <div className="glider-container"><div className="glider" /></div>
        </div>
        <div className="side-foot">
          <div className="pro-card" style={{ background: '#101838', border: '1px solid #2c3d66', padding: 12, fontSize: 11, color: '#aeb9d8' }}>
            YouTube {counts.youtube || 0} · IG {counts.instagram || 0} · FB {counts.facebook || 0} · X {counts.x || 0}
          </div>
          <div className="user-chip" onClick={() => setUserOpen((o) => !o)} title="Account & theme">
            <span className="avatar">{(session.user.email || '?')[0].toUpperCase()}</span>
            <span><b style={{ fontSize: 12 }}>{session.user.email?.split('@')[0]}</b><small>{session.user.email}</small></span>
            {userOpen && <>
              <span className="dd-backdrop" onClick={(e) => { e.stopPropagation(); setUserOpen(false); }} />
              <span className="user-menu" onClick={(e) => e.stopPropagation()}>
                <span className="um-head">
                  <span className="avatar">{(session.user.email || '?')[0].toUpperCase()}</span>
                  <span><b>{session.user.email?.split('@')[0]}</b><small>{session.user.email}</small></span>
                </span>
                <div className="um-label">Website colors</div>
                <div className="swatches">
                  {THEMES.map((t) => (
                    <button key={t.id} title={t.label} className={theme === t.id ? `swatch sw-${t.id} sel` : `swatch sw-${t.id}`} onClick={() => setTheme(t.id)} />
                  ))}
                  <span className="sw-name">{THEMES.find((t) => t.id === theme)?.label}</span>
                </div>
                <button onClick={() => { try { navigator.clipboard.writeText(session.user.email); setCopyMsg('Email copied'); } catch { setCopyMsg('Copy failed'); } setTimeout(() => setCopyMsg(''), 1500); }}>⧉ Copy email{copyMsg ? ` — ${copyMsg}` : ''}</button>
                <button onClick={() => signOutTo('auth')}>⇄ Switch account</button>
                <button onClick={() => signOutTo('landing')}>⏻ Sign out</button>
                <button style={{ color: '#e5484d' }} onClick={async () => {
                  if (!window.confirm('Delete your Driftpost account? This removes all connections, history and your login. This cannot be undone.')) return;
                  if (!window.confirm('Last check — really delete everything?')) return;
                  try {
                    await api('/api/account', session.access_token, { method: 'DELETE' });
                  } catch (e) { alert(e.message); return; }
                  try { (await getSupabase())?.auth.signOut(); } catch {}
                  onSignOut();
                }}>🗑 Delete account…</button>
              </span>
            </>}
          </div>
        </div>
      </aside>
      {navOpen && <div className="scrim" onClick={() => setNavOpen(false)} />}
      <div className="main">
        <div className="top">
          <button className="menu-btn" onClick={() => setNavOpen(true)} aria-label="Open menu">☰</button>
          <div><h1>{view === 'create' ? 'Platforms' : 'Accounts'}</h1><p>Pick a brand, post everywhere — no tech skills needed</p></div>
          <button className="mini" title="Replay the guided tour" onClick={() => setTour(0)}>◉ Tour</button>
        </div>
        <div className="page">
          {view === 'create'
            ? <Composer session={session} connections={connections} reload={reloadConnections} />
            : <Accounts session={session} connections={connections} setConnections={setConnections} />}
        </div>
        <footer className="foot">
          <span>© {new Date().getFullYear()} Driftpost</span>
          <span className="foot-links">
            <a href="https://github.com/FamebrosStudio/Driftpost" target="_blank" rel="noreferrer">GitHub</a>
            <a href="https://driftpost.onrender.com/health" target="_blank" rel="noreferrer">API status</a>
            <a href="https://driftpostpage.vercel.app">Home</a>
          </span>
        </footer>
      </div>
    </div>
  );
}
