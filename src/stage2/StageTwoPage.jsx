import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { api, groupBrands, PLATFORMS } from '../lib.js';
import ProgressStepper from './ProgressStepper.jsx';
import MediaUploader from './MediaUploader.jsx';
import MediaGallery from './MediaGallery.jsx';
import PromptBuilder from './PromptBuilder.jsx';
import OutputContainer from './OutputContainer.jsx';
import ContinueButton from './ContinueButton.jsx';
import './stage2.css';

const MediaEditor = lazy(() => import('./MediaEditor.jsx'));

const GEN_STEPS = ['Analyzing media…', 'Understanding brand…', 'Creating content…', 'Finalizing outputs…'];

function load(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ?? fallback;
  } catch { return fallback; }
}
function save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

// Tiny IndexedDB vault: uploads survive refresh. Same-origin, per-user key.
function idbOpen() {
  return new Promise((res, rej) => {
    try {
      const r = indexedDB.open('driftpost-stage2', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('media');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    } catch (e) { rej(e); }
  });
}
async function idbSet(k, v) {
  try {
    const db = await idbOpen();
    await new Promise((res, rej) => {
      const tx = db.transaction('media', 'readwrite');
      tx.objectStore('media').put(v, k);
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
    db.close();
  } catch {}
}
async function idbGet(k) {
  try {
    const db = await idbOpen();
    const v = await new Promise((res, rej) => {
      const tx = db.transaction('media', 'readonly');
      const rq = tx.objectStore('media').get(k);
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
    db.close();
    return v ?? null;
  } catch { return null; }
}

export default function StageTwoPage({ session, onBack, onSignOut }) {
  const [connections, setConnections] = useState([]);
  const [files, setFiles] = useState([]);
  const [brief, setBrief] = useState(() => load('driftpost-stage2-brief', ''));
  const [tone, setTone] = useState(() => load('driftpost-stage2-tone', 'auto'));
  const [emoji, setEmoji] = useState(() => load('driftpost-stage2-emoji', 'medium'));
  const [length, setLength] = useState(() => load('driftpost-stage2-length', 'medium'));
  const [outputs, setOutputs] = useState(() => load('driftpost-stage2-outputs', {}));
  const [busy, setBusy] = useState(false);
  const [genStep, setGenStep] = useState(0);
  const [aiMsg, setAiMsg] = useState('');
  const [editing, setEditing] = useState(-1);
  const [saveTick, setSaveTick] = useState(false);

  useEffect(() => { document.title = 'Stage 2 · Driftpost'; }, []);
  useEffect(() => {
    let live = true;
    api('/api/connections', session.access_token)
      .then((d) => { if (live) setConnections(d.connections || []); })
      .catch(() => {});
    return () => { live = false; };
  }, [session]);

  // Media vault: restore once, save on change.
  const mediaKey = `driftpost-stage2-media:${session.user.id}`;
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    (async () => {
      const vault = await idbGet(mediaKey);
      const list = (vault?.files || [])
        .filter((f) => f.blob instanceof Blob)
        .map((f) => {
          const raw = f.blob instanceof File ? f.blob : new File([f.blob], f.name || 'media', { type: f.type || 'image/jpeg' });
          return { raw, name: f.name || raw.name, size: `${(raw.size / 1024 / 1024).toFixed(1)} MB`, type: raw.type };
        });
      if (list.length) setFiles(list);
    })();
  }, [mediaKey]);
  useEffect(() => {
    idbSet(mediaKey, {
      files: files.map((f) => ({ name: f.name, type: f.type, blob: f.raw })).filter((f) => f.blob instanceof Blob),
    });
  }, [mediaKey, files]);

  useEffect(() => { save('driftpost-stage2-brief', brief); }, [brief]);
  useEffect(() => { save('driftpost-stage2-tone', tone); }, [tone]);
  useEffect(() => { save('driftpost-stage2-emoji', emoji); }, [emoji]);
  useEffect(() => { save('driftpost-stage2-length', length); }, [length]);

  // Stage 1 selections drive everything here.
  const s1 = useMemo(() => ({
    type: load('driftpost-stage1-type', ''),
    brandKey: load('driftpost-stage1-brand', ''),
    platforms: load('driftpost-stage1-platforms', []),
    groups: load('driftpost-groups', []),
    groupId: load('driftpost-stage1-group', ''),
  }), []);
  const brands = useMemo(() => groupBrands(connections), [connections]);
  const brand = brands.find((b) => b.key === s1.brandKey) || null;
  const connById = useMemo(() => Object.fromEntries(connections.map((c) => [c.id, c])), [connections]);
  const platsOf = (ids) => [...new Set((ids || []).map((id) => connById[id]?.platform).filter(Boolean))];

  const targetPlatforms = useMemo(() => {
    const order = PLATFORMS.map((p) => p.id);
    let list = [];
    if (s1.type === 'common_brand' && brand) list = Object.keys(brand.map || {});
    else if (s1.type === 'platform_selection') list = s1.platforms || [];
    else if (s1.type === 'create_groups') list = (s1.groups || []).flatMap((g) => platsOf(g.accountIds));
    else if (s1.type === 'existing_groups') {
      const g = (s1.groups || []).find((x) => x.id === s1.groupId);
      list = g ? platsOf(g.accountIds) : [];
    }
    return order.filter((pid) => list.includes(pid));
  }, [s1, brand, connById]);
  const brandLabel = s1.type === 'common_brand' ? brand?.label || '' : '';

  const addFiles = (list) => {
    const room = Math.max(0, 10 - files.length);
    const mapped = list.slice(0, room).map((f) => ({
      raw: f, name: f.name, size: `${(f.size / 1024 / 1024).toFixed(1)} MB`, type: f.type,
    }));
    if (mapped.length) setFiles((fs) => [...fs, ...mapped]);
  };
  const removeAt = (i) => {
    setFiles((fs) => fs.filter((_, j) => j !== i));
    if (editing === i) setEditing(-1);
  };
  const applyEditAt = (i, outFile) => {
    setFiles((fs) => fs.map((f, j) => (j === i
      ? { raw: outFile, name: outFile.name, size: `${(outFile.size / 1024 / 1024).toFixed(1)} MB`, type: outFile.type }
      : f)));
    setEditing(-1);
  };

  const generate = async () => {
    if (busy || !brief.trim() || !targetPlatforms.length) return;
    setBusy(true); setAiMsg(''); setGenStep(0);
    const tick = setInterval(() => setGenStep((s) => (s + 1) % GEN_STEPS.length), 1400);
    try {
      const data = await api('/api/ai/captions', session.access_token, {
        method: 'POST',
        body: JSON.stringify({
          summary: brief,
          brand: brandLabel,
          asset_description: files.length ? `${files.length} x ${files[0].type}` : '',
          goal: 'enquiries',
          trends: false,
          tone, emoji, length,
        }),
      });
      const c = data.captions || data;
      const ytTags = Array.isArray(c.youtube?.tags) ? c.youtube.tags.join(', ') : (c.youtube?.tags || '');
      const igTags = Array.isArray(c.instagram?.hashtags) ? c.instagram.hashtags.join(' ') : (c.instagram?.hashtags || '');
      const xText = typeof c.x?.text === 'string' ? c.x.text.slice(0, 280) : '';
      const next = { ...outputs };
      if (targetPlatforms.includes('instagram')) next.instagram = { caption: c.instagram?.caption || '', hashtags: igTags };
      if (targetPlatforms.includes('facebook')) next.facebook = { message: c.facebook?.message || '' };
      if (targetPlatforms.includes('youtube')) next.youtube = { title: c.youtube?.title || '', description: c.youtube?.description || '', tags: ytTags };
      if (targetPlatforms.includes('x')) next.x = { text: xText };
      setOutputs(next);
      save('driftpost-stage2-outputs', next);
      setAiMsg('Done — review each platform card below. Edit anything, it saves.');
    } catch (e) {
      setAiMsg(e.message || 'Generation failed.');
    }
    clearInterval(tick);
    setBusy(false);
  };

  const saveOutput = (pid, values) => {
    setOutputs((o) => { const n = { ...o, [pid]: values }; save('driftpost-stage2-outputs', n); return n; });
  };

  const hasOutputs = targetPlatforms.some((pid) => {
    const v = outputs[pid] || {};
    return Object.values(v).some((x) => String(x || '').trim());
  });
  const canContinue = files.length > 0 || hasOutputs;
  const cont = () => {
    save('driftpost-stage2-done', true);
    setSaveTick(true);
    setTimeout(() => setSaveTick(false), 1600);
  };

  return (
    <div className="stage2">
      <div className="stage2-in">
        <div className="s2-top">
          <button type="button" className="s2-back" onClick={onBack}>← Stage 1</button>
          <button type="button" className="s2-signout" onClick={onSignOut}>Sign out</button>
        </div>
        <header className="s2-head">
          <span className="s2-badge">Stage 2 of 3</span>
          <h1>Create Your Content</h1>
          <p>Upload your media, customize your format and let AI create platform-ready content.</p>
        </header>
        <ProgressStepper current={2} />

        <section className="s2-sec" aria-label="Add media">
          <div className="s2-sec-head">
            <h2>Add media</h2>
            <span className="s2-count">{files.length}/10</span>
          </div>
          <p className="sub">Images or video — shown on every selected platform. Tap Edit on a photo to crop it.</p>
          <MediaUploader count={files.length} onFiles={addFiles} />
          <MediaGallery files={files} onRemove={removeAt} onEdit={setEditing} />
        </section>

        <section className="s2-sec" aria-label="Write prompt">
          <h2>Write prompt</h2>
          <p className="sub">Tell AI what to create{brandLabel ? ` for ${brandLabel}` : ''}. One prompt, tuned per platform.</p>
          <PromptBuilder
            brief={brief} setBrief={setBrief}
            tone={tone} setTone={setTone} emoji={emoji} setEmoji={setEmoji} length={length} setLength={setLength}
            busy={busy} canGenerate={!!brief.trim() && !!targetPlatforms.length} onGenerate={generate}
          />
          {!targetPlatforms.length && (
            <p className="s2-msg err">No platforms from Stage 1 — go back and finish Stage 1 first.</p>
          )}
          {busy && (
            <div className="s2-status" aria-live="polite">
              <div className="s2-bar"><i style={{ width: `${((genStep + 1) / GEN_STEPS.length) * 100}%` }} /></div>
              <span>{GEN_STEPS[genStep]}</span>
            </div>
          )}
          {!busy && aiMsg && (
            <p className={/done —/i.test(aiMsg) ? 's2-msg ok' : 's2-msg err'}>{aiMsg}</p>
          )}
        </section>

        {targetPlatforms.length > 0 && (
          <section className="s2-sec" aria-label="AI output">
            <div className="s2-sec-head">
              <h2>AI output</h2>
              <span className="s2-count">{targetPlatforms.length} platform{targetPlatforms.length === 1 ? '' : 's'}</span>
            </div>
            <p className="sub">Different output per platform — only the ones you selected in Stage 1.</p>
            {!hasOutputs && !busy && <p className="s2-msg ok">Nothing here yet — write a prompt above and press Generate Content.</p>}
            <OutputContainer platforms={targetPlatforms} outputs={outputs} onSave={saveOutput} />
          </section>
        )}
      </div>
      <ContinueButton disabled={!canContinue} saved={saveTick} onClick={cont} />
      {editing >= 0 && files[editing] && (
        <Suspense fallback={null}>
          <MediaEditor entry={files[editing]} onClose={() => setEditing(-1)} onApply={(f) => applyEditAt(editing, f)} />
        </Suspense>
      )}
    </div>
  );
}
