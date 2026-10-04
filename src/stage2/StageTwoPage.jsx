import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { api, groupBrands, PLATFORMS } from '../lib.js';
import ProgressStepper from './ProgressStepper.jsx';
import MediaUploader from './MediaUploader.jsx';
import MediaGallery from './MediaGallery.jsx';
import PromptBuilder from './PromptBuilder.jsx';
import { composeOutput } from './PlatformOutputCard.jsx';
import { logCaptions } from '../history/log.js';
import { readVault, updateVault, vaultFiles } from './mediaVault.js';
import { requestCaptions as fetchCaptions, mapResponse } from './ai.js';
import CrosspostToggle from './CrosspostToggle.jsx';
import OutputContainer from './OutputContainer.jsx';
import ContinueButton from './ContinueButton.jsx';
import PageLoading from '../PageLoading.jsx';
import './stage2.css';
import { WorkspaceNav } from '../workspace/Workspace.jsx';
import { hasAiAccess } from '../ai-access.js';

const MediaEditor = lazy(() => import('./MediaEditor.jsx'));

// No answer cache. An earlier version replayed the last answer for 24h on an
// identical prompt, which made Regenerate look broken. Gone for good.

function load(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v ?? fallback;
  } catch { return fallback; }
}
function save(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}
const scopedKey = (key, userId) => `${key}:${userId}`;



export default function StageTwoPage({ session, onBack, onSignOut, onNavigate, onNext }) {
  const userId = session.user.id;
  const canUseAi = hasAiAccess(session);
  const [connections, setConnections] = useState([]);
  const [files, setFiles] = useState([]);
  const [brief, setBrief] = useState(() => load(scopedKey('driftpost-stage2-brief', userId), ''));
  const [tone, setTone] = useState(() => load(scopedKey('driftpost-stage2-tone', userId), 'auto'));
  const [emoji, setEmoji] = useState(() => load(scopedKey('driftpost-stage2-emoji', userId), 'medium'));
  const [length, setLength] = useState(() => load(scopedKey('driftpost-stage2-length', userId), 'medium'));
  const [analysis, setAnalysis] = useState(() => load(scopedKey('driftpost-stage2-analysis', userId), 'fast'));
  const [outputs, setOutputs] = useState(() => load(scopedKey('driftpost-stage2-outputs', userId), {}));
  const [busy, setBusy] = useState(false);
  const [aiMsg, setAiMsg] = useState('');
  const [aiMsgKind, setAiMsgKind] = useState('ok');
  const say = (msg, kind = 'ok') => { setAiMsg(msg); setAiMsgKind(kind); };
  const [crosspost, setCrosspost] = useState(() => load('driftpost-stage2-crosspost', false));
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
      const list = vaultFiles(await readVault(mediaKey));
      if (list.length) setFiles(list);
    })();
  }, [mediaKey]);
  useEffect(() => {
    // Preserve the YouTube cover (written by Stage 3) across saves.
    updateVault(mediaKey, (prev) => ({
      ...(prev || {}),
      thumb: prev?.thumb || null,
      coverMap: prev?.coverMap || {},
      files: files.map((f) => ({
        name: f.name,
        type: f.type,
        blob: f.raw,
        musicOriginalRaw: f.musicOriginalRaw instanceof Blob ? f.musicOriginalRaw : null,
        musicTrack: f.musicTrack || null,
      })).filter((f) => f.blob instanceof Blob),
    }));
  }, [mediaKey, files]);

  useEffect(() => { save(scopedKey('driftpost-stage2-brief', userId), brief); }, [brief, userId]);
  useEffect(() => { save(scopedKey('driftpost-stage2-tone', userId), tone); }, [tone, userId]);
  useEffect(() => { save(scopedKey('driftpost-stage2-emoji', userId), emoji); }, [emoji, userId]);
  useEffect(() => { save(scopedKey('driftpost-stage2-length', userId), length); }, [length, userId]);
  useEffect(() => { save(scopedKey('driftpost-stage2-analysis', userId), analysis); }, [analysis, userId]);

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
  const crosspostOn = crosspost && basePlatforms.includes('instagram') && basePlatforms.includes('facebook');
  // Cross-post ON: Facebook auto-posts via Instagram — hide its card so
  // nobody tunes (or double-posts) it.
  const targetPlatforms = crosspostOn ? basePlatforms.filter((pid) => pid !== 'facebook') : basePlatforms;
  const setCrosspostSaved = (v) => { setCrosspost(v); save('driftpost-stage2-crosspost', v); };
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
  const applyMusicAt = (i, outFile, track) => {
    setFiles((fs) => fs.map((f, j) => j === i
      ? {
        raw: outFile,
        musicOriginalRaw: f.musicOriginalRaw || f.raw,
        musicTrack: track ? { id: track.id, title: track.title, name: track.name, artists: track.artists, mainArtists: track.mainArtists } : f.musicTrack,
        name: outFile.name,
        size: `${(outFile.size / 1024 / 1024).toFixed(1)} MB`,
        type: outFile.type,
      }
      : f));
  };
  const removeMusicAt = (i) => {
    setFiles((fs) => fs.map((f, j) => {
      if (j !== i || !f.musicOriginalRaw) return f;
      const raw = f.musicOriginalRaw;
      return { raw, name: raw.name || f.name.replace(/-with-music\.mp4$/i, ''), size: `${(raw.size / 1024 / 1024).toFixed(1)} MB`, type: raw.type };
    }));
  };
  const requestCaptions = (pid) => fetchCaptions(session.access_token, {
    brief, brand: brandLabel, files, tone, emoji, length, analysis,
    ...(pid ? { only: pid } : targetPlatforms.length === 1 ? { only: targetPlatforms[0] } : {}),
  });

  const applyMapped = (mapped, pids) => {
    setOutputs((prev) => {
      const next = { ...prev };
      pids.forEach((pid) => { next[pid] = mapped[pid]; });
      save(scopedKey('driftpost-stage2-outputs', userId), next);
      return next;
    });
  };

  // Same-tick double clicks slip past state guards — sync ref claims make
  // Generate/Regen fire exactly once (each run also costs AI credits).
  const firing = useRef(new Set());
  const claim = (k) => { if (firing.current.has(k)) return false; firing.current.add(k); return true; };
  const release = (k) => { firing.current.delete(k); };

  const generate = async () => {
    const hasMedia = files.length > 0;
    if (!canUseAi || busy || regen || (!brief.trim() && !(analysis === 'analyze' && hasMedia)) || !targetPlatforms.length || !claim('gen')) return;
    setBusy(true); setAiMsg('');
    try {
      const data = await requestCaptions();
      const mapped = mapResponse(data);
      applyMapped(mapped, targetPlatforms);
      logCaptions({ userId, brand: brandLabel, entries: targetPlatforms.map((pid) => ({ platform: pid, text: composeOutput(pid, mapped[pid]) })) });
      const saved = data.captionMemoryStatus === 'saved'
        ? 'All generated captions were saved to your private account memory; reviewed captions will guide future examples.'
        : data.captionMemoryStatus === 'unavailable'
          ? 'Your captions are in local History, but account learning could not confirm a save.'
          : 'Your captions are saved in local History. Opt in to personalisation to save and reuse account examples.';
      const mediaNote = data.videoAnalysisWarning ? ` ${data.videoAnalysisWarning}` : '';
      say(`Done — review each platform card below. ${saved}${mediaNote}`, data.captionMemoryStatus === 'unavailable' ? 'err' : data.videoAnalysisWarning ? 'warn' : 'ok');
    } catch (e) {
      say(e.message || 'Generation failed.', 'err');
    } finally {
      release('gen');
      setBusy(false);
    }
  };

  // Per-card regenerate: same prompt, ONE card from the server (fast), only
  // that card changes. An empty answer keeps the old card, never wipes it.
  const [regen, setRegen] = useState('');
  const regenOne = async (pid) => {
    const hasMedia = files.length > 0;
    if (!canUseAi || busy || regen || (!brief.trim() && !(analysis === 'analyze' && hasMedia)) || !claim(`regen:${pid}`)) return;
    setRegen(pid); setAiMsg('');
    try {
      const data = await requestCaptions(pid);
      const mapped = mapResponse(data);
      applyMapped(mapped, [pid]);
      logCaptions({ userId, brand: brandLabel, entries: [{ platform: pid, text: composeOutput(pid, mapped[pid]) }] });
      const saved = data.captionMemoryStatus === 'saved'
        ? 'Saved to your account memory.'
        : data.captionMemoryStatus === 'unavailable'
          ? 'Account memory could not confirm the save.'
          : 'Saved in local History; personalisation memory is off.';
      say(`Regenerated ${pid} — review the card. ${saved}`, data.captionMemoryStatus === 'unavailable' ? 'err' : 'ok');
    } catch (e) {
      say(e.message || 'Regeneration failed.', 'err');
    } finally {
      release(`regen:${pid}`);
      setRegen('');
    }
  };

  const saveOutput = (pid, values) => {
    setOutputs((o) => { const n = { ...o, [pid]: values }; save(scopedKey('driftpost-stage2-outputs', userId), n); return n; });
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
    if (onNext) onNext();
  };

  return (
    <div className="stage2">
      {onNavigate && <WorkspaceNav page="create" onNavigate={onNavigate} email={session.user?.email} onSignOut={onSignOut} />}
      <div className="stage2-in">
        <div className="s2-top">
          <button type="button" className="s2-back" onClick={onBack}>← Stage 1</button>
        </div>
        <header className="s2-head">
          <span className="s2-badge">Stage 2 of 3</span>
          <h1>Create Your Content</h1>
          <p>{canUseAi ? 'Upload your media, customize your format and let AI create platform-ready content.' : 'Upload your media and prepare platform-ready drafts to review before posting.'}</p>
        </header>
        <ProgressStepper current={2} />

        <section className="s2-sec" aria-label="Add media">
          <div className="s2-sec-head">
            <h2>Add media</h2>
            <span className="s2-count">{files.length}/10</span>
          </div>
          <p className="sub">Images or video — shown on every selected platform. Tap Edit on a photo or video to crop it.</p>
          <MediaUploader count={files.length} onFiles={addFiles} canUseAi={canUseAi} />
          <MediaGallery files={files} onRemove={removeAt} onEdit={setEditing} />
        </section>

        <section className="s2-sec" aria-label={canUseAi ? 'Write prompt' : 'Write content'}>
          <h2>{canUseAi ? 'Write prompt' : 'Write your content'}</h2>
          {canUseAi ? <>
          <p className="sub">Tell AI what to create{brandLabel ? ` for ${brandLabel}` : ''}. One prompt, tuned per platform.</p>
          <PromptBuilder
            brief={brief} setBrief={setBrief}
            tone={tone} setTone={setTone} emoji={emoji} setEmoji={setEmoji} length={length} setLength={setLength}
            busy={busy} analysis={analysis} setAnalysis={setAnalysis}
            canGenerate={(!!brief.trim() || (analysis === 'analyze' && files.length > 0)) && !!targetPlatforms.length} onGenerate={generate}
          />
          </> : <p className="sub">Edit each platform draft below, or continue with your own prepared captions.</p>}
          {!targetPlatforms.length && (
            <p className="s2-msg err">No platforms from Stage 1 — go back and finish Stage 1 first.</p>
          )}
          {busy && (
            <div className="s2-status" aria-live="polite">
              <div className="s2-bar"><i /></div>
              <span>{analysis === 'analyze'
                ? files.some((f) => f.raw?.type?.startsWith('video/')) ? 'Analyzing media and transcribing video audio… This can take longer.' : 'Analyzing your photos and writing captions…'
                : 'Writing captions…'}</span>
            </div>
          )}
          {!busy && aiMsg && (
            <p className={`s2-msg ${aiMsgKind === 'err' ? 'err' : aiMsgKind === 'warn' ? 'warn' : 'ok'}`} role={aiMsgKind === 'err' ? 'alert' : 'status'}>{aiMsg}</p>
          )}
        </section>

        {basePlatforms.includes('instagram') && basePlatforms.includes('facebook') && (
          <CrosspostToggle on={crosspostOn} onChange={setCrosspostSaved} />
        )}

        {targetPlatforms.length > 0 && (
          <section className="s2-sec" aria-label={canUseAi ? 'AI output' : 'Platform drafts'}>
            <div className="s2-sec-head">
              <h2>{canUseAi ? 'AI output' : 'Platform drafts'}</h2>
              <span className="s2-count">{targetPlatforms.length} platform{targetPlatforms.length === 1 ? '' : 's'}</span>
            </div>
            <p className="sub">Different output per platform — only the ones you selected in Stage 1.{crosspostOn ? ' Facebook hides here: it auto-posts through Instagram cross-post.' : ''}</p>
            {!hasOutputs && !busy && <p className="s2-msg ok">{canUseAi ? "Nothing here yet - write a prompt above and press Generate Content." : "Use Edit on a platform card to add your post text."}</p>}
            <OutputContainer platforms={targetPlatforms} outputs={outputs} onSave={saveOutput} regen={regen} onRegen={canUseAi ? regenOne : undefined} busy={busy} />
          </section>
        )}
      </div>
      <ContinueButton disabled={!canContinue} saved={saveTick} onClick={cont} />
      {editing >= 0 && files[editing] && (
        <Suspense fallback={<PageLoading label="Loading media editor…" />}>
          <MediaEditor entry={files[editing]} token={session.access_token} onClose={() => setEditing(-1)} onApply={(f) => applyEditAt(editing, f)} onApplyMusic={(f, track) => applyMusicAt(editing, f, track)} onRemoveMusic={() => removeMusicAt(editing)} />
        </Suspense>
      )}
    </div>
  );
}
