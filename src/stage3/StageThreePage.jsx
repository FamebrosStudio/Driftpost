import React, { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { api, apiUrl, groupBrands, PLATFORMS, resetPostState, schedulePost } from '../lib.js';
import { readVault, writeVault, vaultFiles } from '../stage2/mediaVault.js';
import { requestCaptions, mapResponse } from '../stage2/ai.js';
import { composeOutput } from '../stage2/PlatformOutputCard.jsx';
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
  const [schedMsg, setSchedMsg] = useState('');

  useEffect(() => { document.title = 'Stage 3 · Driftpost'; }, []);
  useEffect(() => {
    let live = true;
    api('/api/connections', session.access_token)
      .then((d) => { if (live) setConnections(d.connections || []); })
      .catch(() => {});
    return () => { live = false; };
  }, [session]);

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

  const basePlatforms = useMemo(() => {
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
  // Stage 2 cross-post already routes Facebook through Instagram.
  const platforms = (s1.crosspost && basePlatforms.includes('instagram') && basePlatforms.includes('facebook'))
    ? basePlatforms.filter((pid) => pid !== 'facebook')
    : basePlatforms;
  const brandLabel = s1.type === 'common_brand' ? brand?.label || '' : '';

  useEffect(() => {
    if (!platforms.includes(tab)) setTab(platforms[0] || '');
  }, [platforms, tab]);

  const cfgFor = (pid) => ({ ...(DEFAULT_CFG[pid] || {}), ...(cfg[pid] || {}) });
  const accountsFor = (pid) => connections.filter((c) => c.platform === pid);
  const groupFirst = (pid) => {
    let ids = [];
    if (s1.type === 'existing_groups') {
      const g = (s1.groups || []).find((x) => x.id === s1.groupId);
      ids = g?.accountIds || [];
    } else if (s1.type === 'create_groups') {
      ids = (s1.groups || []).flatMap((g) => g.accountIds || []);
    }
    const hit = ids.map((id) => connById[id]).find((c) => c && c.platform === pid);
    return hit?.id || '';
  };
  const accountFor = (pid) => {
    const o = overrides[pid];
    if (o && connById[o]?.platform === pid) return o;
    if (s1.type === 'common_brand' && brand?.map?.[pid] && connById[brand.map[pid]]) return brand.map[pid];
    return groupFirst(pid) || accountsFor(pid)[0]?.id || '';
  };

  // Cross-post mutual exclusion: posting IG→FB and FB→IG together would
  // double-post, so the other side greys out and leaves publish-all.
  const greyed = (pid) => {
    if (pid === 'facebook' && platforms.includes('instagram') && cfgFor('instagram').shareFb) return true;
    if (pid === 'instagram' && platforms.includes('facebook') && cfgFor('facebook').syndIg) return true;
    return false;
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
  const onReviewed = (pid) => setReviewed((r) => { const n = { ...r, [pid]: true }; save('driftpost-stage3-reviewed', n); return n; });

  const regenOne = async (pid) => {
    if (busy[pid] || regen || !brief.trim()) return;
    setRegen(pid);
    try {
      const data = await requestCaptions(session.access_token, {
        brief, brand: brandLabel, files,
        tone: s1.tone, emoji: s1.emoji, length: s1.length,
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

  const buildForm = (pid, { connectionId = null, skipCrossPost = false } = {}) => {
    const body = bodyFor(pid, { skipCrossPost });
    if (connectionId) body.connection_id = connectionId;
    const form = new FormData();
    for (const [k, v] of Object.entries(body)) form.append(k, v);
    for (const f of files.slice(0, 10)) { if (f?.raw) form.append('media', f.raw); }
    if (pid === 'youtube' && thumb?.raw) form.append('thumbnail', thumb.raw);
    return form;
  };

  const runOne = async (pid, out, { connectionId = null, key = null, skipCrossPost = false } = {}) => {
    const k = key || pid;
    out[k] = { state: 'uploading', progress: 5 };
    setResults({ ...out });
    const res = await fetch(`${apiUrl}/api/publish`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.access_token}` },
      body: buildForm(pid, { connectionId, skipCrossPost }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Publish failed');
    const jobId = data.job.id;
    for (;;) {
      await new Promise((r) => setTimeout(r, 1500));
      const j = await api(`/api/jobs/${jobId}`, session.access_token);
      out[k] = { state: j.job.state, progress: j.job.progress || 50, url: j.job.url, message: j.job.message };
      setResults({ ...out });
      if (j.job.state === 'completed') {
        logPost({ platform: pid, text: mainText(pid), url: j.job.url });
        onReviewed(pid);
        return;
      }
      if (j.job.state === 'failed') throw new Error(j.job.message);
    }
  };

  const publishOne = async (pid) => {
    if (busy[pid] || greyed(pid) || !accountFor(pid)) return;
    setBusy((b) => ({ ...b, [pid]: true }));
    const out = { ...results };
    try { await runOne(pid, out); }
    catch (e) { out[pid] = { state: 'failed', message: e.message }; setResults({ ...out }); }
    setBusy((b) => ({ ...b, [pid]: false }));
  };

  const publishAll = async () => {
    const targets = effective.filter((pid) => accountFor(pid));
    if (!targets.length || targets.some((pid) => busy[pid])) return;
    const out = { ...results };
    // Direct posts only (mirrors stripped) — unless global cross-post routes
    // Facebook through Instagram, which must keep its share flag.
    const strip = !(s1.crosspost && targets.includes('instagram'));
    for (const pid of targets) {
      try { await runOne(pid, out, { skipCrossPost: strip }); }
      catch (e) { out[pid] = { state: 'failed', message: e.message }; setResults({ ...out }); }
    }
    const posted = targets
      .filter((pid) => out[pid]?.state === 'completed')
      .map((pid) => ({ pid, url: out[pid].url }));
    if (posted.length && posted.length === targets.length) setSuccess(posted);
  };

  const doSchedule = async (pid, whenIso) => {
    if (schedBusy) return;
    setSchedBusy(true);
    try {
      const strip = !(s1.crosspost && pid === 'instagram');
      await schedulePost(session.access_token, {
        platform: pid,
        connectionId: accountFor(pid),
        when: whenIso,
        body: bodyFor(pid, { skipCrossPost: strip }),
        files,
        thumb: pid === 'youtube' ? thumb : null,
      });
      setSchedOpen(false);
      setResults((r) => ({ ...r, [pid]: { state: 'scheduled', message: 'Scheduled — it will publish automatically.' } }));
      setSchedMsg(`${NAMES[pid]} scheduled for ${new Date(whenIso).toLocaleString()}. Manage or cancel it in History.`);
    } catch (e) {
      setSchedMsg(e.message || 'Could not schedule the post');
    }
    setSchedBusy(false);
  };

  const startNew = async () => {
    await resetPostState();
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
                <span key={s.pid}>{NAMES[s.pid]} {s.url ? <a href={s.url} target="_blank" rel="noreferrer">· View post</a> : '· posted'}</span>
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
              {!allReviewed && effective.length > 0 && !schedMsg && (
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
          busy={schedBusy}
          onClose={() => setSchedOpen(false)}
          onSchedule={doSchedule}
        />
      )}
    </div>
  );
}
